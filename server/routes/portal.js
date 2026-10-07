// Zugänge zum Creator-Bereich: Einladung, Sperren, Einladung annehmen.
// Die Inhalte des Creator-Bereichs liegen in portal-creator.js.
import crypto from 'node:crypto';
import { one, tx } from '../db.js';
import { HttpError, readJson, idParam, json } from '../http.js';
import { v, validate } from '../validate.js';
import {
  hashPassword, validatePasswordStrength, createSessionCookie, PUBLIC_USER_FIELDS, assertNotLockedOut, recordLoginAttempt,
} from '../auth.js';
import { logActivity } from '../activity.js';
import { mailConfig, sendMail } from '../mailer.js';

const INVITE_DAYS = 7;
const appUrl = () => (process.env.APP_URL || process.env.URL || '').replace(/\/$/, '');
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clientIp = (req) =>
  req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null;

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
}
