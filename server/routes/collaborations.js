import { q, one, TODAY } from '../db.js';
import { HttpError, readJson, idParam, intParam, json } from '../http.js';
import { v, validate, assertDateRange } from '../validate.js';
import { logActivity } from '../activity.js';
import { COLLAB_STATUSES, INVOICE_STATUSES, PAYOUT_STATUSES, MEDIA_REVENUE_EXCLUDED } from '../../shared/constants.js';
import { ACTIVE_COLLAB_SQL, REVENUE_COLLAB_SQL } from './creators.js';

const collabSchema = {
  creator_id: v.ref({ label: 'Creator', required: true }),
  brand: v.str({ label: 'Brand', required: true, max: 120 }),
  campaign_name: v.str({ label: 'Kampagnenname', max: 160 }),
  start_date: v.date({ label: 'Startdatum' }),
  end_date: v.date({ label: 'Enddatum' }),
  status: v.oneOf(COLLAB_STATUSES, { label: 'Status', def: 'Anfrage' }),
  platform: v.str({ label: 'Plattform', max: 60 }),
  description: v.str({ label: 'Beschreibung', max: 10000 }),
  deliverables: v.str({ label: 'Deliverables', max: 5000 }),
  deadline: v.date({ label: 'Deadline' }),
  fee: v.num({ label: 'Vergütung' }),
  invoice_status: v.oneOf(INVOICE_STATUSES, { label: 'Rechnungsstatus', def: 'Nicht erstellt' }),
  commission_rate: v.num({ label: 'Provision (%)', max: 100 }),
  payout_status: v.oneOf(PAYOUT_STATUSES, { label: 'Auszahlung an Creator', def: 'Offen' }),
  notes: v.str({ label: 'Notizen', max: 10000 }),
  contact_name: v.str({ label: 'Ansprechpartner', max: 120 }),
  contact_email: v.email({ label: 'E-Mail Ansprechpartner' }),
  usage_rights: v.str({ label: 'Nutzungsrechte', max: 3000 }),
  exclusivity: v.str({ label: 'Exklusivität', max: 2000 }),
  briefing_date: v.date({ label: 'Briefing-Termin' }),
  approval_date: v.date({ label: 'Freigabe bis' }),
  publish_date: v.date({ label: 'Veröffentlichung geplant' }),
  published_on: v.date({ label: 'Veröffentlicht am' }),
  invoice_due_date: v.date({ label: 'Rechnung fällig am' }),
  payout_date: v.date({ label: 'Ausgezahlt am' }),
};

const MEDIA_EXCL_SQL = MEDIA_REVENUE_EXCLUDED.map((x) => `'${x}'`).join(',');
const MEDIA_DATE_SQL = `coalesce((m.shoot_at at time zone 'Europe/Berlin')::date, m.delivery_date, m.created_at::date)`;

export const TIMEFRAME_SQL = `case
  when co.status in ('Abgeschlossen', 'Abgebrochen') or co.end_date < ${TODAY} then 'past'
  when co.status in (${ACTIVE_COLLAB_SQL})
    or (co.status = 'Geplant' and co.start_date is not null and co.start_date <= ${TODAY}) then 'current'
  else 'future' end`;
export const REVENUE_DATE_SQL = `coalesce(co.start_date, co.deadline, co.end_date, co.created_at::date)`;

const SELECT = `
  select co.*, c.display_name as creator_name, c.status as creator_status,
    f.rate as commission_effective, f.agency_fee, f.payout, c.commission_rate as creator_commission_rate,
    ${TIMEFRAME_SQL} as timeframe,
    (co.status in (${REVENUE_COLLAB_SQL})) as counts_as_revenue,
    (select count(*)::int from tasks t where t.collaboration_id = co.id and t.status in ('Offen', 'In Bearbeitung', 'Wartet auf Creator')) as open_tasks
  from collaborations co join creators c on c.id = co.creator_id
  join collab_finance f on f.id = co.id`;

export default function register(route) {
  route('GET', '/collaborations', async ({ query }) => {
    const params = [];
    const p = (x) => { params.push(x); return `$${params.length}`; };
    const where = [];
    if (query.get('creator_id')) where.push(`co.creator_id = ${p(intParam(query.get('creator_id'), { def: 0 }))}`);
    if (COLLAB_STATUSES.includes(query.get('status'))) where.push(`co.status = ${p(query.get('status'))}`);
    if (query.get('status_group') === 'active') where.push(`co.status in (${ACTIVE_COLLAB_SQL})`);
    if (INVOICE_STATUSES.includes(query.get('invoice_status'))) where.push(`co.invoice_status = ${p(query.get('invoice_status'))}`);
    if (['past', 'current', 'future'].includes(query.get('timeframe'))) where.push(`(${TIMEFRAME_SQL}) = ${p(query.get('timeframe'))}`);
    if (query.get('deadline') === 'upcoming') where.push(`co.deadline >= ${TODAY} and co.status not in ('Abgeschlossen', 'Abgebrochen')`);
    const s = (query.get('q') || '').trim();
    if (s) {
      const like = p(`%${s}%`);
      where.push(`(co.brand ilike ${like} or co.campaign_name ilike ${like} or c.display_name ilike ${like})`);
    }
    const sorts = {
      deadline: 'co.deadline asc nulls last',
      start: 'co.start_date desc nulls last',
      fee: 'co.fee desc',
      created: 'co.created_at desc',
      brand: 'lower(co.brand) asc',
    };
    const order = sorts[query.get('sort')] || 'co.start_date desc nulls last, co.created_at desc';
    const pageSize = intParam(query.get('page_size'), { min: 1, max: 200, def: 50 });
    const page = intParam(query.get('page'), { min: 1, def: 1 });
    const rows = await q(
      `${SELECT.replace('select co.*', 'select count(*) over() as total_count, co.*')}
       ${where.length ? 'where ' + where.join(' and ') : ''}
       order by ${order}, co.id desc limit ${p(pageSize)} offset ${p((page - 1) * pageSize)}`,
      params
    );
    const total = rows[0] ? Number(rows[0].total_count) : 0;
    return { items: rows.map(({ total_count, ...r }) => r), total, page, pages: Math.max(1, Math.ceil(total / pageSize)) };
  });

  route('GET', '/collaborations/:id', async ({ params }) => {
    const id = idParam(params.id);
    const row = await one(`${SELECT} where co.id = $1`, [id]);
    if (!row) throw new HttpError(404, 'Kooperation nicht gefunden.');
    return { collaboration: row };
  });

  route('POST', '/collaborations', async ({ req, user }) => {
    const data = validate(await readJson(req), collabSchema);
    assertDateRange(data.start_date, data.end_date);
    if (data.fee === null) data.fee = 0;
    const c = await one(`select id from creators where id = $1`, [data.creator_id]);
    if (!c) throw new HttpError(422, 'Creator nicht gefunden.', { creator_id: 'Ungültig.' });
    const keys = Object.keys(data);
    const row = await one(
      `insert into collaborations (${keys.join(', ')}, created_by) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}, $${keys.length + 1}) returning id`,
      [...keys.map((k) => data[k]), user.id]
    );
    await logActivity({ creatorId: data.creator_id, userId: user.id, entityType: 'collaboration', entityId: row.id, action: 'collaboration_created', message: `hat die Kooperation „${data.brand}${data.campaign_name ? ' – ' + data.campaign_name : ''}“ erstellt.` });
    return json({ id: row.id }, 201);
  });

  route('PATCH', '/collaborations/:id', async ({ req, params, user }) => {
    const id = idParam(params.id);
    const data = validate(await readJson(req), collabSchema, { partial: true });
    const before = await one(`select * from collaborations where id = $1`, [id]);
    if (!before) throw new HttpError(404, 'Kooperation nicht gefunden.');
    if ('creator_id' in data) {
      const c = await one(`select id from creators where id = $1`, [data.creator_id]);
      if (!c) throw new HttpError(422, 'Creator nicht gefunden.', { creator_id: 'Ungültig.' });
    }
    if ('fee' in data && data.fee === null) data.fee = 0;
    assertDateRange(data.start_date ?? before.start_date, data.end_date ?? before.end_date);
    const keys = Object.keys(data);
    if (keys.length) {
      await q(`update collaborations set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [id, ...keys.map((k) => data[k])]);
    }
    const creatorId = data.creator_id || before.creator_id;
    const name = `„${data.brand || before.brand}“`;
    const log = (action, message) => logActivity({ creatorId, userId: user.id, entityType: 'collaboration', entityId: id, action, message });
    if (data.status && data.status !== before.status) await log('collaboration_status_changed', `hat den Status der Kooperation ${name} von '${before.status}' auf '${data.status}' geändert.`);
    if (data.invoice_status && data.invoice_status !== before.invoice_status) await log('invoice_status_changed', `hat den Rechnungsstatus der Kooperation ${name} auf '${data.invoice_status}' gesetzt.`);
    const other = keys.filter((k) => !['status', 'invoice_status'].includes(k) && String(data[k] ?? '') !== String(before[k] ?? ''));
    if (other.length) await log('collaboration_updated', `hat die Kooperation ${name} geändert.`);
    return { ok: true };
  });

  route('DELETE', '/collaborations/:id', async ({ params, user }) => {
    const id = idParam(params.id);
    const row = await one(`delete from collaborations where id = $1 returning creator_id, brand`, [id]);
    if (!row) throw new HttpError(404, 'Kooperation nicht gefunden.');
    await logActivity({ creatorId: row.creator_id, userId: user.id, entityType: 'collaboration', entityId: id, action: 'collaboration_deleted', message: `hat die Kooperation „${row.brand}“ gelöscht.` });
    return { ok: true };
  });

  // Finanzübersicht (bewusst einfach)
  // Finanzübersicht: Agenturumsatz = Provision aus Kooperationen + Media-Produktion
  route('GET', '/finance/summary', async () => {
    const inMonth = (d) => `date_trunc('month', ${d}) = date_trunc('month', ${TODAY})`;
    const inYear = (d) => `date_trunc('year', ${d}) = date_trunc('year', ${TODAY})`;
    const c = await one(
      `select
        coalesce(sum(fee), 0) as volume,
        coalesce(sum(fee) filter (where ${inMonth('rev_date')}), 0) as volume_month,
        coalesce(sum(fee) filter (where ${inYear('rev_date')}), 0) as volume_year,
        coalesce(sum(agency_fee), 0) as agency_total,
        coalesce(sum(agency_fee) filter (where ${inMonth('rev_date')}), 0) as agency_month,
        coalesce(sum(agency_fee) filter (where ${inYear('rev_date')}), 0) as agency_year,
        coalesce(sum(fee) filter (where invoice_status = 'Bezahlt'), 0) as paid,
        coalesce(sum(fee) filter (where invoice_status in ('Offen', 'Eingereicht')), 0) as open,
        coalesce(sum(fee) filter (where invoice_status = 'Überfällig'), 0) as overdue,
        coalesce(sum(payout) filter (where payout_status = 'Offen'), 0) as payout_open,
        coalesce(sum(payout) filter (where payout_status = 'Offen' and invoice_status = 'Bezahlt'), 0) as payout_due,
        coalesce(sum(payout) filter (where payout_status = 'Ausgezahlt'), 0) as payout_done
       from collab_finance where status in (${REVENUE_COLLAB_SQL})`
    );
    const m = await one(
      `select coalesce(sum(price), 0) as total,
         coalesce(sum(price) filter (where ${inMonth(MEDIA_DATE_SQL)}), 0) as month,
         coalesce(sum(price) filter (where ${inYear(MEDIA_DATE_SQL)}), 0) as year
       from media_projects m where m.status not in (${MEDIA_EXCL_SQL})`
    );
    const r2 = (x) => Math.round(x * 100) / 100;
    const totals = {
      ...c,
      media_total: m.total, media_month: m.month, media_year: m.year,
      total: r2(c.agency_total + m.total), month: r2(c.agency_month + m.month), year: r2(c.agency_year + m.year),
    };
    const byMonth = await q(
      `select month, sum(revenue) as revenue, sum(agency) as agency, sum(media) as media from (
         select to_char(date_trunc('month', rev_date), 'YYYY-MM') as month, agency_fee as revenue, agency_fee as agency, 0 as media
         from collab_finance where status in (${REVENUE_COLLAB_SQL})
         union all
         select to_char(date_trunc('month', ${MEDIA_DATE_SQL}), 'YYYY-MM'), price, 0, price
         from media_projects m where m.status not in (${MEDIA_EXCL_SQL})
       ) x
       where month >= to_char(date_trunc('month', ${TODAY}) - interval '11 months', 'YYYY-MM')
         and month <= to_char(${TODAY}, 'YYYY-MM')
       group by month order by month`
    );
    const byCreator = await q(
      `select c.id, c.display_name, c.status,
        coalesce(sum(f.fee), 0) as volume,
        coalesce(sum(f.agency_fee), 0) as agency,
        coalesce(sum(f.payout) filter (where f.payout_status = 'Offen'), 0) as payout_open,
        coalesce(sum(f.fee) filter (where f.invoice_status = 'Bezahlt'), 0) as paid,
        count(f.id)::int as collab_count
       from creators c join collab_finance f on f.creator_id = c.id
       where f.status in (${REVENUE_COLLAB_SQL})
       group by c.id order by agency desc limit 100`
    );
    return { totals, by_month: byMonth, by_creator: byCreator };
  });
}
