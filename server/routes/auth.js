import { q, one, tx } from '../db.js';
import { HttpError, json, readJson } from '../http.js';
import { v, validate } from '../validate.js';
import {
  hashPassword, verifyPassword, validatePasswordStrength, createSessionCookie, clearSessionCookie,
  assertNotLockedOut, recordLoginAttempt, PUBLIC_USER_FIELDS,
} from '../auth.js';
import { seedDemoData } from './seed.js';

const clientIp = (req) =>
  req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null;

export default function register(route) {
  route('GET', '/auth/status', async ({ user }) => {
    const row = await one(`select count(*)::int as n from users`);
    return { needsSetup: row.n === 0, user };
  }, { auth: false });

  // Ersteinrichtung: erster Benutzer wird Administrator (nur möglich, solange keine Benutzer existieren)
  route('POST', '/auth/setup', async ({ req }) => {
    const body = await readJson(req);
    const data = validate(body, {
      name: v.str({ label: 'Name', required: true, max: 120 }),
      email: v.email({ required: true }),
    });
    validatePasswordStrength(body.password);
    const hash = await hashPassword(body.password);
    const user = await tx(async (run) => {
      await run(`select pg_advisory_xact_lock(55501)`);
      const c = await run(`select count(*)::int as n from users`);
      if (c[0].n > 0) throw new HttpError(409, 'Die Ersteinrichtung wurde bereits durchgeführt.');
      const rows = await run(
        `insert into users (name, email, password_hash, role) values ($1, $2, $3, 'admin')
         returning ${PUBLIC_USER_FIELDS}, token_version`,
        [data.name, data.email, hash]
      );
      return rows[0];
    });
    if (body.demo === true) await seedDemoData(user.id);
    const cookie = await createSessionCookie(req, user);
    delete user.token_version;
    return json({ user }, 200, { 'Set-Cookie': cookie });
  }, { auth: false });

  route('POST', '/auth/login', async ({ req }) => {
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!email || !password) throw new HttpError(422, 'Bitte E-Mail und Passwort eingeben.');
    await assertNotLockedOut(email);
    const user = await one(`select ${PUBLIC_USER_FIELDS}, token_version, password_hash from users where lower(email) = $1`, [email]);
    const ok = user ? await verifyPassword(password, user.password_hash) : await verifyPassword(password, 'scrypt$16384$8$1$AAAA$AAAA');
    if (!user || !ok) {
      await recordLoginAttempt(email, clientIp(req), false);
      throw new HttpError(401, 'E-Mail oder Passwort ist falsch.');
    }
    if (!user.is_active) throw new HttpError(403, 'Dieses Benutzerkonto ist deaktiviert.');
    await recordLoginAttempt(email, clientIp(req), true);
    await q(`update users set last_login_at = now() where id = $1`, [user.id]);
    const cookie = await createSessionCookie(req, user);
    delete user.password_hash;
    delete user.token_version;
    return json({ user }, 200, { 'Set-Cookie': cookie });
  }, { auth: false });

  route('POST', '/auth/logout', async ({ req }) => {
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(req) });
  }, { auth: false });

  route('GET', '/auth/me', async ({ user }) => ({ user }));

  // Eigenes Profil bearbeiten
  route('PATCH', '/auth/me', async ({ req, user }) => {
    const data = validate(await readJson(req), {
      name: v.str({ label: 'Name', required: true, max: 120 }),
      email: v.email({ required: true }),
    }, { partial: true });
    if (data.email) {
      const dup = await one(`select id from users where lower(email) = $1 and id <> $2`, [data.email, user.id]);
      if (dup) throw new HttpError(409, 'Diese E-Mail-Adresse wird bereits verwendet.', { email: 'Bereits vergeben.' });
    }
    const updated = await one(
      `update users set name = coalesce($2, name), email = coalesce($3, email), updated_at = now()
       where id = $1 returning ${PUBLIC_USER_FIELDS}`,
      [user.id, data.name ?? null, data.email ?? null]
    );
    return { user: updated };
  });

  // Eigenes Passwort ändern (alle anderen Sitzungen werden ungültig)
  route('POST', '/auth/password', async ({ req, user }) => {
    const body = await readJson(req);
    const row = await one(`select password_hash from users where id = $1`, [user.id]);
    if (!(await verifyPassword(String(body.current_password || ''), row.password_hash))) {
      throw new HttpError(422, 'Das aktuelle Passwort ist falsch.', { current_password: 'Falsch.' });
    }
    validatePasswordStrength(body.new_password);
    const hash = await hashPassword(body.new_password);
    const updated = await one(
      `update users set password_hash = $2, token_version = token_version + 1, updated_at = now()
       where id = $1 returning id, token_version`,
      [user.id, hash]
    );
    const cookie = await createSessionCookie(req, updated);
    return json({ ok: true }, 200, { 'Set-Cookie': cookie });
  });
}
