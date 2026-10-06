import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { q, one } from './db.js';
import { HttpError, parseCookies } from './http.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const SESSION_COOKIE = 'crm_session';
const SESSION_DAYS = 7;

// ---------- Passwörter (scrypt, niemals Klartext) ----------
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, saltB64, hashB64] = stored.split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function validatePasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(422, 'Das Passwort muss mindestens 8 Zeichen lang sein.', { password: 'Mindestens 8 Zeichen.' });
  if (pw.length > 200) throw new HttpError(422, 'Das Passwort ist zu lang.', { password: 'Zu lang.' });
}

// ---------- Session-Token (HMAC-SHA256 signiert) ----------
let cachedSecret = null;
async function getSecret() {
  if (cachedSecret) return cachedSecret;
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) {
    cachedSecret = process.env.SESSION_SECRET;
    return cachedSecret;
  }
  // Fallback: zufälliges Secret einmalig erzeugen und in der DB speichern
  const generated = crypto.randomBytes(48).toString('base64url');
  await q(`insert into app_meta (key, value) values ('session_secret', $1) on conflict (key) do nothing`, [generated]);
  const row = await one(`select value from app_meta where key = 'session_secret'`);
  cachedSecret = row.value;
  return cachedSecret;
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');

export async function signToken(payload) {
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', await getSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export async function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', await getSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

function isHttps(req) {
  const proto = req.headers.get('x-forwarded-proto');
  if (proto) return proto.includes('https');
  return new URL(req.url).protocol === 'https:';
}

export async function createSessionCookie(req, user) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const token = await signToken({ uid: user.id, tv: user.token_version, exp });
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 86400}`,
  ];
  if (isHttps(req)) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(req) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isHttps(req)) parts.push('Secure');
  return parts.join('; ');
}

export const PUBLIC_USER_FIELDS = 'id, name, email, role, is_active, created_at, last_login_at, totp_enabled, digest_enabled, creator_id';

/** Liefert den eingeloggten, aktiven Benutzer oder null. */
export async function getSessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  const payload = await verifyToken(token);
  if (!payload || payload.kind) return null; // Challenge-/Vertrauens-Token sind keine Sitzung
  const user = await one(`select ${PUBLIC_USER_FIELDS}, token_version from users where id = $1`, [payload.uid]);
  if (!user || !user.is_active || user.token_version !== payload.tv) return null;
  delete user.token_version;
  return user;
}

export function requireAdmin(user) {
  if (!user || user.role !== 'admin') throw new HttpError(403, 'Nur Administratoren dürfen diese Aktion ausführen.');
}

/** CSRF-Schutz: schreibende Requests müssen den Custom-Header tragen (nicht per Formular fälschbar). */
export function checkCsrf(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  if (req.headers.get('x-requested-with') !== 'crm') {
    throw new HttpError(403, 'Ungültige Anfrage (CSRF-Schutz).');
  }
}

// ---------- Brute-Force-Schutz ----------
export async function assertNotLockedOut(email) {
  const row = await one(
    `select count(*)::int as n from login_attempts
     where lower(email) = lower($1) and success = false and created_at > now() - interval '15 minutes'`,
    [email]
  );
  if (row && row.n >= 8) {
    throw new HttpError(429, 'Zu viele fehlgeschlagene Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.');
  }
}

export async function recordLoginAttempt(email, ip, success) {
  await q(`insert into login_attempts (email, ip, success) values ($1, $2, $3)`, [email, ip || null, success]);
  if (Math.random() < 0.05) {
    await q(`delete from login_attempts where created_at < now() - interval '30 days'`);
  }
}

// ---------- Zwei-Faktor: vertrauenswürdige Geräte ----------
export const TRUST_COOKIE = 'crm_trust';
const TRUST_DAYS = 30;

export async function createTrustCookie(req, user) {
  const exp = Math.floor(Date.now() / 1000) + TRUST_DAYS * 86400;
  const token = await signToken({ kind: 'trust', uid: user.id, tv: user.token_version, exp });
  const parts = [`${TRUST_COOKIE}=${token}`, 'Path=/api/auth', 'HttpOnly', 'SameSite=Strict', `Max-Age=${TRUST_DAYS * 86400}`];
  if (isHttps(req)) parts.push('Secure');
  return parts.join('; ');
}

export function clearTrustCookie(req) {
  const parts = [`${TRUST_COOKIE}=`, 'Path=/api/auth', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (isHttps(req)) parts.push('Secure');
  return parts.join('; ');
}

/** true, wenn dieses Gerät für den Benutzer als vertrauenswürdig markiert ist. */
export async function isTrustedDevice(req, user) {
  const payload = await verifyToken(parseCookies(req)[TRUST_COOKIE]);
  return !!payload && payload.kind === 'trust' && payload.uid === user.id && payload.tv === user.token_version;
}
