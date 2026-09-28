import { q, one, tx, TODAY } from '../db.js';
import { HttpError, readJson, idParam, intParam, json } from '../http.js';
import { v, validate } from '../validate.js';
import { logActivity } from '../activity.js';
import { OUTREACH_CHANNELS, OUTREACH_STATUSES } from '../../shared/constants.js';

const outreachSchema = {
  creator_id: v.ref({ label: 'Creator', required: true }),
  occurred_at: v.datetime({ label: 'Datum/Uhrzeit', required: true }),
  channel: v.oneOf(OUTREACH_CHANNELS, { label: 'Kontaktkanal', required: true }),
  user_id: v.ref({ label: 'Benutzer' }),
  subject: v.str({ label: 'Betreff', max: 200 }),
  message: v.str({ label: 'Nachricht/Notiz', max: 10000 }),
  result: v.str({ label: 'Ergebnis', max: 200 }),
  follow_up_date: v.date({ label: 'Follow-up-Termin' }),
};

const SELECT = `
  select o.id, o.creator_id, o.user_id, o.occurred_at, o.channel, o.subject, o.message, o.result,
    o.follow_up_date, o.follow_up_done, o.created_at,
    u.name as user_name, c.display_name as creator_name, c.outreach_status, c.status as creator_status
  from outreach_activities o
  join creators c on c.id = o.creator_id
  left join users u on u.id = o.user_id`;

export default function register(route) {
  route('GET', '/outreach', async ({ query }) => {
    const params = [];
    const p = (x) => { params.push(x); return `$${params.length}`; };
    const where = [];
    if (query.get('creator_id')) where.push(`o.creator_id = ${p(intParam(query.get('creator_id'), { def: 0 }))}`);
    if (query.get('user_id')) where.push(`o.user_id = ${p(intParam(query.get('user_id'), { def: 0 }))}`);
    if (OUTREACH_CHANNELS.includes(query.get('channel'))) where.push(`o.channel = ${p(query.get('channel'))}`);
    const s = (query.get('q') || '').trim();
    if (s) {
      const like = p(`%${s}%`);
      where.push(`(c.display_name ilike ${like} or o.subject ilike ${like} or o.message ilike ${like} or o.result ilike ${like})`);
    }
    const pageSize = intParam(query.get('page_size'), { min: 1, max: 200, def: 50 });
    const page = intParam(query.get('page'), { min: 1, def: 1 });
    const rows = await q(
      `${SELECT.replace('select o.id', 'select count(*) over() as total_count, o.id')}
       ${where.length ? 'where ' + where.join(' and ') : ''}
       order by o.occurred_at desc, o.id desc limit ${p(pageSize)} offset ${p((page - 1) * pageSize)}`,
      params
    );
    const total = rows[0] ? Number(rows[0].total_count) : 0;
    return { items: rows.map(({ total_count, ...r }) => r), total, page, pages: Math.max(1, Math.ceil(total / pageSize)) };
  });

  // Offene Follow-ups: range = today | overdue | week | open
  route('GET', '/followups', async ({ query }) => {
    const range = query.get('range') || 'open';
    const cond = {
      today: `o.follow_up_date = ${TODAY}`,
      overdue: `o.follow_up_date < ${TODAY}`,
      week: `o.follow_up_date > ${TODAY} and o.follow_up_date <= ${TODAY} + 7`,
      due: `o.follow_up_date <= ${TODAY}`,
      open: 'true',
    }[range] || 'true';
    const params = [];
    let extra = '';
    if (query.get('user_id')) { params.push(intParam(query.get('user_id'), { def: 0 })); extra = ` and (o.user_id = $1 or c.manager_id = $1)`; }
    const rows = await q(
      `${SELECT} where o.follow_up_done = false and o.follow_up_date is not null and ${cond}${extra}
       order by o.follow_up_date asc, o.id asc limit 200`,
      params
    );
    return { items: rows };
  });

  route('POST', '/outreach', async ({ req, user }) => {
    const body = await readJson(req);
    const data = validate({ occurred_at: new Date().toISOString(), ...body }, outreachSchema);
    const newStatus = v.oneOf(OUTREACH_STATUSES, { label: 'Outreach Status' })(body.outreach_status);
    const creator = await one(`select id, outreach_status, contacted from creators where id = $1`, [data.creator_id]);
    if (!creator) throw new HttpError(422, 'Creator nicht gefunden.', { creator_id: 'Ungültig.' });
    const userId = data.user_id || user.id;

    const created = await tx(async (run) => {
      if (body.close_previous_followups !== false) {
        await run(`update outreach_activities set follow_up_done = true where creator_id = $1 and follow_up_done = false`, [data.creator_id]);
      }
      const rows = await run(
        `insert into outreach_activities (creator_id, user_id, occurred_at, channel, subject, message, result, follow_up_date)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [data.creator_id, userId, data.occurred_at, data.channel, data.subject, data.message, data.result, data.follow_up_date]
      );
      // Creator automatisch als "angeschrieben" markieren und Outreach-Status fortschreiben
      const status = newStatus || (creator.outreach_status === 'Noch nicht kontaktiert' ? 'Kontaktiert' : creator.outreach_status);
      await run(`update creators set contacted = true, outreach_status = $2, updated_at = now() where id = $1`, [data.creator_id, status]);
      const summary = [data.channel, data.result || data.subject].filter(Boolean).join(' · ');
      await logActivity({ creatorId: data.creator_id, userId: user.id, entityType: 'outreach', entityId: rows[0].id, action: 'creator_contacted', message: `hat einen Kontakt erfasst (${summary}).` }, run);
      if (status !== creator.outreach_status) {
        await logActivity({ creatorId: data.creator_id, userId: user.id, entityType: 'creator', entityId: data.creator_id, action: 'outreach_status_changed', message: `hat den Outreach-Status von '${creator.outreach_status}' auf '${status}' geändert.` }, run);
      }
      if (data.follow_up_date) {
        await logActivity({ creatorId: data.creator_id, userId: user.id, entityType: 'outreach', entityId: rows[0].id, action: 'followup_set', message: `hat ein Follow-up für den ${data.follow_up_date.split('-').reverse().join('.')} geplant.` }, run);
      }
      return rows[0];
    });
    return json({ id: created.id }, 201);
  });

  route('PATCH', '/outreach/:id', async ({ req, params, user }) => {
    const id = idParam(params.id);
    const body = await readJson(req);
    const data = validate(body, { ...outreachSchema, follow_up_done: v.bool({ label: 'Erledigt' }) }, { partial: true });
    delete data.creator_id;
    const existing = await one(`select id, creator_id from outreach_activities where id = $1`, [id]);
    if (!existing) throw new HttpError(404, 'Kontakt nicht gefunden.');
    const keys = Object.keys(data);
    if (keys.length) {
      await q(`update outreach_activities set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [id, ...keys.map((k) => data[k])]);
    }
    const onlyDone = keys.length === 1 && keys[0] === 'follow_up_done';
    await logActivity({
      creatorId: existing.creator_id, userId: user.id, entityType: 'outreach', entityId: id,
      action: onlyDone ? 'followup_done' : 'outreach_updated',
      message: onlyDone ? (data.follow_up_done ? 'hat ein Follow-up als erledigt markiert.' : 'hat ein Follow-up wieder geöffnet.') : 'hat einen Kontakteintrag bearbeitet.',
    });
    return { ok: true };
  });

  route('DELETE', '/outreach/:id', async ({ params, user }) => {
    const id = idParam(params.id);
    const existing = await one(`delete from outreach_activities where id = $1 returning creator_id`, [id]);
    if (!existing) throw new HttpError(404, 'Kontakt nicht gefunden.');
    await logActivity({ creatorId: existing.creator_id, userId: user.id, entityType: 'outreach', entityId: id, action: 'outreach_deleted', message: 'hat einen Kontakteintrag gelöscht.' });
    return { ok: true };
  });
}
