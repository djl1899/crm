// Team-Kalender: eigene Termine + automatisch Aufgaben, Shootings, Deal-Termine und Follow-ups
import { q, one, tx } from '../db.js';
import { HttpError, readJson, idParam, json } from '../http.js';
import { v, validate } from '../validate.js';
import { logActivity } from '../activity.js';
import { TEAM_EVENT_KINDS, PERSON_COLORS, OPEN_TASK_STATUSES, MEDIA_CLOSED_STATUSES } from '../../shared/constants.js';

const TZ = 'Europe/Berlin';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d) => (d instanceof Date ? d.toISOString() : d);
const dstr = (d) => (d ? (typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10)) : null);

const eventSchema = {
  title: v.str({ label: 'Titel', required: true, max: 200 }),
  kind: v.oneOf(TEAM_EVENT_KINDS, { label: 'Art', def: 'Termin' }),
  starts_at: v.datetime({ label: 'Beginn', required: true }),
  ends_at: v.datetime({ label: 'Ende', required: true }),
  all_day: v.bool({ label: 'Ganztägig' }),
  location: v.str({ label: 'Ort', max: 300 }),
  notes: v.str({ label: 'Notizen', max: 5000 }),
  creator_id: v.ref({ label: 'Creator' }),
  collaboration_id: v.ref({ label: 'Kooperation' }),
  attendee_ids: v.ids({ label: 'Teilnehmer' }),
};

async function teamUsers() {
  const users = await q(`select id, name, is_active from users where role <> 'creator' order by id`);
  return users.map((u, i) => ({ ...u, color: PERSON_COLORS[i % PERSON_COLORS.length] }));
}

async function checkAttendees(ids) {
  if (!ids.length) return;
  const rows = await q(`select id from users where id = any($1::int[]) and role <> 'creator'`, [ids]);
  if (rows.length !== ids.length) throw new HttpError(422, 'Ungültige Teilnehmer.', { attendee_ids: 'Ungültige Auswahl.' });
}

export default function register(route) {
  route('GET', '/team-calendar', async ({ query }) => {
    const start = query.get('start');
    const end = query.get('end');
    if (!DATE_RE.test(start || '') || !DATE_RE.test(end || '') || end < start) throw new HttpError(422, 'Ungültiger Zeitraum.');
    const days = (new Date(end) - new Date(start)) / 864e5;
    if (days > 62) throw new HttpError(422, 'Zeitraum zu groß (max. 2 Monate).');
    const users = await teamUsers();

    const items = [];
    // 1) Eigene Termine
    const evs = await q(
      `select e.*, c.display_name as creator_name, u.name as created_by_name,
         coalesce((select array_agg(a.user_id order by a.user_id) from team_event_attendees a where a.event_id = e.id), '{}') as attendee_ids
       from team_events e left join creators c on c.id = e.creator_id left join users u on u.id = e.created_by
       where e.starts_at < (($2::date + 1)::timestamp at time zone '${TZ}') and e.ends_at > ($1::date::timestamp at time zone '${TZ}')
       order by e.starts_at`,
      [start, end]
    );
    for (const e of evs) {
      items.push({
        id: `e${e.id}`, event_id: e.id, source: 'event', kind: e.kind, title: e.title, start: iso(e.starts_at), end: iso(e.ends_at), all_day: e.all_day,
        location: e.location, notes: e.notes, user_ids: e.attendee_ids.length ? e.attendee_ids : e.created_by ? [e.created_by] : [],
        creator_id: e.creator_id, creator_name: e.creator_name, collaboration_id: e.collaboration_id, created_by_name: e.created_by_name, editable: true,
      });
    }
    // 2) Offene Aufgaben mit Fälligkeit
    const tasks = await q(
      `select t.id, t.title, t.due_date, t.assignee_id, t.priority, c.display_name as creator_name from tasks t left join creators c on c.id = t.creator_id
       where t.status = any($3::text[]) and t.due_date between $1 and $2`,
      [start, end, OPEN_TASK_STATUSES]
    );
    for (const t of tasks) items.push({ id: `t${t.id}`, source: 'task', kind: 'Aufgabe', title: t.title + (t.creator_name ? ` · ${t.creator_name}` : ''), date: dstr(t.due_date), all_day: true, user_ids: t.assignee_id ? [t.assignee_id] : [], link: `/tasks?open=${t.id}`, priority: t.priority });
    // 3) Media-Produktion: Shooting (mit Uhrzeit) und Abgabe
    const media = await q(
      `select id, title, client_name, shoot_at, shoot_location, delivery_date, assignee_id,
         (shoot_at >= ($1::date::timestamp at time zone '${TZ}') and shoot_at < (($2::date + 1)::timestamp at time zone '${TZ}')) as shoot_in
       from media_projects
       where status <> all($3::text[]) and (
         (shoot_at >= ($1::date::timestamp at time zone '${TZ}') and shoot_at < (($2::date + 1)::timestamp at time zone '${TZ}'))
         or delivery_date between $1 and $2)`,
      [start, end, MEDIA_CLOSED_STATUSES]
    );
    for (const m of media) {
      const uids = m.assignee_id ? [m.assignee_id] : [];
      const s = m.shoot_at ? new Date(m.shoot_at) : null;
      if (s && m.shoot_in) {
        items.push({ id: `ms${m.id}`, source: 'media', kind: 'Shooting', title: `Shooting: ${m.title} (${m.client_name})`, start: s.toISOString(), end: new Date(s.getTime() + 2 * 3600e3).toISOString(), all_day: false, location: m.shoot_location, user_ids: uids, link: `/media?open=${m.id}` });
      }
      const dd = dstr(m.delivery_date);
      if (dd && dd >= start && dd <= end) items.push({ id: `md${m.id}`, source: 'media', kind: 'Abgabe', title: `Abgabe: ${m.title} (${m.client_name})`, date: dd, all_day: true, user_ids: uids, link: `/media?open=${m.id}` });
    }
    // 4) Deal-Termine (zuständig: Manager des Creators)
    const deals = await q(
      `select co.id, co.brand, co.deadline, co.publish_date, co.briefing_date, c.display_name, c.manager_id from collaborations co join creators c on c.id = co.creator_id
       where co.status not in ('Abgebrochen', 'Abgeschlossen') and (co.deadline between $1 and $2 or co.publish_date between $1 and $2 or co.briefing_date between $1 and $2)`,
      [start, end]
    );
    for (const d of deals) {
      for (const [field, label] of [['briefing_date', 'Briefing'], ['deadline', 'Content-Abgabe'], ['publish_date', 'Posting']]) {
        const x = dstr(d[field]);
        if (x && x >= start && x <= end) items.push({ id: `d${d.id}-${field}`, source: 'deal', kind: label, title: `${label}: ${d.brand} · ${d.display_name}`, date: x, all_day: true, user_ids: d.manager_id ? [d.manager_id] : [], link: `/collaborations?open=${d.id}` });
      }
    }
    // 5) Fällige Follow-ups
    const fus = await q(
      `select o.id, o.follow_up_date, o.user_id, c.id as creator_id, c.display_name from outreach_activities o join creators c on c.id = o.creator_id
       where o.follow_up_done = false and o.follow_up_date between $1 and $2`,
      [start, end]
    );
    for (const f of fus) items.push({ id: `f${f.id}`, source: 'followup', kind: 'Follow-up', title: `Follow-up: ${f.display_name}`, date: dstr(f.follow_up_date), all_day: true, user_ids: f.user_id ? [f.user_id] : [], link: `/creators/${f.creator_id}?tab=outreach` });

    return { users, items, kinds: TEAM_EVENT_KINDS };
  });

  const save = async ({ req, user, id }) => {
    const data = validate(await readJson(req), eventSchema, { partial: !!id });
    if (data.starts_at && data.ends_at && data.ends_at < data.starts_at) throw new HttpError(422, 'Das Ende liegt vor dem Beginn.', { ends_at: 'Ende vor Beginn.' });
    if (data.attendee_ids) await checkAttendees(data.attendee_ids);
    const { attendee_ids, ...cols } = data;
    return tx(async (run) => {
      let eventId = id;
      if (id) {
        const before = (await run(`select starts_at, ends_at from team_events where id = $1`, [id]))[0];
        if (!before) throw new HttpError(404, 'Termin nicht gefunden.');
        const s = cols.starts_at || iso(before.starts_at);
        const e = cols.ends_at || iso(before.ends_at);
        if (new Date(e) < new Date(s)) throw new HttpError(422, 'Das Ende liegt vor dem Beginn.', { ends_at: 'Ende vor Beginn.' });
        const keys = Object.keys(cols);
        if (keys.length) await run(`update team_events set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [id, ...keys.map((k) => cols[k])]);
      } else {
        const keys = Object.keys(cols);
        const r = await run(`insert into team_events (${keys.join(', ')}, created_by) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}, $${keys.length + 1}) returning id`, [...keys.map((k) => cols[k]), user.id]);
        eventId = r[0].id;
      }
      if (attendee_ids) {
        await run(`delete from team_event_attendees where event_id = $1`, [eventId]);
        const ids = attendee_ids.length ? attendee_ids : [user.id];
        await run(`insert into team_event_attendees (event_id, user_id) select $1, unnest($2::int[])`, [eventId, ids]);
      }
      return eventId;
    });
  };

  route('POST', '/team-events', async ({ req, user }) => {
    const id = await save({ req, user });
    const e = await one(`select title from team_events where id = $1`, [id]);
    await logActivity({ userId: user.id, entityType: 'event', entityId: id, action: 'event_created', message: `hat den Termin „${e.title}“ angelegt.` });
    return json({ id }, 201);
  });

  route('PATCH', '/team-events/:id', async ({ req, user, params }) => {
    await save({ req, user, id: idParam(params.id) });
    return { ok: true };
  });

  route('DELETE', '/team-events/:id', async ({ params, user }) => {
    const id = idParam(params.id);
    const e = await one(`delete from team_events where id = $1 returning title`, [id]);
    if (!e) throw new HttpError(404, 'Termin nicht gefunden.');
    await logActivity({ userId: user.id, entityType: 'event', entityId: id, action: 'event_deleted', message: `hat den Termin „${e.title}“ gelöscht.` });
    return { ok: true };
  });
}
