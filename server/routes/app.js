// Bereich "App": interne Steuerung der Marktplatz-App (Influencer ↔ Firmen).
// Alle Daten liegen in eigenen Tabellen (app_*) und sind vollständig vom CRM getrennt.
import { q, one, TODAY } from '../db.js';
import { HttpError, readJson, idParam, intParam, json } from '../http.js';
import { v, validate } from '../validate.js';
import {
  APP_INFLUENCER_STATUSES, APP_COMPANY_STATUSES, APP_CAMPAIGN_STATUSES, APP_ASSIGNMENT_STATUSES,
  APP_ROADMAP_STATUSES, APP_ROADMAP_AREAS, APP_UPDATE_TYPES, APP_PLATFORMS, TASK_PRIORITIES,
} from '../../shared/constants.js';

const handle = ({ label }) => (val) => {
  const s = v.str({ label, max: 80 })(val);
  return s ? s.replace(/^@+/, '') : null;
};

// ---------------------------------------------------------------------------
// Generische CRUD-Endpunkte
// ---------------------------------------------------------------------------
function crud(route, cfg) {
  const { path, table, select, schema, search = [], filters = {}, order, label, prepare, afterWrite } = cfg;

  route('GET', path, async ({ query }) => {
    const params = [];
    const p = (x) => { params.push(x); return `$${params.length}`; };
    const where = [];
    for (const [key, col] of Object.entries(filters)) {
      const val = query.get(key);
      if (val) where.push(`${col} = ${p(val)}`);
    }
    const s = (query.get('q') || '').trim().replace(/^@/, '');
    if (s && search.length) {
      const like = p(`%${s}%`);
      where.push('(' + search.map((c) => `${c} ilike ${like}`).join(' or ') + ')');
    }
    const pageSize = intParam(query.get('page_size'), { min: 1, max: 500, def: 50 });
    const page = intParam(query.get('page'), { min: 1, def: 1 });
    const rows = await q(
      `select count(*) over() as total_count, x.* from (${select}) x
       ${where.length ? 'where ' + where.join(' and ') : ''}
       order by ${order} limit ${p(pageSize)} offset ${p((page - 1) * pageSize)}`,
      params
    );
    const total = rows[0] ? Number(rows[0].total_count) : 0;
    return { items: rows.map(({ total_count, ...r }) => r), total, page, pages: Math.max(1, Math.ceil(total / pageSize)) };
  });

  route('GET', `${path}/:id`, async ({ params }) => {
    const row = await one(`select * from (${select}) x where x.id = $1`, [idParam(params.id)]);
    if (!row) throw new HttpError(404, `${label} nicht gefunden.`);
    return { item: row };
  });

  route('POST', path, async ({ req, user }) => {
    const data = validate(await readJson(req), schema);
    if (prepare) await prepare(data, { user, creating: true });
    const keys = Object.keys(data);
    const row = await one(
      `insert into ${table} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
      keys.map((k) => data[k])
    );
    if (afterWrite) await afterWrite(row.id, data);
    return json({ id: row.id }, 201);
  });

  route('PATCH', `${path}/:id`, async ({ req, params, user }) => {
    const id = idParam(params.id);
    const data = validate(await readJson(req), schema, { partial: true });
    const before = await one(`select * from ${table} where id = $1`, [id]);
    if (!before) throw new HttpError(404, `${label} nicht gefunden.`);
    if (prepare) await prepare(data, { user, creating: false, before });
    const keys = Object.keys(data);
    if (keys.length) {
      await q(`update ${table} set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [id, ...keys.map((k) => data[k])]);
    }
    if (afterWrite) await afterWrite(id, data, before);
    return { ok: true };
  });

  route('DELETE', `${path}/:id`, async ({ params }) => {
    const row = await one(`delete from ${table} where id = $1 returning id`, [idParam(params.id)]);
    if (!row) throw new HttpError(404, `${label} nicht gefunden.`);
    return { ok: true };
  });
}

const CAMPAIGN_SELECT = `
  select c.*, co.name as company_name,
    (select count(*)::int from app_campaign_influencers a where a.campaign_id = c.id and a.status <> 'Abgesagt') as influencer_count,
    (select coalesce(sum(a.fee), 0) from app_campaign_influencers a where a.campaign_id = c.id and a.status <> 'Abgesagt') as allocated
  from app_campaigns c left join app_companies co on co.id = c.company_id`;

export default function register(route) {
  // ---------- Übersicht ----------
  route('GET', '/app/overview', async () => {
    const [kpi, infByStatus, compByStatus, roadByStatus, nextItems, updates, topNiches] = await Promise.all([
      one(`select
        (select count(*)::int from app_influencers) as influencers,
        (select count(*)::int from app_influencers where created_at > now() - interval '30 days') as influencers_new,
        (select count(*)::int from app_influencers where followers is not null and followers <= 50000) as micro_influencers,
        (select coalesce(round(avg(followers)), 0)::int from app_influencers where followers is not null) as avg_followers,
        (select count(*)::int from app_companies) as companies,
        (select count(*)::int from app_companies where status in ('Pilotkunde', 'Zahlender Kunde')) as companies_customers,
        (select count(*)::int from app_campaigns where status in ('Matching', 'Aktiv')) as campaigns_running,
        (select count(*)::int from app_campaigns) as campaigns,
        (select coalesce(sum(budget), 0) from app_campaigns where status <> 'Abgebrochen') as budget_total,
        (select coalesce(sum(a.fee), 0) from app_campaign_influencers a join app_campaigns c on c.id = a.campaign_id
           where a.status <> 'Abgesagt' and c.status <> 'Abgebrochen') as budget_allocated,
        (select coalesce(round(avg(cnt), 1), 0) from (select count(*) as cnt from app_campaign_influencers
           where status <> 'Abgesagt' group by campaign_id) t) as avg_influencers_per_campaign,
        (select coalesce(round(avg(fee)), 0) from app_campaign_influencers where status <> 'Abgesagt' and fee > 0) as avg_fee,
        (select count(*)::int from app_roadmap) as roadmap_total,
        (select count(*)::int from app_roadmap where status = 'Fertig') as roadmap_done,
        (select count(*)::int from app_roadmap where status = 'In Arbeit') as roadmap_in_progress,
        (select count(*)::int from app_roadmap where status <> 'Fertig' and target_date < ${TODAY}) as roadmap_overdue`),
      q(`select status, count(*)::int as n from app_influencers group by status`),
      q(`select status, count(*)::int as n from app_companies group by status`),
      q(`select status, count(*)::int as n from app_roadmap group by status`),
      q(`select r.id, r.title, r.status, r.area, r.target_date, r.priority, u.name as assignee_name,
           (r.target_date < ${TODAY}) as overdue
         from app_roadmap r left join users u on u.id = r.assignee_id
         where r.status <> 'Fertig'
         order by (r.status = 'In Arbeit') desc, r.target_date asc nulls last,
           array_position(array['Dringend','Hoch','Normal','Niedrig']::text[], r.priority) limit 6`),
      q(`select up.*, u.name as author_name from app_updates up left join users u on u.id = up.author_id
         order by up.published_at desc, up.id desc limit 5`),
      q(`select niche, count(*)::int as n from app_influencers where niche is not null and niche <> ''
         group by niche order by n desc limit 6`),
    ]);
    return { kpi, influencers_by_status: infByStatus, companies_by_status: compByStatus, roadmap_by_status: roadByStatus, next_items: nextItems, updates, top_niches: topNiches };
  });

  // ---------- Influencer (App) ----------
  crud(route, {
    path: '/app/influencers', table: 'app_influencers', label: 'Influencer',
    select: `select i.*,
      (select count(*)::int from app_campaign_influencers a where a.influencer_id = i.id and a.status <> 'Abgesagt') as campaign_count,
      (select coalesce(sum(a.fee), 0) from app_campaign_influencers a where a.influencer_id = i.id and a.status <> 'Abgesagt') as earned
      from app_influencers i`,
    schema: {
      name: v.str({ label: 'Name', required: true, max: 120 }),
      handle: handle({ label: 'Username' }),
      platform: v.oneOf(APP_PLATFORMS, { label: 'Plattform' }),
      followers: v.int({ label: 'Follower' }),
      niche: v.str({ label: 'Nische', max: 80 }),
      city: v.str({ label: 'Ort', max: 80 }),
      email: v.email({ label: 'E-Mail' }),
      status: v.oneOf(APP_INFLUENCER_STATUSES, { label: 'Status', def: 'Interessent' }),
      source: v.str({ label: 'Quelle', max: 120 }),
      joined_at: v.date({ label: 'Registriert am' }),
      notes: v.str({ label: 'Notizen', max: 5000 }),
    },
    search: ['x.name', 'x.handle', 'x.niche', 'x.city', 'x.email'],
    filters: { status: 'x.status', platform: 'x.platform' },
    order: 'x.created_at desc, x.id desc',
  });

  // ---------- Firmen (App) ----------
  crud(route, {
    path: '/app/companies', table: 'app_companies', label: 'Firma',
    select: `select co.*,
      (select count(*)::int from app_campaigns c where c.company_id = co.id) as campaign_count,
      (select coalesce(sum(c.budget), 0) from app_campaigns c where c.company_id = co.id and c.status <> 'Abgebrochen') as campaign_budget
      from app_companies co`,
    schema: {
      name: v.str({ label: 'Firmenname', required: true, max: 160 }),
      industry: v.str({ label: 'Branche', max: 80 }),
      website: v.url({ label: 'Website' }),
      contact_name: v.str({ label: 'Ansprechpartner', max: 120 }),
      contact_email: v.email({ label: 'E-Mail' }),
      status: v.oneOf(APP_COMPANY_STATUSES, { label: 'Status', def: 'Lead' }),
      monthly_budget: v.num({ label: 'Budget pro Monat' }),
      notes: v.str({ label: 'Notizen', max: 5000 }),
    },
    search: ['x.name', 'x.industry', 'x.contact_name', 'x.contact_email'],
    filters: { status: 'x.status' },
    order: 'x.created_at desc, x.id desc',
  });

  // ---------- Kampagnen (App) ----------
  crud(route, {
    path: '/app/campaigns', table: 'app_campaigns', label: 'Kampagne',
    select: CAMPAIGN_SELECT,
    schema: {
      company_id: v.ref({ label: 'Firma' }),
      name: v.str({ label: 'Kampagnenname', required: true, max: 160 }),
      status: v.oneOf(APP_CAMPAIGN_STATUSES, { label: 'Status', def: 'Entwurf' }),
      budget: v.num({ label: 'Gesamtbudget' }),
      target_influencers: v.int({ label: 'Anzahl Influencer', max: 1000 }),
      target_niche: v.str({ label: 'Ziel-Nische', max: 80 }),
      target_platform: v.oneOf(APP_PLATFORMS, { label: 'Plattform' }),
      max_followers: v.int({ label: 'Max. Follower' }),
      start_date: v.date({ label: 'Start' }),
      end_date: v.date({ label: 'Ende' }),
      goal: v.str({ label: 'Ziel', max: 2000 }),
      notes: v.str({ label: 'Notizen', max: 5000 }),
    },
    prepare: async (data, { before }) => {
      if ('budget' in data && data.budget === null) data.budget = 0;
      if (data.company_id && !(await one(`select id from app_companies where id = $1`, [data.company_id]))) {
        throw new HttpError(422, 'Firma nicht gefunden.', { company_id: 'Ungültig.' });
      }
      const s = data.start_date ?? before?.start_date;
      const e = data.end_date ?? before?.end_date;
      if (s && e && e < s) throw new HttpError(422, 'Das Ende darf nicht vor dem Start liegen.', { end_date: 'Vor dem Start.' });
    },
    search: ['x.name', 'x.company_name', 'x.target_niche'],
    filters: { status: 'x.status', company_id: 'x.company_id' },
    order: 'x.created_at desc, x.id desc',
  });

  // Zugeordnete Influencer einer Kampagne (Budget-Aufteilung)
  route('GET', '/app/campaigns/:id/influencers', async ({ params }) => {
    const id = idParam(params.id);
    const items = await q(
      `select a.*, i.name, i.handle, i.platform, i.followers, i.niche
       from app_campaign_influencers a join app_influencers i on i.id = a.influencer_id
       where a.campaign_id = $1 order by a.created_at asc`,
      [id]
    );
    return { items };
  });

  route('POST', '/app/campaigns/:id/influencers', async ({ req, params }) => {
    const id = idParam(params.id);
    const data = validate(await readJson(req), {
      influencer_id: v.ref({ label: 'Influencer', required: true }),
      fee: v.num({ label: 'Honorar' }),
      status: v.oneOf(APP_ASSIGNMENT_STATUSES, { label: 'Status', def: 'Vorgeschlagen' }),
    });
    if (!(await one(`select id from app_campaigns where id = $1`, [id]))) throw new HttpError(404, 'Kampagne nicht gefunden.');
    if (!(await one(`select id from app_influencers where id = $1`, [data.influencer_id]))) throw new HttpError(422, 'Influencer nicht gefunden.');
    const exists = await one(`select id from app_campaign_influencers where campaign_id = $1 and influencer_id = $2`, [id, data.influencer_id]);
    if (exists) throw new HttpError(409, 'Dieser Influencer ist der Kampagne bereits zugeordnet.');
    const row = await one(
      `insert into app_campaign_influencers (campaign_id, influencer_id, fee, status) values ($1, $2, $3, $4) returning id`,
      [id, data.influencer_id, data.fee ?? 0, data.status]
    );
    return json({ id: row.id }, 201);
  });

  route('PATCH', '/app/assignments/:id', async ({ req, params }) => {
    const id = idParam(params.id);
    const data = validate(await readJson(req), {
      fee: v.num({ label: 'Honorar' }),
      status: v.oneOf(APP_ASSIGNMENT_STATUSES, { label: 'Status' }),
    }, { partial: true });
    const row = await one(
      `update app_campaign_influencers set fee = coalesce($2, fee), status = coalesce($3, status) where id = $1 returning id`,
      [id, data.fee ?? null, data.status ?? null]
    );
    if (!row) throw new HttpError(404, 'Zuordnung nicht gefunden.');
    return { ok: true };
  });

  route('DELETE', '/app/assignments/:id', async ({ params }) => {
    const row = await one(`delete from app_campaign_influencers where id = $1 returning id`, [idParam(params.id)]);
    if (!row) throw new HttpError(404, 'Zuordnung nicht gefunden.');
    return { ok: true };
  });

  // Einfaches, regelbasiertes Matching (Vorstufe zum späteren KI-Matching)
  route('GET', '/app/campaigns/:id/suggestions', async ({ params }) => {
    const c = await one(`select * from app_campaigns where id = $1`, [idParam(params.id)]);
    if (!c) throw new HttpError(404, 'Kampagne nicht gefunden.');
    const rows = await q(
      `select i.*,
         (case when $2::text is not null and i.niche ilike '%' || $2 || '%' then 50 else 0 end
          + case when $3::text is not null and i.platform = $3 then 25 else 0 end
          + case when i.status = 'Aktiv' then 15 when i.status = 'Beta-Tester' then 10 else 0 end
          + case when i.followers is not null and ($4::int is null or i.followers <= $4) then 10 else 0 end) as score
       from app_influencers i
       where i.status in ('Aktiv', 'Beta-Tester', 'Warteliste')
         and not exists (select 1 from app_campaign_influencers a where a.campaign_id = $1 and a.influencer_id = i.id)
         and ($4::int is null or i.followers is null or i.followers <= $4)
       order by score desc, i.followers desc nulls last limit 10`,
      [c.id, c.target_niche || null, c.target_platform || null, c.max_followers || null]
    );
    return { items: rows };
  });

  // ---------- Roadmap ----------
  crud(route, {
    path: '/app/roadmap', table: 'app_roadmap', label: 'Eintrag',
    select: `select r.*, u.name as assignee_name, (r.status <> 'Fertig' and r.target_date < ${TODAY}) as overdue
             from app_roadmap r left join users u on u.id = r.assignee_id`,
    schema: {
      title: v.str({ label: 'Titel', required: true, max: 200 }),
      description: v.str({ label: 'Beschreibung', max: 10000 }),
      area: v.oneOf(APP_ROADMAP_AREAS, { label: 'Bereich' }),
      status: v.oneOf(APP_ROADMAP_STATUSES, { label: 'Status', def: 'Idee' }),
      priority: v.oneOf(TASK_PRIORITIES, { label: 'Priorität', def: 'Normal' }),
      target_date: v.date({ label: 'Zieldatum' }),
      assignee_id: v.ref({ label: 'Verantwortlich' }),
    },
    prepare: async (data, { before }) => {
      if (data.assignee_id && !(await one(`select id from users where id = $1`, [data.assignee_id]))) {
        throw new HttpError(422, 'Benutzer nicht gefunden.', { assignee_id: 'Ungültig.' });
      }
      if (data.status && data.status !== before?.status) data.done_at = data.status === 'Fertig' ? new Date().toISOString() : null;
    },
    search: ['x.title', 'x.description'],
    filters: { status: 'x.status', area: 'x.area' },
    order: `array_position(array['In Arbeit','Test','Geplant','Idee','Fertig']::text[], x.status),
            x.target_date asc nulls last, array_position(array['Dringend','Hoch','Normal','Niedrig']::text[], x.priority), x.id desc`,
  });

  // ---------- Updates / Changelog ----------
  crud(route, {
    path: '/app/updates', table: 'app_updates', label: 'Update',
    select: `select up.*, u.name as author_name from app_updates up left join users u on u.id = up.author_id`,
    schema: {
      published_at: v.date({ label: 'Datum', required: true }),
      version: v.str({ label: 'Version', max: 40 }),
      type: v.oneOf(APP_UPDATE_TYPES, { label: 'Art', def: 'Notiz' }),
      title: v.str({ label: 'Titel', required: true, max: 200 }),
      body: v.str({ label: 'Text', max: 20000 }),
    },
    prepare: async (data, { user, creating }) => {
      if (creating) data.author_id = user.id;
    },
    search: ['x.title', 'x.body', 'x.version'],
    filters: { type: 'x.type' },
    order: 'x.published_at desc, x.id desc',
  });
}
