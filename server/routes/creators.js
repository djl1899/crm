import { q, one, tx, TODAY } from '../db.js';
import { HttpError, readJson, idParam, intParam, json } from '../http.js';
import { v, validate } from '../validate.js';
import { requireAdmin } from '../auth.js';
import { logActivity } from '../activity.js';
import { readUpload, randomKey, fileResponse } from '../upload.js';
import { putFile, getFile, removeFile } from '../storage.js';
import {
  CREATOR_STATUSES, OUTREACH_STATUSES, PLATFORMS, PLATFORM_KEYS, CONTRACT_STATUSES,
  ACTIVE_COLLAB_STATUSES, REVENUE_COLLAB_STATUSES, OPEN_TASK_STATUSES, AVATAR_TYPES,
} from '../../shared/constants.js';

const sqlList = (arr) => arr.map((s) => `'${s.replace(/'/g, "''")}'`).join(',');
export const ACTIVE_COLLAB_SQL = sqlList(ACTIVE_COLLAB_STATUSES);
export const REVENUE_COLLAB_SQL = sqlList(REVENUE_COLLAB_STATUSES);
export const OPEN_TASK_SQL = sqlList(OPEN_TASK_STATUSES);

export const creatorSchema = {
  display_name: v.str({ label: 'Creator Name', required: true, max: 120 }),
  first_name: v.str({ label: 'Vorname', max: 80 }),
  last_name: v.str({ label: 'Nachname', max: 80 }),
  email: v.email({ label: 'E-Mail' }),
  phone: v.str({ label: 'Telefonnummer', max: 40 }),
  city: v.str({ label: 'Ort', max: 80 }),
  region: v.str({ label: 'Region', max: 80 }),
  country: v.str({ label: 'Land', max: 80 }),
  language: v.str({ label: 'Sprache', max: 80 }),
  niche: v.str({ label: 'Nische', max: 120 }),
  interests: v.str({ label: 'Interessen', max: 1000 }),
  notes: v.str({ label: 'Notizen', max: 20000 }),
  manager_id: v.ref({ label: 'Verantwortlicher Manager' }),
  status: v.oneOf(CREATOR_STATUSES, { label: 'Creator Status', def: 'Lead' }),
  outreach_status: v.oneOf(OUTREACH_STATUSES, { label: 'Outreach Status', def: 'Noch nicht kontaktiert' }),
  contacted: v.bool({ label: 'Bereits angeschrieben' }),
  commission_rate: v.num({ label: 'Provision (%)', max: 100 }),
  bio: v.str({ label: 'Kurzvorstellung', max: 1500 }),
  size_top: v.str({ label: 'Größe Oberteil', max: 20 }),
  size_bottom: v.str({ label: 'Größe Hose', max: 20 }),
  size_shoes: v.str({ label: 'Schuhgröße', max: 20 }),
  height_cm: v.int({ label: 'Körpergröße', min: 50, max: 250 }),
  size_notes: v.str({ label: 'Hinweis zu Größen', max: 500 }),
};
const CREATOR_COLUMNS = Object.keys(creatorSchema);

const FIELD_LABELS = {
  display_name: 'Name', first_name: 'Vorname', last_name: 'Nachname', email: 'E-Mail', phone: 'Telefon',
  city: 'Ort', region: 'Region', country: 'Land', language: 'Sprache', niche: 'Nische', interests: 'Interessen',
  notes: 'Notizen', commission_rate: 'Provision', bio: 'Kurzvorstellung',
  size_top: 'Größe Oberteil', size_bottom: 'Größe Hose', size_shoes: 'Schuhgröße', height_cm: 'Körpergröße', size_notes: 'Hinweis zu Größen',
};

function normalizeUsername(raw) {
  if (raw === undefined || raw === null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/(?:instagram\.com|tiktok\.com)\/@?([^/?#\s]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@+/, '');
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(s)) throw 'Benutzername enthält ungültige Zeichen.';
  return s;
}

const socialSchema = (label) => ({
  username: (val) => {
    try { return normalizeUsername(val); } catch (m) { throw `${label}: ${m}`; }
  },
  url: v.url({ label: `${label} Profil-URL` }),
  followers: v.int({ label: `${label} Follower` }),
  engagement_rate: v.num({ label: `${label} Engagement Rate`, max: 100 }),
  notes: v.str({ label: `${label} Notizen`, max: 2000 }),
});

function validateSocials(body) {
  const out = {};
  for (const p of PLATFORMS) {
    if (!(p.key in body)) continue;
    const raw = body[p.key];
    if (raw === null) { out[p.key] = null; continue; }
    if (typeof raw !== 'object') throw new HttpError(422, `${p.label}: ungültige Daten.`);
    const data = validate(raw, socialSchema(p.label));
    if (data.username && !data.url) data.url = p.profileUrl(data.username);
    const empty = !data.username && !data.url && data.followers === null && data.engagement_rate === null && !data.notes;
    out[p.key] = empty ? null : data;
  }
  return out;
}

async function saveSocials(run, creatorId, socials) {
  for (const [platform, data] of Object.entries(socials)) {
    if (!data) {
      await run(`delete from social_accounts where creator_id = $1 and platform = $2`, [creatorId, platform]);
      continue;
    }
    await run(
      `insert into social_accounts (creator_id, platform, username, url, followers, engagement_rate, notes)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (creator_id, platform) do update set
         username = excluded.username, url = excluded.url, followers = excluded.followers,
         engagement_rate = excluded.engagement_rate, notes = excluded.notes, updated_at = now()`,
      [creatorId, platform, data.username, data.url, data.followers, data.engagement_rate, data.notes]
    );
  }
}

async function saveTags(run, creatorId, tagIds) {
  await run(`delete from creator_tags where creator_id = $1`, [creatorId]);
  if (tagIds.length) {
    await run(
      `insert into creator_tags (creator_id, tag_id) select $1, id from tags where id = any($2::int[])`,
      [creatorId, tagIds]
    );
  }
}

async function assertManager(managerId) {
  if (!managerId) return;
  const m = await one(`select id from users where id = $1`, [managerId]);
  if (!m) throw new HttpError(422, 'Der ausgewählte Manager existiert nicht.', { manager_id: 'Ungültig.' });
}

export const avatarUrl = (id, key) => (key ? `/api/creators/${id}/avatar?v=${key.slice(-8)}` : null);

// ------------------------------------------------------------------
// Liste mit serverseitiger Suche, kombinierbaren Filtern, Sortierung und Pagination
// ------------------------------------------------------------------
function buildListQuery(qs) {
  const params = [];
  const p = (val) => { params.push(val); return `$${params.length}`; };
  const where = [];

  const status = qs.get('status');
  if (status && CREATOR_STATUSES.includes(status)) where.push(`c.status = ${p(status)}`);
  else if (qs.get('archived') === 'only') where.push(`c.status = 'Archiviert'`);
  else if (qs.get('archived') !== 'include') where.push(`c.status <> 'Archiviert'`);

  const search = (qs.get('q') || '').trim();
  if (search) {
    const like = p(`%${search.replace(/^@/, '').replace(/[%_\\]/g, (m) => '\\' + m)}%`);
    where.push(`(c.display_name ilike ${like} or c.first_name ilike ${like} or c.last_name ilike ${like}
      or c.email ilike ${like} or c.city ilike ${like} or c.region ilike ${like} or c.country ilike ${like}
      or c.niche ilike ${like} or ig.username ilike ${like} or tt.username ilike ${like})`);
  }

  const outreach = qs.get('outreach_status');
  if (outreach && OUTREACH_STATUSES.includes(outreach)) where.push(`c.outreach_status = ${p(outreach)}`);

  const platform = qs.get('platform');
  if (platform === 'instagram') where.push(`ig.id is not null`);
  else if (platform === 'tiktok') where.push(`tt.id is not null`);
  else if (platform === 'both') where.push(`ig.id is not null and tt.id is not null`);

  const fp = qs.get('followers_platform') || 'any';
  const followerExpr = fp === 'instagram' ? 'coalesce(ig.followers, 0)'
    : fp === 'tiktok' ? 'coalesce(tt.followers, 0)'
    : 'greatest(coalesce(ig.followers, 0), coalesce(tt.followers, 0))';
  const minF = intParam(qs.get('min_followers'), { min: 0 });
  const maxF = intParam(qs.get('max_followers'), { min: 0 });
  if (minF !== undefined) where.push(`${followerExpr} >= ${p(minF)}`);
  if (maxF !== undefined) where.push(`${followerExpr} <= ${p(maxF)}`);

  for (const f of ['region', 'country']) {
    const val = (qs.get(f) || '').trim();
    if (val) where.push(`lower(c.${f}) = lower(${p(val)})`);
  }
  const niche = (qs.get('niche') || '').trim();
  if (niche) where.push(`c.niche ilike ${p(`%${niche}%`)}`);

  const manager = qs.get('manager_id');
  if (manager === 'none') where.push(`c.manager_id is null`);
  else if (manager) where.push(`c.manager_id = ${p(intParam(manager, { def: 0 }))}`);

  const contacted = qs.get('contacted');
  if (contacted === 'yes') where.push(`c.contacted = true`);
  if (contacted === 'no') where.push(`c.contacted = false`);

  const activeCollab = qs.get('active_collab');
  const activeExists = `exists (select 1 from collaborations co where co.creator_id = c.id and co.status in (${ACTIVE_COLLAB_SQL}))`;
  if (activeCollab === 'yes') where.push(activeExists);
  if (activeCollab === 'no') where.push(`not ${activeExists}`);

  const hasContract = qs.get('has_contract');
  if (hasContract === 'yes') where.push(`coalesce(ct.status, 'Kein Vertrag') <> 'Kein Vertrag'`);
  if (hasContract === 'no') where.push(`coalesce(ct.status, 'Kein Vertrag') = 'Kein Vertrag'`);

  const contractStatus = qs.get('contract_status');
  if (contractStatus && CONTRACT_STATUSES.includes(contractStatus)) where.push(`coalesce(ct.status, 'Kein Vertrag') = ${p(contractStatus)}`);

  const tagIds = (qs.get('tags') || '').split(',').map((x) => parseInt(x, 10)).filter((n) => n > 0);
  for (const t of tagIds) where.push(`exists (select 1 from creator_tags x where x.creator_id = c.id and x.tag_id = ${p(t)})`);

  const sortMap = {
    name: 'lower(c.display_name)',
    followers: 'greatest(coalesce(ig.followers, 0), coalesce(tt.followers, 0))',
    instagram_followers: 'coalesce(ig.followers, -1)',
    tiktok_followers: 'coalesce(tt.followers, -1)',
    status: `array_position(array[${sqlList(CREATOR_STATUSES)}]::text[], c.status)`,
    last_activity: 'c.last_activity_at',
    created: 'c.created_at',
  };
  const sortKey = sortMap[qs.get('sort')] ? qs.get('sort') : 'last_activity';
  const dir = qs.get('dir') === 'asc' ? 'asc' : qs.get('dir') === 'desc' ? 'desc' : sortKey === 'name' ? 'asc' : 'desc';
  const orderBy = `${sortMap[sortKey]} ${dir} nulls last, c.id desc`;

  return { params, p, where: where.length ? `where ${where.join(' and ')}` : '', orderBy };
}

export default function register(route) {
  route('GET', '/creators', async ({ query }) => {
    const pageSize = intParam(query.get('page_size'), { min: 1, max: 100, def: 25 });
    const page = intParam(query.get('page'), { min: 1, def: 1 });
    const { params, p, where, orderBy } = buildListQuery(query);
    const rows = await q(
      `select c.id, c.display_name, c.first_name, c.last_name, c.email, c.city, c.region, c.country, c.niche,
        c.status, c.outreach_status, c.contacted, c.notes, c.avatar_key, c.last_activity_at, c.created_at,
        c.manager_id, u.name as manager_name,
        ig.username as instagram_username, ig.url as instagram_url, ig.followers as instagram_followers,
        tt.username as tiktok_username, tt.url as tiktok_url, tt.followers as tiktok_followers,
        coalesce(ct.status, 'Kein Vertrag') as contract_status,
        (select count(*)::int from collaborations co where co.creator_id = c.id and co.status in (${ACTIVE_COLLAB_SQL})) as active_collabs,
        (select coalesce(json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) order by t.name), '[]'::json)
           from creator_tags x join tags t on t.id = x.tag_id where x.creator_id = c.id) as tags,
        count(*) over() as total_count
       from creators c
       left join users u on u.id = c.manager_id
       left join social_accounts ig on ig.creator_id = c.id and ig.platform = 'instagram'
       left join social_accounts tt on tt.creator_id = c.id and tt.platform = 'tiktok'
       left join contracts ct on ct.creator_id = c.id
       ${where}
       order by ${orderBy}
       limit ${p(pageSize)} offset ${p((page - 1) * pageSize)}`,
      params
    );
    const total = rows[0] ? Number(rows[0].total_count) : 0;
    const items = rows.map(({ total_count, avatar_key, ...r }) => ({ ...r, avatar_url: avatarUrl(r.id, avatar_key) }));
    return { items, total, page, page_size: pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
  });

  route('GET', '/creators/filter-options', async () => {
    const distinct = (col) =>
      q(`select distinct ${col} as v from creators where ${col} is not null and ${col} <> '' order by 1 limit 300`).then((r) => r.map((x) => x.v));
    const [regions, countries, niches, languages, cities] = await Promise.all([
      distinct('region'), distinct('country'), distinct('niche'), distinct('language'), distinct('city'),
    ]);
    return { regions, countries, niches, languages, cities };
  });

  // Schlanke Liste für Auswahlfelder (z. B. Aufgabe → Creator)
  route('GET', '/creators/options', async ({ query }) => {
    const s = (query.get('q') || '').trim();
    const rows = await q(
      `select id, display_name, status from creators
       where ($1 = '' or display_name ilike '%' || $1 || '%')
       order by (status = 'Archiviert'), lower(display_name) limit 500`,
      [s]
    );
    return { items: rows };
  });

  route('POST', '/creators', async ({ req, user }) => {
    const body = await readJson(req);
    const data = validate(body, creatorSchema);
    const socials = validateSocials(body);
    const tagIds = v.ids({ label: 'Tags' })(body.tag_ids);
    await assertManager(data.manager_id);
    if (data.outreach_status !== 'Noch nicht kontaktiert' && body.contacted === undefined) data.contacted = true;

    const creator = await tx(async (run) => {
      const cols = [...CREATOR_COLUMNS, 'created_by'];
      const values = [...CREATOR_COLUMNS.map((k) => data[k]), user.id];
      const rows = await run(
        `insert into creators (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id, display_name`,
        values
      );
      const c = rows[0];
      await saveSocials(run, c.id, socials);
      await saveTags(run, c.id, tagIds);
      await logActivity({ creatorId: c.id, userId: user.id, entityType: 'creator', entityId: c.id, action: 'creator_created', message: `hat den Creator „${c.display_name}“ angelegt.` }, run);
      return c;
    });
    return json({ creator }, 201);
  });

  route('GET', '/creators/:id', async ({ params }) => {
    const id = idParam(params.id);
    const c = await one(
      `select c.*, u.name as manager_name, cb.name as created_by_name
       from creators c left join users u on u.id = c.manager_id left join users cb on cb.id = c.created_by
       where c.id = $1`,
      [id]
    );
    if (!c) throw new HttpError(404, 'Creator nicht gefunden.');
    const [socialRows, tags, contract, stats, lastContact, nextFollowUp] = await Promise.all([
      q(`select platform, username, url, followers, engagement_rate, notes, updated_at from social_accounts where creator_id = $1`, [id]),
      q(`select t.id, t.name, t.color from creator_tags x join tags t on t.id = x.tag_id where x.creator_id = $1 order by t.name`, [id]),
      one(`select * from contracts where creator_id = $1`, [id]),
      one(
        `select
          (select coalesce(sum(fee), 0) from collaborations where creator_id = $1 and status in (${REVENUE_COLLAB_SQL})) as total_revenue,
          (select coalesce(sum(fee), 0) from collaborations where creator_id = $1 and status in (${REVENUE_COLLAB_SQL}) and invoice_status = 'Bezahlt') as paid_revenue,
          (select coalesce(sum(agency_fee), 0) from collab_finance where creator_id = $1 and status in (${REVENUE_COLLAB_SQL})) as agency_revenue,
          (select coalesce(sum(payout), 0) from collab_finance where creator_id = $1 and status in (${REVENUE_COLLAB_SQL}) and payout_status = 'Offen') as payout_open,
          (select coalesce(sum(fee), 0) from collaborations where creator_id = $1 and status in (${REVENUE_COLLAB_SQL}) and invoice_status in ('Offen', 'Eingereicht', 'Überfällig')) as open_invoices,
          (select count(*)::int from collaborations where creator_id = $1) as collab_count,
          (select count(*)::int from collaborations where creator_id = $1 and status in (${ACTIVE_COLLAB_SQL})) as active_collabs,
          (select count(*)::int from tasks where creator_id = $1 and status in (${OPEN_TASK_SQL})) as open_tasks,
          (select count(*)::int from tasks where creator_id = $1 and status in (${OPEN_TASK_SQL}) and due_date < ${TODAY}) as overdue_tasks,
          (select count(*)::int from documents where creator_id = $1) as document_count,
          (select count(*)::int from outreach_activities where creator_id = $1) as outreach_count`,
        [id]
      ),
      one(`select occurred_at, channel, result from outreach_activities where creator_id = $1 order by occurred_at desc limit 1`, [id]),
      one(`select id, follow_up_date from outreach_activities where creator_id = $1 and follow_up_done = false and follow_up_date is not null order by follow_up_date asc limit 1`, [id]),
    ]);
    const socials = {};
    for (const p of PLATFORM_KEYS) socials[p] = socialRows.find((s) => s.platform === p) || null;
    const { avatar_key, ...rest } = c;
    return {
      creator: { ...rest, avatar_url: avatarUrl(id, avatar_key) },
      socials,
      tags,
      contract: contract || { creator_id: id, status: 'Kein Vertrag' },
      stats,
      last_contact: lastContact,
      next_follow_up: nextFollowUp,
    };
  });

  route('PATCH', '/creators/:id', async ({ req, params, user }) => {
    const id = idParam(params.id);
    const body = await readJson(req);
    const data = validate(body, creatorSchema, { partial: true });
    const socials = validateSocials(body);
    const tagIds = 'tag_ids' in body ? v.ids({ label: 'Tags' })(body.tag_ids) : null;
    const before = await one(`select c.*, u.name as manager_name from creators c left join users u on u.id = c.manager_id where c.id = $1`, [id]);
    if (!before) throw new HttpError(404, 'Creator nicht gefunden.');
    if ('manager_id' in data) await assertManager(data.manager_id);
    const beforeSocials = await q(`select platform, username, url, followers, engagement_rate, notes from social_accounts where creator_id = $1`, [id]);
    const beforeTags = await q(`select tag_id from creator_tags where creator_id = $1`, [id]);

    await tx(async (run) => {
      const keys = Object.keys(data);
      if (keys.length) {
        await run(
          `update creators set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`,
          [id, ...keys.map((k) => data[k])]
        );
      }
      await saveSocials(run, id, socials);
      if (tagIds) await saveTags(run, id, tagIds);

      // Aktivitäten protokollieren
      const log = (action, message) => logActivity({ creatorId: id, userId: user.id, entityType: 'creator', entityId: id, action, message }, run);
      if (data.status && data.status !== before.status) {
        await log(data.status === 'Archiviert' ? 'creator_archived' : 'creator_status_changed',
          data.status === 'Archiviert' ? 'hat den Creator archiviert.' : `hat den Status von '${before.status}' auf '${data.status}' geändert.`);
      }
      if (data.outreach_status && data.outreach_status !== before.outreach_status) {
        await log('outreach_status_changed', `hat den Outreach-Status von '${before.outreach_status}' auf '${data.outreach_status}' geändert.`);
      }
      if ('contacted' in data && data.contacted !== before.contacted) {
        await log('contacted_changed', `hat „Bereits angeschrieben“ auf '${data.contacted ? 'Ja' : 'Nein'}' gesetzt.`);
      }
      if ('manager_id' in data && data.manager_id !== before.manager_id) {
        const m = data.manager_id ? await run(`select name from users where id = $1`, [data.manager_id]) : [];
        await log('manager_changed', `hat den verantwortlichen Manager auf '${m[0]?.name || 'niemand'}' gesetzt.`);
      }
      const changed = Object.keys(FIELD_LABELS).filter((k) => k in data && (data[k] ?? null) !== (before[k] ?? null));
      const norm = (x) => (x ? JSON.stringify([x.username, x.url, x.followers, x.engagement_rate === null ? null : Number(x.engagement_rate), x.notes]) : null);
      const socialChanged = Object.keys(socials)
        .filter((k) => norm(socials[k]) !== norm(beforeSocials.find((s) => s.platform === k)))
        .map((k) => PLATFORMS.find((p) => p.key === k).label);
      const tagsChanged = tagIds && [...tagIds].sort().join(',') !== beforeTags.map((t) => t.tag_id).sort().join(',');
      const parts = [...changed.map((k) => FIELD_LABELS[k]), ...socialChanged, ...(tagsChanged ? ['Tags'] : [])];
      if (parts.length) await log('creator_updated', `hat den Creator bearbeitet (${parts.join(', ')}).`);
    });
    return { ok: true };
  });

  // Endgültig löschen (nur Admin). Archivieren erfolgt über Status "Archiviert".
  route('DELETE', '/creators/:id', async ({ params, user }) => {
    requireAdmin(user);
    const id = idParam(params.id);
    const c = await one(`select id, display_name, avatar_key from creators where id = $1`, [id]);
    if (!c) throw new HttpError(404, 'Creator nicht gefunden.');
    const docs = await q(`select blob_key from documents where creator_id = $1`, [id]);
    await q(`delete from creators where id = $1`, [id]);
    await Promise.all([...docs.map((d) => removeFile(d.blob_key)), c.avatar_key ? removeFile(c.avatar_key) : null]);
    await logActivity({ userId: user.id, entityType: 'creator', entityId: id, action: 'creator_deleted', message: `hat den Creator „${c.display_name}“ endgültig gelöscht.` });
    return { ok: true };
  });

  // Profilbild
  route('POST', '/creators/:id/avatar', async ({ req, params, user }) => {
    const id = idParam(params.id);
    const c = await one(`select id, avatar_key from creators where id = $1`, [id]);
    if (!c) throw new HttpError(404, 'Creator nicht gefunden.');
    const up = await readUpload(req, { allowedMimes: AVATAR_TYPES, maxBytes: 3 * 1024 * 1024 });
    const key = `avatars/${id}/${randomKey()}`;
    await putFile(key, up.buffer, { mime: up.mime, filename: up.filename });
    await q(`update creators set avatar_key = $2, updated_at = now() where id = $1`, [id, key]);
    if (c.avatar_key) await removeFile(c.avatar_key);
    await logActivity({ creatorId: id, userId: user.id, entityType: 'creator', entityId: id, action: 'avatar_updated', message: 'hat das Profilbild aktualisiert.' });
    return { avatar_url: avatarUrl(id, key) };
  });

  route('DELETE', '/creators/:id/avatar', async ({ params, user }) => {
    const id = idParam(params.id);
    const c = await one(`select avatar_key from creators where id = $1`, [id]);
    if (!c) throw new HttpError(404, 'Creator nicht gefunden.');
    if (c.avatar_key) {
      await q(`update creators set avatar_key = null where id = $1`, [id]);
      await removeFile(c.avatar_key);
      await logActivity({ creatorId: id, userId: user.id, entityType: 'creator', entityId: id, action: 'avatar_removed', message: 'hat das Profilbild entfernt.' });
    }
    return { ok: true };
  });

  route('GET', '/creators/:id/avatar', async ({ params }) => {
    const id = idParam(params.id);
    const c = await one(`select avatar_key from creators where id = $1`, [id]);
    if (!c || !c.avatar_key) throw new HttpError(404, 'Kein Profilbild.');
    const f = await getFile(c.avatar_key);
    if (!f) throw new HttpError(404, 'Kein Profilbild.');
    return fileResponse(f.data, { filename: 'avatar', mime: f.metadata.mime || 'image/jpeg', inline: true, cache: 'private, max-age=86400' });
  });

  route('GET', '/creators/:id/activities', async ({ params, query }) => {
    const id = idParam(params.id);
    const limit = intParam(query.get('limit'), { min: 1, max: 200, def: 100 });
    const rows = await q(
      `select a.id, a.action, a.message, a.entity_type, a.entity_id, a.created_at, u.name as user_name
       from activities a left join users u on u.id = a.user_id
       where a.creator_id = $1 order by a.created_at desc, a.id desc limit $2`,
      [id, limit]
    );
    return { items: rows };
  });

  // ---------- CSV-Import (Zeilen kommen bereits aus dem Browser zerlegt an) ----------
  route('POST', '/creators/import', async ({ req, user }) => {
    const body = await readJson(req);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) throw new HttpError(422, 'Keine Zeilen zum Importieren.');
    if (rows.length > 200) throw new HttpError(422, 'Bitte höchstens 200 Zeilen pro Anfrage senden.');
    const skipDuplicates = body.skip_duplicates !== false;
    const offset = Number(body.offset) || 0;

    const users = await q(`select id, lower(name) as name, lower(email) as email from users`);
    const tagRows = await q(`select id, lower(name) as name from tags`);
    const tagMap = new Map(tagRows.map((t) => [t.name, t.id]));
    const result = { created: 0, skipped: [], errors: [] };

    const parseCount = (val) => {
      if (val === undefined || val === null || String(val).trim() === '') return null;
      let s = String(val).trim().toLowerCase().replace(/\s/g, '');
      let mult = 1;
      if (/(mio|m)$/.test(s)) { mult = 1_000_000; s = s.replace(/(mio\.?|m)$/, ''); }
      else if (/(tsd|k)$/.test(s)) { mult = 1000; s = s.replace(/(tsd\.?|k)$/, ''); }
      if (mult > 1) s = s.replace(',', '.');
      else s = s.replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.');
      const n = Number(s) * mult;
      return Number.isFinite(n) ? Math.round(n) : val;
    };

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i] || {};
      const line = offset + i + 2; // +2: Kopfzeile + 1-basiert
      const name = String(raw.display_name || [raw.first_name, raw.last_name].filter(Boolean).join(' ') || raw.instagram || raw.tiktok || '').trim();
      try {
        const input = {
          display_name: name,
          first_name: raw.first_name, last_name: raw.last_name, email: raw.email, phone: raw.phone,
          city: raw.city, region: raw.region, country: raw.country, language: raw.language,
          niche: raw.niche, interests: raw.interests, notes: raw.notes,
          status: CREATOR_STATUSES.find((st) => st.toLowerCase() === String(raw.status || '').trim().toLowerCase()) || 'Lead',
          outreach_status: 'Noch nicht kontaktiert', contacted: false,
          commission_rate: raw.commission_rate,
        };
        const m = String(raw.manager || '').trim().toLowerCase();
        if (m) {
          const u = users.find((x) => x.email === m || x.name === m || x.name.split(' ')[0] === m);
          if (u) input.manager_id = u.id;
        }
        const data = validate(input, creatorSchema);
        const socials = validateSocials({
          instagram: raw.instagram || raw.instagram_followers ? { username: raw.instagram, followers: parseCount(raw.instagram_followers), url: raw.instagram_url } : null,
          tiktok: raw.tiktok || raw.tiktok_followers ? { username: raw.tiktok, followers: parseCount(raw.tiktok_followers), url: raw.tiktok_url } : null,
        });

        if (skipDuplicates) {
          const ig = socials.instagram?.username?.toLowerCase();
          const tt = socials.tiktok?.username?.toLowerCase();
          const dup = await one(
            `select c.id, c.display_name from creators c
             where lower(c.display_name) = lower($1)
                or ($2::text is not null and lower(c.email) = $2)
                or ($3::text is not null and exists (select 1 from social_accounts s where s.creator_id = c.id and s.platform = 'instagram' and lower(s.username) = $3))
                or ($4::text is not null and exists (select 1 from social_accounts s where s.creator_id = c.id and s.platform = 'tiktok' and lower(s.username) = $4))
             limit 1`,
            [data.display_name, data.email, ig || null, tt || null]
          );
          if (dup) {
            result.skipped.push({ line, name: data.display_name, reason: `bereits vorhanden („${dup.display_name}“)` });
            continue;
          }
        }

        const tagIds = [];
        for (const tn of String(raw.tags || '').split(/[,;|]/).map((x) => x.trim()).filter(Boolean).slice(0, 20)) {
          let tid = tagMap.get(tn.toLowerCase());
          if (!tid) {
            const t = await one(`insert into tags (name) values ($1) on conflict (lower(name)) do update set name = tags.name returning id`, [tn.slice(0, 40)]);
            tid = t.id;
            tagMap.set(tn.toLowerCase(), tid);
          }
          tagIds.push(tid);
        }

        await tx(async (run) => {
          const cols = [...CREATOR_COLUMNS, 'created_by'];
          const created = await run(
            `insert into creators (${cols.join(', ')}) values (${cols.map((_, k) => `$${k + 1}`).join(', ')}) returning id`,
            [...CREATOR_COLUMNS.map((k) => data[k] ?? null), user.id]
          );
          const id = created[0].id;
          await saveSocials(run, id, socials);
          await saveTags(run, id, tagIds);
          await logActivity({ creatorId: id, userId: user.id, entityType: 'creator', entityId: id, action: 'creator_created', message: `hat den Creator „${data.display_name}“ per CSV-Import angelegt.` }, run);
        });
        result.created++;
      } catch (err) {
        if (err instanceof HttpError) result.errors.push({ line, name: name || '(ohne Name)', reason: err.message });
        else throw err;
      }
    }
    return result;
  });
}
