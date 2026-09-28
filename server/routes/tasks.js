import { q, one, TODAY } from '../db.js';
import { HttpError, readJson, idParam, intParam, json } from '../http.js';
import { v, validate } from '../validate.js';
import { logActivity } from '../activity.js';
import { TASK_STATUSES, TASK_PRIORITIES } from '../../shared/constants.js';
import { OPEN_TASK_SQL } from './creators.js';

const taskSchema = {
  title: v.str({ label: 'Titel', required: true, max: 200 }),
  description: v.str({ label: 'Beschreibung', max: 10000 }),
  creator_id: v.ref({ label: 'Creator' }),
  collaboration_id: v.ref({ label: 'Kooperation' }),
  assignee_id: v.ref({ label: 'Verantwortlicher' }),
  priority: v.oneOf(TASK_PRIORITIES, { label: 'Priorität', def: 'Normal' }),
  status: v.oneOf(TASK_STATUSES, { label: 'Status', def: 'Offen' }),
  due_date: v.date({ label: 'Fälligkeitsdatum' }),
  notes: v.str({ label: 'Notizen', max: 10000 }),
};

const SELECT = `
  select t.*, c.display_name as creator_name, co.brand as collaboration_brand, co.campaign_name as collaboration_campaign,
    a.name as assignee_name, cb.name as created_by_name,
    (t.status in (${OPEN_TASK_SQL}) and t.due_date < ${TODAY}) as is_overdue
  from tasks t
  left join creators c on c.id = t.creator_id
  left join collaborations co on co.id = t.collaboration_id
  left join users a on a.id = t.assignee_id
  left join users cb on cb.id = t.created_by`;

async function checkRefs(data, existing = {}) {
  const creatorId = 'creator_id' in data ? data.creator_id : existing.creator_id;
  if ('creator_id' in data && data.creator_id) {
    if (!(await one(`select id from creators where id = $1`, [data.creator_id]))) throw new HttpError(422, 'Creator nicht gefunden.', { creator_id: 'Ungültig.' });
  }
  if ('collaboration_id' in data && data.collaboration_id) {
    const co = await one(`select id, creator_id from collaborations where id = $1`, [data.collaboration_id]);
    if (!co) throw new HttpError(422, 'Kooperation nicht gefunden.', { collaboration_id: 'Ungültig.' });
    if (creatorId && co.creator_id !== creatorId) throw new HttpError(422, 'Die Kooperation gehört zu einem anderen Creator.', { collaboration_id: 'Passt nicht zum Creator.' });
    if (!creatorId) data.creator_id = co.creator_id;
  }
  if ('assignee_id' in data && data.assignee_id) {
    if (!(await one(`select id from users where id = $1`, [data.assignee_id]))) throw new HttpError(422, 'Benutzer nicht gefunden.', { assignee_id: 'Ungültig.' });
  }
}

export default function register(route) {
  route('GET', '/tasks', async ({ query, user }) => {
    const params = [];
    const p = (x) => { params.push(x); return `$${params.length}`; };
    const where = [];
    const due = query.get('due');
    if (due === 'today') where.push(`t.due_date = ${TODAY}`);
    if (due === 'week') where.push(`t.due_date >= date_trunc('week', ${TODAY})::date and t.due_date < date_trunc('week', ${TODAY})::date + 7`);
    if (due === 'overdue') where.push(`t.due_date < ${TODAY} and t.status in (${OPEN_TASK_SQL})`);
    if (due === 'upcoming') where.push(`t.due_date > ${TODAY}`);
    if (due === 'none') where.push(`t.due_date is null`);
    const status = query.get('status');
    if (status === 'open') where.push(`t.status in (${OPEN_TASK_SQL})`);
    else if (TASK_STATUSES.includes(status)) where.push(`t.status = ${p(status)}`);
    const assignee = query.get('assignee_id');
    if (assignee === 'me') where.push(`t.assignee_id = ${p(user.id)}`);
    else if (assignee === 'none') where.push(`t.assignee_id is null`);
    else if (assignee) where.push(`t.assignee_id = ${p(intParam(assignee, { def: 0 }))}`);
    if (query.get('creator_id')) where.push(`t.creator_id = ${p(intParam(query.get('creator_id'), { def: 0 }))}`);
    if (query.get('collaboration_id')) where.push(`t.collaboration_id = ${p(intParam(query.get('collaboration_id'), { def: 0 }))}`);
    if (TASK_PRIORITIES.includes(query.get('priority'))) where.push(`t.priority = ${p(query.get('priority'))}`);
    const s = (query.get('q') || '').trim();
    if (s) {
      const like = p(`%${s}%`);
      where.push(`(t.title ilike ${like} or t.description ilike ${like} or c.display_name ilike ${like})`);
    }
    const pageSize = intParam(query.get('page_size'), { min: 1, max: 200, def: 50 });
    const page = intParam(query.get('page'), { min: 1, def: 1 });
    const rows = await q(
      `${SELECT.replace('select t.*', 'select count(*) over() as total_count, t.*')}
       ${where.length ? 'where ' + where.join(' and ') : ''}
       order by (t.status in (${OPEN_TASK_SQL})) desc, t.due_date asc nulls last,
         array_position(array['Dringend','Hoch','Normal','Niedrig']::text[], t.priority), t.id desc
       limit ${p(pageSize)} offset ${p((page - 1) * pageSize)}`,
      params
    );
    const total = rows[0] ? Number(rows[0].total_count) : 0;
    return { items: rows.map(({ total_count, ...r }) => r), total, page, pages: Math.max(1, Math.ceil(total / pageSize)) };
  });

  route('GET', '/tasks/:id', async ({ params }) => {
    const task = await one(`${SELECT} where t.id = $1`, [idParam(params.id)]);
    if (!task) throw new HttpError(404, 'Aufgabe nicht gefunden.');
    return { task };
  });

  route('POST', '/tasks', async ({ req, user }) => {
    const data = validate(await readJson(req), taskSchema);
    await checkRefs(data);
    const keys = Object.keys(data);
    const completed = data.status === 'Erledigt' ? 'now()' : 'null';
    const row = await one(
      `insert into tasks (${keys.join(', ')}, created_by, completed_at)
       values (${keys.map((_, i) => `$${i + 1}`).join(', ')}, $${keys.length + 1}, ${completed}) returning id`,
      [...keys.map((k) => data[k]), user.id]
    );
    await logActivity({ creatorId: data.creator_id, userId: user.id, entityType: 'task', entityId: row.id, action: 'task_created', message: `hat die Aufgabe „${data.title}“ erstellt.` });
    return json({ id: row.id }, 201);
  });

  route('PATCH', '/tasks/:id', async ({ req, params, user }) => {
    const id = idParam(params.id);
    const data = validate(await readJson(req), taskSchema, { partial: true });
    const before = await one(`select * from tasks where id = $1`, [id]);
    if (!before) throw new HttpError(404, 'Aufgabe nicht gefunden.');
    await checkRefs(data, before);
    const keys = Object.keys(data);
    let completedSql = '';
    if (data.status && data.status !== before.status) {
      completedSql = data.status === 'Erledigt' ? ', completed_at = now()' : ', completed_at = null';
    }
    if (keys.length) {
      await q(`update tasks set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}${completedSql}, updated_at = now() where id = $1`, [id, ...keys.map((k) => data[k])]);
    }
    const creatorId = 'creator_id' in data ? data.creator_id : before.creator_id;
    const title = `„${data.title || before.title}“`;
    if (data.status && data.status !== before.status) {
      await logActivity({
        creatorId, userId: user.id, entityType: 'task', entityId: id,
        action: data.status === 'Erledigt' ? 'task_completed' : 'task_status_changed',
        message: data.status === 'Erledigt' ? `hat die Aufgabe ${title} abgeschlossen.` : `hat den Status der Aufgabe ${title} auf '${data.status}' gesetzt.`,
      });
    } else if (keys.length) {
      await logActivity({ creatorId, userId: user.id, entityType: 'task', entityId: id, action: 'task_updated', message: `hat die Aufgabe ${title} bearbeitet.` });
    }
    return { ok: true };
  });

  route('DELETE', '/tasks/:id', async ({ params, user }) => {
    const id = idParam(params.id);
    const row = await one(`delete from tasks where id = $1 returning creator_id, title`, [id]);
    if (!row) throw new HttpError(404, 'Aufgabe nicht gefunden.');
    await logActivity({ creatorId: row.creator_id, userId: user.id, entityType: 'task', entityId: id, action: 'task_deleted', message: `hat die Aufgabe „${row.title}“ gelöscht.` });
    return { ok: true };
  });
}
