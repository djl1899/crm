// Team: Kontaktlisten (z. B. Ansprechpartner bei Firmen, Event-Kontakte, Presse)
import { q, one } from '../db.js';
import { HttpError, readJson, idParam, json } from '../http.js';
import { v, validate } from '../validate.js';
import { logActivity } from '../activity.js';
import { TAG_COLORS, CONTACT_STATUSES } from '../../shared/constants.js';

const listSchema = {
  name: v.str({ label: 'Name der Liste', required: true, max: 80 }),
  description: v.str({ label: 'Beschreibung', max: 1000 }),
  color: v.oneOf(TAG_COLORS, { label: 'Farbe', def: 'blue' }),
};

const contactSchema = {
  company: v.str({ label: 'Firma', max: 160 }),
  name: v.str({ label: 'Ansprechpartner', max: 160 }),
  position: v.str({ label: 'Position', max: 120 }),
  email: v.email({ label: 'E-Mail' }),
  phone: v.str({ label: 'Telefon', max: 60 }),
  website: v.str({ label: 'Website', max: 300 }),
  instagram: v.str({ label: 'Instagram', max: 120 }),
  city: v.str({ label: 'Ort', max: 120 }),
  status: v.oneOf(CONTACT_STATUSES, { label: 'Status', def: 'Neu' }),
  notes: v.str({ label: 'Notizen', max: 5000 }),
  last_contacted_on: v.date({ label: 'Zuletzt kontaktiert' }),
};
const CONTACT_COLS = Object.keys(contactSchema);

const csvCell = (x) => {
  const s = x === null || x === undefined ? '' : String(x);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const CSV_HEADERS = ['Firma', 'Ansprechpartner', 'Position', 'E-Mail', 'Telefon', 'Website', 'Instagram', 'Ort', 'Status', 'Notizen', 'Zuletzt kontaktiert'];

function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const HEADER_MAP = {
  firma: 'company', company: 'company', unternehmen: 'company', marke: 'company',
  ansprechpartner: 'name', name: 'name', kontakt: 'name',
  position: 'position', rolle: 'position',
  'e-mail': 'email', email: 'email', mail: 'email',
  telefon: 'phone', phone: 'phone', tel: 'phone',
  website: 'website', web: 'website',
  instagram: 'instagram', insta: 'instagram',
  ort: 'city', stadt: 'city', city: 'city',
  status: 'status', notizen: 'notes', notiz: 'notes', notes: 'notes',
};

async function loadList(id) {
  const list = await one(
    `select l.*, u.name as created_by_name, (select count(*)::int from list_contacts c where c.list_id = l.id) as contact_count
     from contact_lists l left join users u on u.id = l.created_by where l.id = $1`,
    [id]
  );
  if (!list) throw new HttpError(404, 'Liste nicht gefunden.');
  return list;
}

export default function register(route) {
  route('GET', '/lists', async () => {
    const lists = await q(
      `select l.id, l.name, l.description, l.color, l.updated_at,
         (select count(*)::int from list_contacts c where c.list_id = l.id) as contact_count
       from contact_lists l order by lower(l.name)`
    );
    return { lists, statuses: CONTACT_STATUSES, colors: TAG_COLORS };
  });

  route('POST', '/lists', async ({ req, user }) => {
    const data = validate(await readJson(req), listSchema);
    const list = await one(`insert into contact_lists (name, description, color, created_by) values ($1,$2,$3,$4) returning id`, [data.name, data.description, data.color, user.id]);
    await logActivity({ userId: user.id, entityType: 'list', entityId: list.id, action: 'list_created', message: `hat die Liste „${data.name}“ erstellt.` });
    return json({ list: await loadList(list.id) }, 201);
  });

  route('GET', '/lists/:id', async ({ params, query }) => {
    const id = idParam(params.id);
    const list = await loadList(id);
    const search = String(query.get('q') || '').trim();
    const status = query.get('status');
    const args = [id];
    let where = '';
    if (search) {
      args.push(`%${search.toLowerCase()}%`);
      where += ` and lower(concat_ws(' ', company, name, position, email, city, instagram, notes)) like $${args.length}`;
    }
    if (status && CONTACT_STATUSES.includes(status)) {
      args.push(status);
      where += ` and status = $${args.length}`;
    }
    const contacts = await q(`select * from list_contacts where list_id = $1 ${where} order by lower(coalesce(company, name, '')), id`, args);
    return { list, contacts, statuses: CONTACT_STATUSES };
  });

  route('PATCH', '/lists/:id', async ({ req, params }) => {
    const id = idParam(params.id);
    const data = validate(await readJson(req), listSchema, { partial: true });
    const keys = Object.keys(data);
    if (keys.length) {
      const r = await one(`update contact_lists set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1 returning id`, [id, ...keys.map((k) => data[k])]);
      if (!r) throw new HttpError(404, 'Liste nicht gefunden.');
    }
    return { list: await loadList(id) };
  });

  route('DELETE', '/lists/:id', async ({ params, user }) => {
    const id = idParam(params.id);
    const l = await one(`delete from contact_lists where id = $1 returning name`, [id]);
    if (!l) throw new HttpError(404, 'Liste nicht gefunden.');
    await logActivity({ userId: user.id, entityType: 'list', entityId: id, action: 'list_deleted', message: `hat die Liste „${l.name}“ gelöscht.` });
    return { ok: true };
  });

  route('POST', '/lists/:id/contacts', async ({ req, params, user }) => {
    const id = idParam(params.id);
    await loadList(id);
    const data = validate(await readJson(req), contactSchema);
    if (!data.company && !data.name) throw new HttpError(422, 'Bitte Firma oder Ansprechpartner angeben.', { company: 'Firma oder Name nötig.' });
    const row = await one(
      `insert into list_contacts (list_id, ${CONTACT_COLS.join(', ')}, created_by) values ($1, ${CONTACT_COLS.map((_, i) => `$${i + 2}`).join(', ')}, $${CONTACT_COLS.length + 2}) returning *`,
      [id, ...CONTACT_COLS.map((k) => data[k]), user.id]
    );
    await q(`update contact_lists set updated_at = now() where id = $1`, [id]);
    return json({ contact: row }, 201);
  });

  route('PATCH', '/list-contacts/:id', async ({ req, params }) => {
    const id = idParam(params.id);
    const data = validate(await readJson(req), contactSchema, { partial: true });
    const keys = Object.keys(data);
    if (!keys.length) return { ok: true };
    const row = await one(`update list_contacts set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1 returning *`, [id, ...keys.map((k) => data[k])]);
    if (!row) throw new HttpError(404, 'Kontakt nicht gefunden.');
    return { contact: row };
  });

  route('DELETE', '/list-contacts/:id', async ({ params }) => {
    const row = await one(`delete from list_contacts where id = $1 returning id`, [idParam(params.id)]);
    if (!row) throw new HttpError(404, 'Kontakt nicht gefunden.');
    return { ok: true };
  });

  route('GET', '/lists/:id/export.csv', async ({ params }) => {
    const id = idParam(params.id);
    const list = await loadList(id);
    const rows = await q(`select * from list_contacts where list_id = $1 order by lower(coalesce(company, name, '')), id`, [id]);
    const lines = [CSV_HEADERS, ...rows.map((r) => [r.company, r.name, r.position, r.email, r.phone, r.website, r.instagram, r.city, r.status, r.notes,
      r.last_contacted_on ? new Date(r.last_contacted_on).toISOString().slice(0, 10) : ''])];
    const csv = '﻿' + lines.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
    const name = list.name.replace(/[^A-Za-z0-9._-]+/g, '_');
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="Liste_${name}.csv"`, 'Cache-Control': 'no-store' } });
  });

  // CSV-Import: { csv: "<Text>" } – Spaltennamen werden erkannt (Firma, Ansprechpartner, E-Mail, …)
  route('POST', '/lists/:id/import', async ({ req, params, user }) => {
    const id = idParam(params.id);
    await loadList(id);
    const body = await readJson(req);
    const text = String(body?.csv || '');
    if (!text.trim()) throw new HttpError(422, 'Die CSV-Datei ist leer.');
    if (text.length > 1_000_000) throw new HttpError(413, 'Die Datei ist zu groß (max. 1 MB).');
    const rows = parseCsv(text);
    if (rows.length < 2) throw new HttpError(422, 'Keine Datenzeilen gefunden. Erste Zeile muss die Spaltennamen enthalten.');
    const map = rows[0].map((h) => HEADER_MAP[h.trim().toLowerCase()] || null);
    if (!map.some(Boolean)) throw new HttpError(422, 'Keine bekannten Spalten gefunden (z. B. Firma, Ansprechpartner, E-Mail).');
    let imported = 0;
    const errors = [];
    for (let i = 1; i < rows.length && i <= 2000; i++) {
      const raw = {};
      map.forEach((k, j) => { if (k && rows[i][j]?.trim()) raw[k] = rows[i][j].trim(); });
      if (raw.status && !CONTACT_STATUSES.includes(raw.status)) raw.status = 'Neu';
      try {
        const data = validate(raw, contactSchema);
        if (!data.company && !data.name) continue;
        await q(
          `insert into list_contacts (list_id, ${CONTACT_COLS.join(', ')}, created_by) values ($1, ${CONTACT_COLS.map((_, k) => `$${k + 2}`).join(', ')}, $${CONTACT_COLS.length + 2})`,
          [id, ...CONTACT_COLS.map((k) => data[k]), user.id]
        );
        imported++;
      } catch (e) {
        errors.push(`Zeile ${i + 1}: ${e.details ? Object.values(e.details).join(', ') : e.message}`);
      }
    }
    await q(`update contact_lists set updated_at = now() where id = $1`, [id]);
    return { imported, errors: errors.slice(0, 20) };
  });
}
