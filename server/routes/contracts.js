import { q, one, TODAY } from '../db.js';
import { HttpError, readJson, idParam, intParam, json } from '../http.js';
import { v, validate, assertDateRange } from '../validate.js';
import { logActivity } from '../activity.js';
import { readUpload, randomKey, fileResponse } from '../upload.js';
import { putFile, getFile, removeFile } from '../storage.js';
import { CONTRACT_STATUSES, DOCUMENT_CATEGORIES } from '../../shared/constants.js';

const contractSchema = {
  status: v.oneOf(CONTRACT_STATUSES, { label: 'Vertragsstatus', def: 'Kein Vertrag' }),
  start_date: v.date({ label: 'Vertragsbeginn' }),
  end_date: v.date({ label: 'Vertragsende' }),
  exclusivity: v.str({ label: 'Exklusivität', max: 2000 }),
  usage_rights: v.str({ label: 'Nutzungsrechte', max: 5000 }),
  notice_period: v.str({ label: 'Kündigungsfrist', max: 200 }),
  notes: v.str({ label: 'Vertragsnotizen', max: 10000 }),
};

const DOC_SELECT = `
  select d.id, d.creator_id, d.collaboration_id, d.category, d.filename, d.mime_type, d.size_bytes, d.created_at,
    u.name as uploaded_by_name, c.display_name as creator_name, co.brand as collaboration_brand, co.campaign_name as collaboration_campaign
  from documents d
  join creators c on c.id = d.creator_id
  left join users u on u.id = d.uploaded_by
  left join collaborations co on co.id = d.collaboration_id`;

export default function register(route) {
  // Vertragsübersicht über alle Creator
  route('GET', '/contracts', async ({ query }) => {
    const params = [];
    const p = (x) => { params.push(x); return `$${params.length}`; };
    const where = [`c.status <> 'Archiviert'`];
    const st = query.get('status');
    if (CONTRACT_STATUSES.includes(st)) where.push(`coalesce(ct.status, 'Kein Vertrag') = ${p(st)}`);
    if (query.get('expiring') === '1') where.push(`ct.status = 'Aktiv' and ct.end_date between ${TODAY} and ${TODAY} + 30`);
    const s = (query.get('q') || '').trim();
    if (s) where.push(`c.display_name ilike ${p(`%${s}%`)}`);
    const pageSize = intParam(query.get('page_size'), { min: 1, max: 200, def: 50 });
    const page = intParam(query.get('page'), { min: 1, def: 1 });
    const rows = await q(
      `select count(*) over() as total_count, c.id as creator_id, c.display_name as creator_name, c.status as creator_status,
         u.name as manager_name,
         coalesce(ct.status, 'Kein Vertrag') as status, ct.start_date, ct.end_date, ct.exclusivity, ct.notice_period, ct.updated_at,
         (ct.status = 'Aktiv' and ct.end_date between ${TODAY} and ${TODAY} + 30) as expiring_soon,
         (select count(*)::int from documents d where d.creator_id = c.id and d.category = 'Verträge') as contract_files
       from creators c
       left join contracts ct on ct.creator_id = c.id
       left join users u on u.id = c.manager_id
       where ${where.join(' and ')}
       order by array_position(array['Aktiv','Zur Unterschrift','In Vorbereitung','Ausgelaufen','Gekündigt','Kein Vertrag']::text[], coalesce(ct.status, 'Kein Vertrag')),
         ct.end_date asc nulls last, lower(c.display_name)
       limit ${p(pageSize)} offset ${p((page - 1) * pageSize)}`,
      params
    );
    const total = rows[0] ? Number(rows[0].total_count) : 0;
    return { items: rows.map(({ total_count, ...r }) => r), total, page, pages: Math.max(1, Math.ceil(total / pageSize)) };
  });

  route('PUT', '/creators/:id/contract', async ({ req, params, user }) => {
    const creatorId = idParam(params.id);
    if (!(await one(`select id from creators where id = $1`, [creatorId]))) throw new HttpError(404, 'Creator nicht gefunden.');
    const data = validate(await readJson(req), contractSchema);
    assertDateRange(data.start_date, data.end_date, 'Vertragsbeginn', 'Vertragsende');
    const before = await one(`select status from contracts where creator_id = $1`, [creatorId]);
    const keys = Object.keys(data);
    const contract = await one(
      `insert into contracts (creator_id, ${keys.join(', ')}, updated_by)
       values ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}, $${keys.length + 2})
       on conflict (creator_id) do update set ${keys.map((k) => `${k} = excluded.${k}`).join(', ')}, updated_by = excluded.updated_by, updated_at = now()
       returning *`,
      [creatorId, ...keys.map((k) => data[k]), user.id]
    );
    const prev = before?.status || 'Kein Vertrag';
    await logActivity({
      creatorId, userId: user.id, entityType: 'contract', entityId: contract.id,
      action: prev !== data.status ? 'contract_status_changed' : 'contract_updated',
      message: prev !== data.status ? `hat den Vertragsstatus von '${prev}' auf '${data.status}' geändert.` : 'hat die Vertragsdaten aktualisiert.',
    });
    return { contract };
  });

  // ---------- Dokumente ----------
  route('GET', '/documents', async ({ query }) => {
    const params = [];
    const p = (x) => { params.push(x); return `$${params.length}`; };
    const where = [];
    if (query.get('creator_id')) where.push(`d.creator_id = ${p(intParam(query.get('creator_id'), { def: 0 }))}`);
    if (query.get('collaboration_id')) where.push(`d.collaboration_id = ${p(intParam(query.get('collaboration_id'), { def: 0 }))}`);
    if (DOCUMENT_CATEGORIES.includes(query.get('category'))) where.push(`d.category = ${p(query.get('category'))}`);
    const s = (query.get('q') || '').trim();
    if (s) {
      const like = p(`%${s}%`);
      where.push(`(d.filename ilike ${like} or c.display_name ilike ${like} or co.brand ilike ${like})`);
    }
    const pageSize = intParam(query.get('page_size'), { min: 1, max: 200, def: 50 });
    const page = intParam(query.get('page'), { min: 1, def: 1 });
    const rows = await q(
      `${DOC_SELECT.replace('select d.id', 'select count(*) over() as total_count, d.id')}
       ${where.length ? 'where ' + where.join(' and ') : ''}
       order by d.created_at desc, d.id desc limit ${p(pageSize)} offset ${p((page - 1) * pageSize)}`,
      params
    );
    const total = rows[0] ? Number(rows[0].total_count) : 0;
    return { items: rows.map(({ total_count, ...r }) => r), total, page, pages: Math.max(1, Math.ceil(total / pageSize)) };
  });

  route('POST', '/documents', async ({ req, user }) => {
    const up = await readUpload(req);
    const meta = validate(up.fields, {
      creator_id: v.ref({ label: 'Creator', required: true }),
      collaboration_id: v.ref({ label: 'Kooperation' }),
      category: v.oneOf(DOCUMENT_CATEGORIES, { label: 'Kategorie', required: true }),
    });
    if (!(await one(`select id from creators where id = $1`, [meta.creator_id]))) throw new HttpError(422, 'Creator nicht gefunden.');
    if (meta.collaboration_id) {
      const co = await one(`select creator_id from collaborations where id = $1`, [meta.collaboration_id]);
      if (!co || co.creator_id !== meta.creator_id) throw new HttpError(422, 'Die Kooperation gehört nicht zu diesem Creator.');
    }
    const key = `documents/${meta.creator_id}/${randomKey()}`;
    await putFile(key, up.buffer, { mime: up.mime, filename: up.filename });
    let doc;
    try {
      doc = await one(
        `insert into documents (creator_id, collaboration_id, category, filename, mime_type, size_bytes, blob_key, uploaded_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [meta.creator_id, meta.collaboration_id, meta.category, up.filename, up.mime, up.size, key, user.id]
      );
    } catch (e) {
      await removeFile(key);
      throw e;
    }
    const isContract = meta.category === 'Verträge';
    await logActivity({
      creatorId: meta.creator_id, userId: user.id, entityType: 'document', entityId: doc.id,
      action: isContract ? 'contract_uploaded' : 'document_uploaded',
      message: isContract ? `hat den Vertrag „${up.filename}“ hochgeladen.` : `hat die Datei „${up.filename}“ (${meta.category}) hochgeladen.`,
    });
    return json({ id: doc.id }, 201);
  });

  route('GET', '/documents/:id/file', async ({ params, query }) => {
    const id = idParam(params.id);
    const d = await one(`select filename, mime_type, blob_key from documents where id = $1`, [id]);
    if (!d) throw new HttpError(404, 'Datei nicht gefunden.');
    const f = await getFile(d.blob_key);
    if (!f) throw new HttpError(404, 'Die Datei ist im Speicher nicht mehr vorhanden.');
    return fileResponse(f.data, { filename: d.filename, mime: d.mime_type, inline: query.get('download') !== '1' });
  });

  route('DELETE', '/documents/:id', async ({ params, user }) => {
    const id = idParam(params.id);
    const d = await one(`delete from documents where id = $1 returning creator_id, filename, blob_key`, [id]);
    if (!d) throw new HttpError(404, 'Datei nicht gefunden.');
    await removeFile(d.blob_key);
    await logActivity({ creatorId: d.creator_id, userId: user.id, entityType: 'document', entityId: id, action: 'document_deleted', message: `hat die Datei „${d.filename}“ gelöscht.` });
    return { ok: true };
  });
}
