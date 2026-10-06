// Creator-Bereich: eigener Login für Creator + Verwaltung der Zugänge durch das Team.
// Jeder /portal-Endpunkt arbeitet ausschließlich mit dem Creator, der mit dem eingeloggten Konto verknüpft ist.
import crypto from 'node:crypto';
import { q, one, tx, TODAY } from '../db.js';
import { HttpError, readJson, idParam, intParam, json } from '../http.js';
import { v, validate } from '../validate.js';
import {
  hashPassword, validatePasswordStrength, createSessionCookie, PUBLIC_USER_FIELDS, assertNotLockedOut, recordLoginAttempt,
} from '../auth.js';
import { logActivity } from '../activity.js';
import { readUpload, randomKey, fileResponse } from '../upload.js';
import { putFile, getFile } from '../storage.js';
import { mailConfig, sendMail } from '../mailer.js';
import { billingSchema, REVENUE_COLLAB_SQL } from './creators.js';

const INVITE_DAYS = 7;
const PORTAL_UPLOAD_CATEGORIES = ['Rechnungen', 'Sonstige Dokumente'];
const appUrl = () => (process.env.APP_URL || process.env.URL || '').replace(/\/$/, '');
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clientIp = (req) =>
  req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null;

// Felder, die Creator selbst pflegen dürfen (Status, Provision, Notizen usw. bleiben beim Team)
const profileSchema = {
  first_name: v.str({ label: 'Vorname', max: 80 }),
  last_name: v.str({ label: 'Nachname', max: 80 }),
  email: v.email({ label: 'Kontakt-E-Mail' }),
  phone: v.str({ label: 'Telefonnummer', max: 40 }),
  city: v.str({ label: 'Wohnort', max: 80 }),
  bio: v.str({ label: 'Kurzvorstellung', max: 1500 }),
  size_top: v.str({ label: 'Größe Oberteil', max: 20 }),
  size_bottom: v.str({ label: 'Größe Hose', max: 20 }),
  size_shoes: v.str({ label: 'Schuhgröße', max: 20 }),
  height_cm: v.int({ label: 'Körpergröße', min: 50, max: 250 }),
  size_notes: v.str({ label: 'Hinweis zu Größen', max: 500 }),
  ...billingSchema,
};
const PROFILE_COLUMNS = Object.keys(profileSchema);

async function creatorFor(user) {
  if (user.role !== 'creator' || !user.creator_id) throw new HttpError(403, 'Dieser Bereich ist nur für Creator.');
  const c = await one(
    `select c.*, u.name as manager_name, u.email as manager_email
     from creators c left join users u on u.id = c.manager_id where c.id = $1`,
    [user.creator_id]
  );
  if (!c) throw new HttpError(403, 'Dein Creator-Profil wurde nicht gefunden. Bitte melde dich bei deinem Management.');
  return c;
}

// Öffentliche Sicht auf eine Kooperation – ohne interne Notizen
const COLLAB_SELECT = `
  select co.id, co.brand, co.campaign_name, co.status, co.platform, co.description, co.deliverables,
    co.start_date, co.end_date, co.deadline, co.fee, co.payout_status, co.invoice_status,
    co.content_links, co.content_note, co.content_submitted_at, co.created_at,
    f.rate as commission_rate, f.agency_fee, f.payout, f.rev_date,
    (co.status in (${REVENUE_COLLAB_SQL})) as confirmed
  from collaborations co join collab_finance f on f.id = co.id`;

async function sendInviteMail(email, name, link) {
  if (!mailConfig().configured) return false;
  const first = String(name || '').split(' ')[0];
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#18181b">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <div style="background:#fff;border-radius:14px;padding:32px;border:1px solid #e4e4e7">
      <h1 style="font-size:22px;margin:0 0 12px">Dein Creator-Bereich ist bereit</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 20px">Hallo ${esc(first)}, wir haben dir einen eigenen Zugang eingerichtet. Dort siehst du deine Kooperationen, Deadlines, Auszahlungen und Dokumente auf einen Blick.</p>
      <p style="margin:0 0 24px"><a href="${esc(link)}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">Passwort festlegen</a></p>
      <p style="font-size:13px;color:#71717a;line-height:1.5;margin:0">Der Link ist ${INVITE_DAYS} Tage gültig und funktioniert nur einmal. Falls du keine Einladung erwartet hast, kannst du diese E-Mail ignorieren.</p>
    </div>
  </div></body></html>`;
  const text = `Hallo ${first},\n\nwir haben dir einen eigenen Creator-Bereich eingerichtet. Lege hier dein Passwort fest:\n${link}\n\nDer Link ist ${INVITE_DAYS} Tage gültig und funktioniert nur einmal.`;
  try {
    await sendMail({ to: email, subject: 'Dein Zugang zum Creator-Bereich', text, html });
    return true;
  } catch (e) {
    console.error('[mail] Einladung fehlgeschlagen:', e.message);
    return false;
  }
}

async function issueInvite(run, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await run(
    `update users set invite_token_hash = $2, invite_expires_at = now() + interval '${INVITE_DAYS} days' where id = $1`,
    [userId, hashToken(token)]
  );
  return { token, link: `${appUrl()}/einladung?token=${token}` };
}

const accessInfo = (u) =>
  u && {
    id: u.id, email: u.email, is_active: u.is_active, last_login_at: u.last_login_at, created_at: u.created_at,
    invite_pending: !!u.invite_token_hash && new Date(u.invite_expires_at) > new Date(),
    invite_expires_at: u.invite_expires_at, has_logged_in: !!u.last_login_at, totp_enabled: u.totp_enabled,
  };

export default function register(route) {
  // =================================================================
  // Team: Zugänge verwalten (im Creator-Profil)
  // =================================================================
  route('GET', '/creators/:id/portal', async ({ params }) => {
    const id = idParam(params.id);
    const u = await one(
      `select id, email, is_active, last_login_at, created_at, invite_token_hash, invite_expires_at, totp_enabled from users where creator_id = $1`,
      [id]
    );
    return { access: accessInfo(u), mail_configured: mailConfig().configured };
  });

  // Zugang anlegen oder Einladung neu verschicken (setzt ein vergessenes Passwort zurück)
  route('POST', '/creators/:id/portal', async ({ req, params, user }) => {
    const id = idParam(params.id);
    const body = await readJson(req);
    const c = await one(`select id, display_name, email from creators where id = $1`, [id]);
    if (!c) throw new HttpError(404, 'Creator nicht gefunden.');
    const existing = await one(`select id, email from users where creator_id = $1`, [id]);
    let email = existing?.email;
    if (!existing || body.email) {
      email = validate({ email: body.email || c.email }, { email: v.email({ label: 'E-Mail für den Login', required: true }) }).email;
    }
    const result = await tx(async (run) => {
      const dup = await run(`select id from users where lower(email) = $1 and (creator_id is distinct from $2)`, [email, id]);
      if (dup[0]) throw new HttpError(409, 'Diese E-Mail-Adresse wird bereits für ein anderes Konto verwendet.', { email: 'Bereits vergeben.' });
      let userId = existing?.id;
      if (!userId) {
        // Zufälliges, unbekanntes Passwort – der Creator legt sein eigenes über den Einladungslink fest
        const placeholder = await hashPassword(crypto.randomBytes(32).toString('base64url'));
        const rows = await run(
          `insert into users (name, email, password_hash, role, is_active, creator_id) values ($1, $2, $3, 'creator', true, $4) returning id`,
          [c.display_name, email, placeholder, id]
        );
        userId = rows[0].id;
      } else {
        await run(
          `update users set email = $2, is_active = true, token_version = token_version + 1, updated_at = now() where id = $1`,
          [userId, email]
        );
      }
      return { userId, ...(await issueInvite(run, userId)) };
    });
    const mailed = body.send_mail === false ? false : await sendInviteMail(email, c.display_name, result.link);
    await logActivity({
      creatorId: id, userId: user.id, entityType: 'portal', entityId: result.userId, action: existing ? 'portal_reinvited' : 'portal_invited',
      message: existing ? 'hat eine neue Einladung zum Creator-Bereich erstellt.' : `hat einen Zugang zum Creator-Bereich für ${email} angelegt.`,
    });
    const u = await one(`select id, email, is_active, last_login_at, created_at, invite_token_hash, invite_expires_at, totp_enabled from users where id = $1`, [result.userId]);
    return { access: accessInfo(u), link: result.link, mailed };
  });

  route('PATCH', '/creators/:id/portal', async ({ req, params, user }) => {
    const id = idParam(params.id);
    const data = validate(await readJson(req), { is_active: v.bool({ label: 'Zugang aktiv' }) });
    const u = await one(
      `update users set is_active = $2, token_version = token_version + (case when $2 then 0 else 1 end),
         invite_token_hash = case when $2 then invite_token_hash else null end, updated_at = now()
       where creator_id = $1 returning id, email, is_active, last_login_at, created_at, invite_token_hash, invite_expires_at, totp_enabled`,
      [id, data.is_active]
    );
    if (!u) throw new HttpError(404, 'Dieser Creator hat noch keinen Zugang.');
    await logActivity({
      creatorId: id, userId: user.id, entityType: 'portal', entityId: u.id, action: data.is_active ? 'portal_enabled' : 'portal_disabled',
      message: data.is_active ? 'hat den Zugang zum Creator-Bereich wieder freigeschaltet.' : 'hat den Zugang zum Creator-Bereich gesperrt.',
    });
    return { access: accessInfo(u) };
  });

  // =================================================================
  // Öffentlich: Einladung annehmen
  // =================================================================
  route('GET', '/auth/invite', async ({ query }) => {
    const token = String(query.get('token') || '');
    const u = token && (await one(
      `select u.name, u.email from users u where u.invite_token_hash = $1 and u.invite_expires_at > now() and u.is_active = true and u.role = 'creator'`,
      [hashToken(token)]
    ));
    if (!u) return { valid: false };
    return { valid: true, name: u.name, email: u.email };
  }, { auth: false });

  route('POST', '/auth/invite', async ({ req }) => {
    const body = await readJson(req);
    const token = String(body.token || '');
    const ip = clientIp(req);
    await assertNotLockedOut(`invite:${ip}`);
    const u = token && (await one(
      `select ${PUBLIC_USER_FIELDS}, token_version from users
       where invite_token_hash = $1 and invite_expires_at > now() and is_active = true and role = 'creator'`,
      [hashToken(token)]
    ));
    if (!u) {
      await recordLoginAttempt(`invite:${ip}`, ip, false);
      throw new HttpError(410, 'Dieser Link ist abgelaufen oder wurde schon verwendet. Bitte dein Management um eine neue Einladung.');
    }
    validatePasswordStrength(body.password);
    const updated = await one(
      `update users set password_hash = $2, invite_token_hash = null, invite_expires_at = null,
         token_version = token_version + 1, last_login_at = now(), updated_at = now()
       where id = $1 returning ${PUBLIC_USER_FIELDS}, token_version`,
      [u.id, await hashPassword(body.password)]
    );
    const cookie = await createSessionCookie(req, updated);
    delete updated.token_version;
    await logActivity({ creatorId: u.creator_id, userId: u.id, entityType: 'portal', entityId: u.id, action: 'portal_activated', message: 'hat den Creator-Bereich aktiviert.' });
    return json({ user: updated }, 200, { 'Set-Cookie': cookie });
  }, { auth: false });

  // =================================================================
  // Creator: eigener Bereich
  // =================================================================
  route('GET', '/portal/overview', async ({ user }) => {
    const c = await creatorFor(user);
    const year = new Date().getFullYear();
    const [stats, upcoming, todos, docs] = await Promise.all([
      one(
        `select
           coalesce(sum(f.payout) filter (where co.payout_status = 'Ausgezahlt' and extract(year from f.rev_date) = $2), 0) as paid_year,
           coalesce(sum(f.payout) filter (where co.payout_status = 'Offen' and co.status in (${REVENUE_COLLAB_SQL})), 0) as open_payout,
           count(*) filter (where co.status in ('Aktiv', 'Content ausstehend', 'Abnahme'))::int as active,
           count(*) filter (where co.status = 'Geplant')::int as planned,
           count(*) filter (where co.status = 'Abgeschlossen')::int as completed,
           count(*) filter (where co.status in ('Anfrage', 'Verhandlung'))::int as requests
         from collaborations co join collab_finance f on f.id = co.id where co.creator_id = $1`,
        [c.id, year]
      ),
      q(
        `${COLLAB_SELECT} where co.creator_id = $1 and co.status in ('Geplant', 'Aktiv', 'Content ausstehend', 'Abnahme')
         order by coalesce(co.deadline, co.start_date, co.end_date) asc nulls last limit 6`,
        [c.id]
      ),
      q(
        `select t.id, t.title, t.description, t.due_date, t.priority, co.brand
         from tasks t left join collaborations co on co.id = t.collaboration_id
         where t.creator_id = $1 and t.status = 'Wartet auf Creator'
         order by t.due_date asc nulls last, t.id limit 10`,
        [c.id]
      ),
      q(
        `select id, category, filename, created_at from documents where creator_id = $1 and visible_to_creator = true
         order by created_at desc limit 5`,
        [c.id]
      ),
    ]);
    return {
      creator: {
        id: c.id, display_name: c.display_name, first_name: c.first_name, avatar_url: c.avatar_key ? `/api/portal/avatar?v=${c.avatar_key.slice(-8)}` : null,
        manager_name: c.manager_name, manager_email: c.manager_email,
        profile_missing: ['billing_street', 'billing_zip', 'billing_city', 'iban'].filter((k) => !c[k]),
      },
      stats, upcoming, todos, documents: docs, year,
    };
  }, { portal: true });

  route('GET', '/portal/avatar', async ({ user }) => {
    const c = await creatorFor(user);
    if (!c.avatar_key) throw new HttpError(404, 'Kein Profilbild.');
    const f = await getFile(c.avatar_key);
    if (!f) throw new HttpError(404, 'Kein Profilbild.');
    return fileResponse(f.data, { filename: 'avatar', mime: f.metadata?.mime || 'image/jpeg', inline: true, cache: 'private, max-age=3600' });
  }, { portal: true });

  route('GET', '/portal/collaborations', async ({ user, query }) => {
    const c = await creatorFor(user);
    const filter = query.get('filter');
    const where = ['co.creator_id = $1', `co.status <> 'Abgebrochen'`];
    if (filter === 'current') where.push(`co.status in ('Geplant', 'Aktiv', 'Content ausstehend', 'Abnahme')`);
    if (filter === 'requests') where.push(`co.status in ('Anfrage', 'Verhandlung')`);
    if (filter === 'done') where.push(`co.status = 'Abgeschlossen'`);
    const items = await q(
      `${COLLAB_SELECT} where ${where.join(' and ')}
       order by case when co.status = 'Abgeschlossen' then 1 else 0 end, coalesce(co.deadline, co.start_date, co.created_at::date) desc`,
      [c.id]
    );
    const docs = items.length
      ? await q(
          `select id, collaboration_id, category, filename, created_at from documents
           where creator_id = $1 and visible_to_creator = true and collaboration_id = any($2::int[]) order by created_at desc`,
          [c.id, items.map((i) => i.id)]
        )
      : [];
    for (const it of items) it.documents = docs.filter((d) => d.collaboration_id === it.id);
    return { items };
  }, { portal: true });

  // Content einreichen: Links zu Posts/Entwürfen, danach prüft das Team
  route('POST', '/portal/collaborations/:id/content', async ({ req, params, user }) => {
    const c = await creatorFor(user);
    const id = idParam(params.id);
    const body = await readJson(req);
    const data = validate(body, {
      content_links: v.str({ label: 'Links', required: true, max: 3000 }),
      content_note: v.str({ label: 'Nachricht', max: 2000 }),
    });
    const links = data.content_links.split(/\s+/).filter(Boolean);
    if (!links.every((l) => /^https?:\/\/\S+$/i.test(l))) {
      throw new HttpError(422, 'Bitte nur vollständige Links eintragen (beginnend mit https://), getrennt durch Leerzeichen oder Zeilen.', { content_links: 'Ungültiger Link.' });
    }
    const co = await one(`select id, brand, status, creator_id from collaborations where id = $1`, [id]);
    if (!co || co.creator_id !== c.id) throw new HttpError(404, 'Kooperation nicht gefunden.');
    if (!['Geplant', 'Aktiv', 'Content ausstehend', 'Abnahme'].includes(co.status)) {
      throw new HttpError(422, 'Für diese Kooperation kann gerade kein Content eingereicht werden.');
    }
    await tx(async (run) => {
      await run(
        `update collaborations set content_links = $2, content_note = $3, content_submitted_at = now(),
           status = case when status in ('Geplant', 'Aktiv', 'Content ausstehend') then 'Abnahme' else status end, updated_at = now()
         where id = $1`,
        [id, links.join('\n'), data.content_note]
      );
      // Aufgabe fürs Team, damit die Einreichung nicht untergeht
      await run(
        `insert into tasks (title, description, creator_id, collaboration_id, assignee_id, priority, status, due_date, created_by)
         values ($1, $2, $3, $4, $5, 'Hoch', 'Offen', ${TODAY} + 2, $6)`,
        [`Content prüfen: ${co.brand}`, `${c.display_name} hat Content eingereicht:\n${links.join('\n')}${data.content_note ? `\n\nNachricht: ${data.content_note}` : ''}`,
          c.id, id, c.manager_id || null, user.id]
      );
      await logActivity({ creatorId: c.id, userId: user.id, entityType: 'collaboration', entityId: id, action: 'content_submitted', message: `hat Content für „${co.brand}“ eingereicht.` }, run);
    });
    return { item: await one(`${COLLAB_SELECT} where co.id = $1`, [id]) };
  }, { portal: true });

  // Aufgabe als erledigt melden
  route('POST', '/portal/todos/:id/done', async ({ params, user }) => {
    const c = await creatorFor(user);
    const id = idParam(params.id);
    const t = await one(`select id, title, creator_id, status from tasks where id = $1`, [id]);
    if (!t || t.creator_id !== c.id || t.status !== 'Wartet auf Creator') throw new HttpError(404, 'Aufgabe nicht gefunden.');
    await q(`update tasks set status = 'In Bearbeitung', updated_at = now() where id = $1`, [id]);
    await logActivity({ creatorId: c.id, userId: user.id, entityType: 'task', entityId: id, action: 'task_done_by_creator', message: `hat „${t.title}“ als erledigt gemeldet.` });
    return { ok: true };
  }, { portal: true });

  route('GET', '/portal/earnings', async ({ user, query }) => {
    const c = await creatorFor(user);
    const years = (await q(
      `select distinct extract(year from f.rev_date)::int as y from collaborations co join collab_finance f on f.id = co.id
       where co.creator_id = $1 and co.status in (${REVENUE_COLLAB_SQL}) order by y desc`,
      [c.id]
    )).map((r) => r.y);
    const now = new Date().getFullYear();
    if (!years.includes(now)) years.unshift(now);
    const year = intParam(query.get('year'), { min: 2000, max: 2100, def: now });
    const items = await q(
      `${COLLAB_SELECT} where co.creator_id = $1 and co.status in (${REVENUE_COLLAB_SQL}) and extract(year from f.rev_date) = $2
       order by f.rev_date desc, co.id desc`,
      [c.id, year]
    );
    const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, paid: 0, open: 0 }));
    let paid = 0, open = 0, gross = 0, agency = 0;
    for (const it of items) {
      const m = new Date(it.rev_date).getMonth();
      const amount = Number(it.payout);
      if (it.payout_status === 'Ausgezahlt') { months[m].paid += amount; paid += amount; } else { months[m].open += amount; open += amount; }
      gross += Number(it.fee);
      agency += Number(it.agency_fee);
    }
    return { year, years: [...new Set(years)].sort((a, b) => b - a), months, totals: { paid, open, gross, agency, count: items.length }, items };
  }, { portal: true });

  route('GET', '/portal/documents', async ({ user }) => {
    const c = await creatorFor(user);
    const items = await q(
      `select d.id, d.category, d.filename, d.mime_type, d.size_bytes, d.created_at, d.collaboration_id,
         co.brand as collaboration_brand, (u.role = 'creator') as uploaded_by_me
       from documents d left join collaborations co on co.id = d.collaboration_id left join users u on u.id = d.uploaded_by
       where d.creator_id = $1 and d.visible_to_creator = true order by d.created_at desc`,
      [c.id]
    );
    return { items, upload_categories: PORTAL_UPLOAD_CATEGORIES };
  }, { portal: true });

  route('GET', '/portal/documents/:id/file', async ({ params, query, user }) => {
    const c = await creatorFor(user);
    const d = await one(`select filename, mime_type, blob_key from documents where id = $1 and creator_id = $2 and visible_to_creator = true`, [idParam(params.id), c.id]);
    if (!d) throw new HttpError(404, 'Datei nicht gefunden.');
    const f = await getFile(d.blob_key);
    if (!f) throw new HttpError(404, 'Die Datei ist im Speicher nicht mehr vorhanden.');
    return fileResponse(f.data, { filename: d.filename, mime: d.mime_type, inline: query.get('download') !== '1' });
  }, { portal: true });

  route('POST', '/portal/documents', async ({ req, user }) => {
    const c = await creatorFor(user);
    const up = await readUpload(req);
    const meta = validate(up.fields, {
      category: v.oneOf(PORTAL_UPLOAD_CATEGORIES, { label: 'Kategorie', required: true }),
      collaboration_id: v.ref({ label: 'Kooperation' }),
    });
    if (meta.collaboration_id) {
      const co = await one(`select creator_id from collaborations where id = $1`, [meta.collaboration_id]);
      if (!co || co.creator_id !== c.id) throw new HttpError(422, 'Kooperation nicht gefunden.');
    }
    const key = `documents/${c.id}/${randomKey()}`;
    await putFile(key, up.buffer, { mime: up.mime, filename: up.filename });
    const doc = await one(
      `insert into documents (creator_id, collaboration_id, category, filename, mime_type, size_bytes, blob_key, uploaded_by, visible_to_creator)
       values ($1, $2, $3, $4, $5, $6, $7, $8, true) returning id`,
      [c.id, meta.collaboration_id, meta.category, up.filename, up.mime, up.size, key, user.id]
    );
    await logActivity({ creatorId: c.id, userId: user.id, entityType: 'document', entityId: doc.id, action: 'document_uploaded', message: `hat die Datei „${up.filename}“ (${meta.category}) hochgeladen.` });
    return json({ id: doc.id }, 201);
  }, { portal: true });

  route('GET', '/portal/profile', async ({ user }) => {
    const c = await creatorFor(user);
    const socials = await q(`select platform, username, url, followers from social_accounts where creator_id = $1 order by platform`, [c.id]);
    const profile = Object.fromEntries(PROFILE_COLUMNS.map((k) => [k, c[k] ?? null]));
    return {
      profile, socials,
      readonly: { display_name: c.display_name, manager_name: c.manager_name, manager_email: c.manager_email, commission_rate: c.commission_rate },
    };
  }, { portal: true });

  route('PUT', '/portal/profile', async ({ req, user }) => {
    const c = await creatorFor(user);
    const data = validate(await readJson(req), profileSchema, { partial: true });
    const keys = Object.keys(data);
    if (!keys.length) return { ok: true };
    const changed = keys.filter((k) => String(data[k] ?? '') !== String(c[k] ?? ''));
    await q(
      `update creators set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`,
      [c.id, ...keys.map((k) => data[k])]
    );
    if (changed.length) {
      const sensitive = changed.some((k) => ['iban', 'bank_holder', 'tax_number', 'vat_id'].includes(k));
      await logActivity({
        creatorId: c.id, userId: user.id, entityType: 'creator', entityId: c.id, action: 'portal_profile_updated',
        message: sensitive ? 'hat im Creator-Bereich die Bank- oder Steuerdaten geändert.' : 'hat im Creator-Bereich die eigenen Daten aktualisiert.',
      });
    }
    return { ok: true };
  }, { portal: true });
}

