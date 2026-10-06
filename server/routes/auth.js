import { q, one, tx } from '../db.js';
import { HttpError, json, readJson } from '../http.js';
import { v, validate } from '../validate.js';
import {
  hashPassword, verifyPassword, validatePasswordStrength, createSessionCookie, clearSessionCookie,
  assertNotLockedOut, recordLoginAttempt, PUBLIC_USER_FIELDS, signToken, verifyToken,
  createTrustCookie, clearTrustCookie, isTrustedDevice,
} from '../auth.js';
import {
  generateSecret, verifyTotp, otpauthUrl, qrSvg, generateRecoveryCodes, hashRecoveryCode,
} from '../totp.js';
import { logActivity } from '../activity.js';
import { seedDemoData } from './seed.js';
import { getSetting } from '../settings.js';

const clientIp = (req) =>
  req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null;

async function finishLogin(req, user, email, extraCookies = []) {
  await recordLoginAttempt(email, clientIp(req), true);
  await q(`update users set last_login_at = now() where id = $1`, [user.id]);
  const cookie = await createSessionCookie(req, user);
  const clean = { ...user };
  for (const k of ['token_version', 'totp_secret', 'totp_last_step', 'recovery_codes', 'password_hash']) delete clean[k];
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', cookie);
  for (const c of extraCookies) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify({ user: clean }), { status: 200, headers });
}

export default function register(route) {
  route('GET', '/auth/status', async ({ user }) => {
    const row = await one(`select count(*)::int as n from users`);
    return { needsSetup: row.n === 0, user, agency_name: await getSetting('agency_name') };
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
    delete user.password_hash;

    // Zwei-Faktor: Passwort war richtig → jetzt Code vom Handy verlangen (außer auf vertrauten Geräten)
    if (user.totp_enabled && !(await isTrustedDevice(req, user))) {
      const challenge = await signToken({ kind: '2fa', uid: user.id, tv: user.token_version, exp: Math.floor(Date.now() / 1000) + 300 });
      return json({ twofa_required: true, challenge });
    }
    return finishLogin(req, user, email);
  }, { auth: false });

  route('POST', '/auth/login/2fa', async ({ req }) => {
    const body = await readJson(req);
    const payload = await verifyToken(String(body.challenge || ''));
    if (!payload || payload.kind !== '2fa') throw new HttpError(401, 'Die Anmeldung ist abgelaufen. Bitte erneut mit E-Mail und Passwort anmelden.');
    const user = await one(
      `select ${PUBLIC_USER_FIELDS}, token_version, totp_secret, totp_last_step, recovery_codes from users where id = $1`,
      [payload.uid]
    );
    if (!user || !user.is_active || user.token_version !== payload.tv || !user.totp_enabled) {
      throw new HttpError(401, 'Die Anmeldung ist abgelaufen. Bitte erneut anmelden.');
    }
    await assertNotLockedOut(user.email);
    const code = String(body.code || '').trim();
    let okCode = false;
    let usedRecovery = false;
    const step = verifyTotp(user.totp_secret, code, user.totp_last_step === null ? null : Number(user.totp_last_step));
    if (step !== null) {
      okCode = true;
      await q(`update users set totp_last_step = $2 where id = $1`, [user.id, step]);
    } else if (code.replace(/[^A-Za-z0-9]/g, '').length >= 10) {
      const h = hashRecoveryCode(code);
      const codes = user.recovery_codes || [];
      if (codes.includes(h)) {
        okCode = true;
        usedRecovery = true;
        await q(`update users set recovery_codes = array_remove(recovery_codes, $2) where id = $1`, [user.id, h]);
      }
    }
    if (!okCode) {
      await recordLoginAttempt(user.email, clientIp(req), false);
      throw new HttpError(401, 'Der Code ist falsch oder abgelaufen.');
    }
    const extraCookies = body.remember === true ? [await createTrustCookie(req, user)] : [];
    const res = await finishLogin(req, user, user.email, extraCookies);
    if (usedRecovery) {
      await logActivity({ userId: user.id, entityType: 'user', entityId: user.id, action: 'recovery_code_used', message: 'hat sich mit einem Wiederherstellungscode angemeldet.' });
    }
    return res;
  }, { auth: false });

  route('POST', '/auth/logout', async ({ req }) => {
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(req) });
  }, { auth: false });

  route('GET', '/auth/me', async ({ user }) => ({ user }), { portal: true });

  // Eigenes Profil bearbeiten
  route('PATCH', '/auth/me', async ({ req, user }) => {
    const data = validate(await readJson(req), {
      name: v.str({ label: 'Name', required: true, max: 120 }),
      email: v.email({ required: true }),
      digest_enabled: v.bool({ label: 'Tägliche Mail' }),
    }, { partial: true });
    if (user.role === 'creator') delete data.digest_enabled;
    if (data.email) {
      const dup = await one(`select id from users where lower(email) = $1 and id <> $2`, [data.email, user.id]);
      if (dup) throw new HttpError(409, 'Diese E-Mail-Adresse wird bereits verwendet.', { email: 'Bereits vergeben.' });
    }
    const updated = await one(
      `update users set name = coalesce($2, name), email = coalesce($3, email), digest_enabled = coalesce($4, digest_enabled), updated_at = now()
       where id = $1 returning ${PUBLIC_USER_FIELDS}`,
      [user.id, data.name ?? null, data.email ?? null, data.digest_enabled ?? null]
    );
    return { user: updated };
  }, { portal: true });

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
  }, { portal: true });

  // ---------- Zwei-Faktor verwalten (eigenes Konto) ----------
  route('POST', '/auth/2fa/setup', async ({ user }) => {
    if (user.totp_enabled) throw new HttpError(409, 'Die Zwei-Faktor-Anmeldung ist bereits aktiv.');
    const secret = generateSecret();
    await q(`update users set totp_pending = $2 where id = $1`, [user.id, secret]);
    const url = otpauthUrl({ secret, account: user.email });
    return { secret, otpauth_url: url, qr_svg: qrSvg(url) };
  }, { portal: true });

  route('POST', '/auth/2fa/enable', async ({ req, user }) => {
    const body = await readJson(req);
    const row = await one(`select totp_pending from users where id = $1`, [user.id]);
    if (!row?.totp_pending) throw new HttpError(422, 'Bitte die Einrichtung neu starten.');
    const step = verifyTotp(row.totp_pending, body.code);
    if (step === null) throw new HttpError(422, 'Der Code stimmt nicht. Prüfe, ob die Uhrzeit am Handy stimmt, und versuche den aktuellen Code.', { code: 'Falscher Code.' });
    const codes = generateRecoveryCodes();
    await q(
      `update users set totp_secret = totp_pending, totp_pending = null, totp_enabled = true, totp_enabled_at = now(),
         totp_last_step = $2, recovery_codes = $3::text[] where id = $1`,
      [user.id, step, codes.map(hashRecoveryCode)]
    );
    await logActivity({ userId: user.id, entityType: 'user', entityId: user.id, action: '2fa_enabled', message: 'hat die Zwei-Faktor-Anmeldung aktiviert.' });
    return { recovery_codes: codes };
  }, { portal: true });

  route('POST', '/auth/2fa/disable', async ({ req, user }) => {
    const body = await readJson(req);
    const row = await one(`select password_hash from users where id = $1`, [user.id]);
    if (!(await verifyPassword(String(body.password || ''), row.password_hash))) {
      throw new HttpError(422, 'Das Passwort ist falsch.', { password: 'Falsch.' });
    }
    await q(
      `update users set totp_enabled = false, totp_secret = null, totp_pending = null, totp_last_step = null,
         recovery_codes = '{}', token_version = token_version + 1 where id = $1`,
      [user.id]
    );
    await logActivity({ userId: user.id, entityType: 'user', entityId: user.id, action: '2fa_disabled', message: 'hat die Zwei-Faktor-Anmeldung deaktiviert.' });
    const fresh = await one(`select id, token_version from users where id = $1`, [user.id]);
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', await createSessionCookie(req, fresh));
    headers.append('Set-Cookie', clearTrustCookie(req));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }, { portal: true });

  route('POST', '/auth/2fa/recovery-codes', async ({ req, user }) => {
    const body = await readJson(req);
    const row = await one(`select password_hash, totp_enabled from users where id = $1`, [user.id]);
    if (!row.totp_enabled) throw new HttpError(422, 'Die Zwei-Faktor-Anmeldung ist nicht aktiv.');
    if (!(await verifyPassword(String(body.password || ''), row.password_hash))) {
      throw new HttpError(422, 'Das Passwort ist falsch.', { password: 'Falsch.' });
    }
    const codes = generateRecoveryCodes();
    await q(`update users set recovery_codes = $2::text[] where id = $1`, [user.id, codes.map(hashRecoveryCode)]);
    return { recovery_codes: codes };
  }, { portal: true });

  route('GET', '/auth/2fa/status', async ({ user }) => {
    const row = await one(`select totp_enabled, totp_enabled_at, cardinality(recovery_codes)::int as recovery_left from users where id = $1`, [user.id]);
    return row;
  }, { portal: true });
}
