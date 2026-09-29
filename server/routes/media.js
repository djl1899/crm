import { q, one, TODAY } from '../db.js';
import { HttpError, readJson, idParam, intParam, json } from '../http.js';
import { v, validate } from '../validate.js';
import { logActivity } from '../activity.js';
import { MEDIA_STATUSES, MEDIA_CLOSED_STATUSES, INVOICE_STATUSES } from '../../shared/constants.js';

const CLOSED_SQL = MEDIA_CLOSED_STATUSES.map((s) => `'${s}'`).join(',');

const schema = {
  client_name: v.str({ label: 'Kunde', required: true, max: 160 }),
  title: v.str({ label: 'Projekt', required: true, max: 200 }),
  project_type: v.str({ label: 'Art', max: 80 }),
  status: v.oneOf(MEDIA_STATUSES, { label: 'Status', def: 'Anfrage' }),
  shoot_at: v.datetime({ label: 'Drehtermin' }),
  shoot_location: v.str({ label: 'Drehort', max: 200 }),
  delivery_date: v.date({ label: 'Abgabetermin' }),
  deliverables: v.str({ label: 'Leistungen', max: 5000 }),
  price: v.num({ label: 'Preis' }),
  invoice_status: v.oneOf(INVOICE_STATUSES, { label: 'Rechnungsstatus', def: 'Nicht erstellt' }),
  contact_name: v.str({ label: 'Ansprechpartner', max: 120 }),
  contact_email: v.email({ label: 'E-Mail' }),
  contact_phone: v.str({ label: 'Telefon', max: 40 }),
  assignee_id: v.ref({ label: 'Verantwortlich' }),
  creator_id: v.ref({ label: 'Creator' }),
  notes: v.str({ label: 'Notizen', max: 10000 }),
};

const SELECT = `
  select m.*, u.name as assignee_name, c.display_name as creator_name,
    (m.status not in (${CLOSED_SQL})) as is_open,
    (m.status not in (${CLOSED_SQL}, 'Geliefert') and m.delivery_date < ${TODAY}) as delivery_overdue
  from media_projects m
  left join users u on u.id = m.assignee_id
  left join creators c on c.id = m.creator_id`;

async function checkRefs(d) {
  if (d.assignee_id && !(await one(`select id from users where id = $1`, [d.assignee_id]))) throw new HttpError(422, 'Benutzer nicht gefunden.', { assignee_id: 'Ungültig.' });
  if (d.creator_id && !(await one(`select id from creators where id = $1`, [d.creator_id]))) throw new HttpError(422, 'Creator nicht gefunden.', { creator_id: 'Ungültig.' });
}

export default function register(route) {
  route('GET', '/media', async ({ query }) => {
    const params = [];
    const p = (x) => { params.push(x); return `$${params.length}`; };
    const where = [];
    const view = query.get('view') || 'open';
    if (view === 'open') where.push(`m.status not in (${CLOSED_SQL})`);
    if (view === 'closed') where.push(`m.status in (${CLOSED_SQL})`);
    if (MEDIA_STATUSES.includes(query.get('status'))) where.push(`m.status = ${p(query.get('status'))}`);
    if (query.get('assignee_id')) where.push(`m.assignee_id = ${p(intParam(query.get('assignee_id'), { def: 0 }))}`);
    const s = (query.get('q') || '').trim();
    if (s) {
      const like = p(`%${s}%`);
      where.push(`(m.client_name ilike ${like} or m.title ilike ${like} or m.contact_name ilike ${like} or m.shoot_location ilike ${like})`);
    }
    const pageSize = intParam(query.get('page_size'), { min: 1, max: 200, def: 50 });
    const page = intParam(query.get('page'), { min: 1, def: 1 });
    const order = view === 'closed'
      ? 'coalesce(m.delivery_date, m.shoot_at::date, m.created_at::date) desc'
      : 'coalesce(m.shoot_at::date, m.delivery_date) asc nulls last, m.delivery_date asc nulls last';
    const rows = await q(
      `${SELECT.replace('select m.*', 'select count(*) over() as total_count, m.*')}
       ${where.length ? 'where ' + where.join(' and ') : ''}
       order by ${order}, m.id desc limit ${p(pageSize)} offset ${p((page - 1) * pageSize)}`,
      params
    );
    const total = rows[0] ? Number(rows[0].total_count) : 0;
    return { items: rows.map(({ total_count, ...r }) => r), total, page, pages: Math.max(1, Math.ceil(total / pageSize)) };
  });

  route('GET', '/media/overview', async () => {
    const [kpi, shoots, deliveries] = await Promise.all([
      one(`select
        (select count(*)::int from media_projects where status not in (${CLOSED_SQL})) as open_projects,
        (select count(*)::int from media_projects where status in ('Anfrage', 'Angebot gesendet')) as inquiries,
        (select count(*)::int from media_projects where status not in (${CLOSED_SQL}) and shoot_at >= now() and (shoot_at at time zone 'Europe/Berlin')::date <= ${TODAY} + 7) as shoots_week,
        (select count(*)::int from media_projects where status not in (${CLOSED_SQL}, 'Geliefert') and delivery_date <= ${TODAY} + 7) as deliveries_due,
        (select count(*)::int from media_projects where status not in (${CLOSED_SQL}, 'Geliefert') and delivery_date < ${TODAY}) as deliveries_overdue,
        (select coalesce(sum(price), 0) from media_projects where status not in ('Anfrage', 'Angebot gesendet', 'Abgebrochen') and invoice_status <> 'Bezahlt') as open_amount,
        (select coalesce(sum(price), 0) from media_projects where status not in ('Anfrage', 'Angebot gesendet', 'Abgebrochen')
           and date_trunc('year', coalesce(shoot_at::date, delivery_date, created_at::date)) = date_trunc('year', ${TODAY})) as revenue_year`),
      q(`${SELECT} where m.status not in (${CLOSED_SQL}) and m.shoot_at >= now() - interval '12 hours' order by m.shoot_at asc limit 6`),
      q(`${SELECT} where m.status not in (${CLOSED_SQL}, 'Geliefert') and m.delivery_date is not null order by m.delivery_date asc limit 6`),
    ]);
    return { kpi, shoots, deliveries };
  });

  route('GET', '/media/:id', async ({ params }) => {
    const row = await one(`${SELECT} where m.id = $1`, [idParam(params.id)]);
    if (!row) throw new HttpError(404, 'Projekt nicht gefunden.');
    return { project: row };
  });

  route('POST', '/media', async ({ req, user }) => {
    const data = validate(await readJson(req), schema);
    if (data.price === null) data.price = 0;
    await checkRefs(data);
    const keys = Object.keys(data);
    const row = await one(
      `insert into media_projects (${keys.join(', ')}, created_by) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}, $${keys.length + 1}) returning id`,
      [...keys.map((k) => data[k]), user.id]
    );
    await logActivity({ creatorId: data.creator_id, userId: user.id, entityType: 'media', entityId: row.id, action: 'media_created',
      message: `hat das Media-Projekt „${data.title}“ für ${data.client_name} angelegt.` });
    return json({ id: row.id }, 201);
  });

  route('PATCH', '/media/:id', async ({ req, params, user }) => {
    const id = idParam(params.id);
    const data = validate(await readJson(req), schema, { partial: true });
    if ('price' in data && data.price === null) data.price = 0;
    const before = await one(`select * from media_projects where id = $1`, [id]);
    if (!before) throw new HttpError(404, 'Projekt nicht gefunden.');
    await checkRefs(data);
    const keys = Object.keys(data);
    if (keys.length) {
      await q(`update media_projects set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [id, ...keys.map((k) => data[k])]);
    }
    const title = data.title || before.title;
    const creatorId = 'creator_id' in data ? data.creator_id : before.creator_id;
    const msg = data.status && data.status !== before.status
      ? `hat den Status des Media-Projekts „${title}“ auf '${data.status}' gesetzt.`
      : `hat das Media-Projekt „${title}“ bearbeitet.`;
    await logActivity({ creatorId, userId: user.id, entityType: 'media', entityId: id, action: 'media_updated', message: msg });
    return { ok: true };
  });

  route('DELETE', '/media/:id', async ({ params, user }) => {
    const id = idParam(params.id);
    const row = await one(`delete from media_projects where id = $1 returning title, creator_id`, [id]);
    if (!row) throw new HttpError(404, 'Projekt nicht gefunden.');
    await logActivity({ creatorId: row.creator_id, userId: user.id, entityType: 'media', entityId: id, action: 'media_deleted', message: `hat das Media-Projekt „${row.title}“ gelöscht.` });
    return { ok: true };
  });
}
