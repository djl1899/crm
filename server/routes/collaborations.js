import { q, one, TODAY } from '../db.js';
import { HttpError, readJson, idParam, intParam, json } from '../http.js';
import { v, validate, assertDateRange } from '../validate.js';
import { logActivity } from '../activity.js';
import { COLLAB_STATUSES, INVOICE_STATUSES } from '../../shared/constants.js';
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
  notes: v.str({ label: 'Notizen', max: 10000 }),
};

export const TIMEFRAME_SQL = `case
  when co.status in ('Abgeschlossen', 'Abgebrochen') or co.end_date < ${TODAY} then 'past'
  when co.status in (${ACTIVE_COLLAB_SQL})
    or (co.status = 'Geplant' and co.start_date is not null and co.start_date <= ${TODAY}) then 'current'
  else 'future' end`;
export const REVENUE_DATE_SQL = `coalesce(co.start_date, co.deadline, co.end_date, co.created_at::date)`;

const SELECT = `
  select co.*, c.display_name as creator_name, c.status as creator_status,
    ${TIMEFRAME_SQL} as timeframe,
    (co.status in (${REVENUE_COLLAB_SQL})) as counts_as_revenue,
    (select count(*)::int from tasks t where t.collaboration_id = co.id and t.status in ('Offen', 'In Bearbeitung', 'Wartet auf Creator')) as open_tasks
  from collaborations co join creators c on c.id = co.creator_id`;

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
  route('GET', '/finance/summary', async () => {
    const totals = await one(
      `select
        coalesce(sum(fee), 0) as total,
        coalesce(sum(fee) filter (where date_trunc('month', ${REVENUE_DATE_SQL}) = date_trunc('month', ${TODAY})), 0) as month,
        coalesce(sum(fee) filter (where date_trunc('year', ${REVENUE_DATE_SQL}) = date_trunc('year', ${TODAY})), 0) as year,
        coalesce(sum(fee) filter (where invoice_status = 'Bezahlt'), 0) as paid,
        coalesce(sum(fee) filter (where invoice_status in ('Offen', 'Eingereicht')), 0) as open,
        coalesce(sum(fee) filter (where invoice_status = 'Überfällig'), 0) as overdue,
        coalesce(sum(fee) filter (where invoice_status = 'Nicht erstellt'), 0) as not_invoiced
       from collaborations co where co.status in (${REVENUE_COLLAB_SQL})`
    );
    const byMonth = await q(
      `select to_char(date_trunc('month', ${REVENUE_DATE_SQL}), 'YYYY-MM') as month, coalesce(sum(fee), 0) as revenue
       from collaborations co
       where co.status in (${REVENUE_COLLAB_SQL}) and ${REVENUE_DATE_SQL} >= date_trunc('month', ${TODAY}) - interval '11 months'
         and ${REVENUE_DATE_SQL} < date_trunc('month', ${TODAY}) + interval '1 month'
       group by 1 order by 1`
    );
    const byCreator = await q(
      `select c.id, c.display_name, c.status,
        coalesce(sum(co.fee) filter (where co.status in (${REVENUE_COLLAB_SQL})), 0) as revenue,
        coalesce(sum(co.fee) filter (where co.status in (${REVENUE_COLLAB_SQL}) and co.invoice_status = 'Bezahlt'), 0) as paid,
        coalesce(sum(co.fee) filter (where co.status in (${REVENUE_COLLAB_SQL}) and co.invoice_status in ('Offen', 'Eingereicht', 'Überfällig')), 0) as open,
        count(co.id)::int as collab_count
       from creators c join collaborations co on co.creator_id = c.id
       group by c.id order by revenue desc limit 100`
    );
    return { totals, by_month: byMonth, by_creator: byCreator };
  });
}
