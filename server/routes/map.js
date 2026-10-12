// Karte: Creator und Firmen (Listen-Kontakte) mit Koordinaten, Kategorien und Filtern
import { q, one, tx } from '../db.js';
import { HttpError, readJson, idParam, json } from '../http.js';
import { v, validate } from '../validate.js';
import { logActivity } from '../activity.js';
import { namesSql } from '../team.js';
import { avatarUrl } from './creators.js';
import { placeKey, lookupPlace, toCategories } from '../../shared/geo.js';

const num = (x) => (x === null || x === undefined ? null : Number(x));
const cityKey = (city, country) => placeKey(`${city}|${country || 'de'}`);
const COUNTRY_CODES = { deutschland: 'de', germany: 'de', österreich: 'at', austria: 'at', schweiz: 'ch', switzerland: 'ch' };
const countryCode = (c) => COUNTRY_CODES[placeKey(c)] || (c ? placeKey(c).slice(0, 2) : 'de');

/** Position bestimmen: manuell > Adresse (Cache) > Ort (Cache/Verzeichnis). Fehlt etwas, kommt es in `missing`. */
function resolver(cache) {
  const missing = new Map();
  const resolve = ({ lat, lng, address, city, country }) => {
    if (lat !== null && lat !== undefined && lng !== null && lng !== undefined) return { lat: Number(lat), lng: Number(lng), precision: 'manual' };
    const cc = countryCode(country);
    if (address && city) {
      const ak = placeKey(`${address}|${city}|${cc}`);
      const hit = cache.get(ak);
      if (hit && hit.lat !== null) return { lat: hit.lat, lng: hit.lng, precision: 'address' };
      if (!hit) missing.set(ak, { key: ak, query: `${address}, ${city}`, country: cc, kind: 'address' });
    }
    if (city) {
      const ck = cityKey(city, cc);
      const hit = cache.get(ck);
      if (hit && hit.lat !== null) return { lat: hit.lat, lng: hit.lng, precision: 'city' };
      const g = cc === 'de' || cc === 'at' || cc === 'ch' ? lookupPlace(city) : null;
      if (g) return { lat: g.lat, lng: g.lng, precision: 'city' };
      if (!hit) missing.set(ck, { key: ck, query: city, country: cc, kind: 'city' });
    }
    return null;
  };
  return { resolve, missing };
}

// Koordinate mit 6 Nachkommastellen (v.num rundet auf 2 – zu grob für die Karte)
const coord = (label, max) => (val) => {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || Math.abs(n) > max) throw `${label}: ungültiger Wert.`;
  return Math.round(n * 1e6) / 1e6;
};

const positionSchema = {
  type: v.oneOf(['creator', 'firm'], { label: 'Typ', required: true }),
  id: v.ref({ label: 'ID', required: true }),
  lat: coord('Breitengrad', 90),
  lng: coord('Längengrad', 180),
};

async function appTablesPresent() {
  const r = await one(`select to_regclass('public.app_influencers') is not null as inf, to_regclass('public.app_companies') is not null as comp`);
  return r || { inf: false, comp: false };
}

const noteField = (notes, label) => {
  const m = String(notes || '').match(new RegExp(`^${label}:\\s*(.+)$`, 'mi'));
  return m ? m[1].trim() : null;
};

export default function register(route) {
  route('GET', '/map', async ({ query }) => {
    const withArchived = query.get('archived') === '1';
    const cacheRows = await q(`select key, lat, lng from geo_places`);
    const cache = new Map(cacheRows.map((r) => [r.key, { lat: num(r.lat), lng: num(r.lng) }]));
    const { resolve, missing } = resolver(cache);

    const creators = await q(
      `select c.id, c.display_name, c.city, c.region, c.country, c.niche, c.status, c.lat, c.lng, c.avatar_key,
         ${namesSql('c.manager_ids')} as manager_name,
         ig.username as ig_user, ig.followers as ig_followers, tt.username as tt_user, tt.followers as tt_followers
       from creators c
       left join social_accounts ig on ig.creator_id = c.id and ig.platform = 'instagram'
       left join social_accounts tt on tt.creator_id = c.id and tt.platform = 'tiktok'
       ${withArchived ? '' : `where c.status <> 'Archiviert'`}
       order by lower(c.display_name)`
    );
    const firms = await q(
      `select lc.id, lc.list_id, l.name as list_name, l.color as list_color, lc.company, lc.name as contact_name, lc.position,
         lc.city, lc.address, lc.category, lc.industry, lc.status, lc.lat, lc.lng, lc.instagram, lc.website, lc.email, lc.phone
       from list_contacts lc join contact_lists l on l.id = lc.list_id
       order by lower(coalesce(lc.company, lc.name, ''))`
    );

    const items = [];
    for (const c of creators) {
      const pos = resolve({ lat: c.lat, lng: c.lng, city: c.city || c.region, country: c.country });
      items.push({
        type: 'creator', id: c.id, key: `c${c.id}`, title: c.display_name, city: c.city || c.region || null,
        categories: toCategories(c.niche), niche: c.niche, status: c.status, manager: c.manager_name,
        avatar_url: avatarUrl(c.id, c.avatar_key), followers: Math.max(c.ig_followers || 0, c.tt_followers || 0) || null,
        instagram: c.ig_user, tiktok: c.tt_user, link: `/creators/${c.id}`, ...(pos || { lat: null, lng: null, precision: null }),
      });
    }
    for (const f of firms) {
      const pos = resolve({ lat: f.lat, lng: f.lng, address: f.address, city: f.city, country: 'de' });
      items.push({
        type: 'firm', id: f.id, key: `f${f.id}`, title: f.company || f.contact_name, city: f.city, address: f.address,
        categories: [...new Set([...(f.category ? toCategories(f.category).slice(0, 1) : []), ...toCategories(f.industry, { strict: true })])], industry: f.industry, status: f.status, contact: f.company ? f.contact_name : null,
        position: f.position, list_id: f.list_id, list_name: f.list_name, list_color: f.list_color, instagram: f.instagram, website: f.website,
        link: `/listen/${f.list_id}`, ...(pos || { lat: null, lng: null, precision: null }),
      });
    }

    let appImport = null;
    const t = await appTablesPresent();
    if (t.inf || t.comp) {
      const [inf, comp] = await Promise.all([
        t.inf ? one(`select count(*)::int as n from app_influencers a where not exists (select 1 from creators c where lower(c.display_name) = lower(a.name))`) : { n: 0 },
        t.comp ? one(`select count(*)::int as n from app_companies a where not exists (select 1 from list_contacts lc where lower(lc.company) = lower(a.name))`) : { n: 0 },
      ]);
      if (inf.n || comp.n) appImport = { creators: inf.n, firms: comp.n };
    }
    return { items, missing: [...missing.values()].slice(0, 60), app_import: appImport };
  });

  // Ergebnis einer Ortssuche (vom Browser über OpenStreetMap) speichern
  route('POST', '/map/places', async ({ req }) => {
    const body = await readJson(req);
    const list = Array.isArray(body?.places) ? body.places.slice(0, 50) : [];
    let saved = 0;
    for (const p of list) {
      const key = placeKey(p.key);
      if (!key || key.length > 300) continue;
      const lat = p.lat === null || p.lat === undefined ? null : Number(p.lat);
      const lng = p.lng === null || p.lng === undefined ? null : Number(p.lng);
      if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180)) continue;
      await q(
        `insert into geo_places (key, query, label, lat, lng, source) values ($1, $2, $3, $4, $5, $6)
         on conflict (key) do update set query = excluded.query, label = excluded.label, lat = excluded.lat, lng = excluded.lng, source = excluded.source`,
        [key, String(p.query || '').slice(0, 300), String(p.label || '').slice(0, 300), lat, lat === null ? null : lng, lat === null ? 'none' : 'osm']
      );
      saved++;
    }
    return { saved };
  });

  // Position eines Eintrags von Hand setzen (Pin verschieben) oder zurücksetzen (lat/lng = null)
  route('PATCH', '/map/position', async ({ req, user }) => {
    const data = validate(await readJson(req), positionSchema);
    if ((data.lat === null) !== (data.lng === null)) throw new HttpError(422, 'Bitte Breiten- und Längengrad angeben.');
    const table = data.type === 'creator' ? 'creators' : 'list_contacts';
    const row = await one(`update ${table} set lat = $2, lng = $3, updated_at = now() where id = $1 returning id`, [data.id, data.lat, data.lng]);
    if (!row) throw new HttpError(404, 'Eintrag nicht gefunden.');
    if (data.type === 'creator') {
      await logActivity({ creatorId: data.id, userId: user.id, entityType: 'creator', entityId: data.id, action: 'map_position', message: data.lat === null ? 'hat die Kartenposition zurückgesetzt.' : 'hat die Position auf der Karte angepasst.' });
    }
    return { ok: true };
  });

  // Daten aus dem früheren App-Bereich übernehmen (Creator → Creator als Lead, Firmen → Liste)
  route('POST', '/map/app-import', async ({ user }) => {
    const t = await appTablesPresent();
    if (!t.inf && !t.comp) throw new HttpError(404, 'Keine Daten aus dem App-Bereich vorhanden.');
    const result = await tx(async (run) => {
      let creators = 0;
      let firms = 0;
      if (t.inf) {
        const rows = await run(`select * from app_influencers a where not exists (select 1 from creators c where lower(c.display_name) = lower(a.name)) order by a.id`);
        for (const a of rows) {
          const status = a.status === 'Inaktiv' ? 'Archiviert' : 'Lead';
          const notes = [a.notes, a.source ? `Quelle: ${a.source}` : null, 'Übernommen aus dem früheren App-Bereich.'].filter(Boolean).join('\n');
          const c = (await run(
            `insert into creators (display_name, city, country, niche, notes, status, outreach_status, contacted, email, created_by)
             values ($1, $2, 'Deutschland', $3, $4, $5, 'Noch nicht kontaktiert', false, $6, $7) returning id`,
            [a.name, a.city, a.niche, notes, status, a.email, user.id]
          ))[0];
          const platform = String(a.platform || '').toLowerCase();
          if (['instagram', 'tiktok'].includes(platform) && (a.handle || a.followers)) {
            const url = a.handle ? (platform === 'instagram' ? `https://www.instagram.com/${a.handle}/` : `https://www.tiktok.com/@${a.handle}`) : null;
            await run(`insert into social_accounts (creator_id, platform, username, url, followers) values ($1, $2, $3, $4, $5) on conflict (creator_id, platform) do nothing`,
              [c.id, platform, a.handle, url, a.followers]);
          }
          creators++;
        }
      }
      if (t.comp) {
        const rows = await run(`select * from app_companies a where not exists (select 1 from list_contacts lc where lower(lc.company) = lower(a.name)) order by a.id`);
        if (rows.length) {
          let list = (await run(`select id from contact_lists where name = 'Firmen aus der Recherche' limit 1`))[0];
          if (!list) list = (await run(`insert into contact_lists (name, description, color, created_by) values ('Firmen aus der Recherche', 'Übernommen aus dem früheren App-Bereich – Barter-Kandidaten für kleine Creator.', 'amber', $1) returning id`, [user.id]))[0];
          for (const a of rows) {
            const city = noteField(a.notes, 'Ort');
            const address = noteField(a.notes, 'Adresse');
            const cats = toCategories(a.industry, { strict: true });
            const rest = String(a.notes || '').split('\n').filter((l) => !/^(Ort|Adresse):/i.test(l)).join('\n');
            await run(
              `insert into list_contacts (list_id, company, name, email, website, city, address, category, industry, status, notes, created_by)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Neu',$10,$11)`,
              [list.id, a.name, a.contact_name, a.contact_email, a.website, city, address ? address.replace(/\s*\(.*\)\s*$/, '') : null, cats[0] || null, a.industry, rest || null, user.id]
            );
            firms++;
          }
        }
      }
      return { creators, firms };
    });
    await logActivity({ userId: user.id, entityType: 'map', action: 'app_import', message: `hat ${result.creators} Creator und ${result.firms} Firmen aus dem App-Bereich übernommen.` });
    return result;
  });
}
