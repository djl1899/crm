export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const baseHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...baseHeaders, ...headers } });
}

export function errorResponse(err) {
  if (err instanceof HttpError) {
    return json({ error: err.message, details: err.details || undefined }, err.status);
  }
  console.error('[api] Unerwarteter Fehler:', err);
  const msg = err && err.code === 'DB_NOT_CONFIGURED'
    ? err.message
    : 'Interner Serverfehler. Bitte später erneut versuchen.';
  return json({ error: msg }, 500);
}

export async function readJson(req) {
  const text = await req.text();
  if (!text) return {};
  try {
    const data = JSON.parse(text);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new HttpError(400, 'Ungültiger JSON-Body.');
  }
}

export function parseCookies(req) {
  const header = req.headers.get('cookie') || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function intParam(value, { min, max, def } = {}) {
  if (value === null || value === undefined || value === '') return def;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return def;
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
}

export function idParam(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0 || String(n) !== String(value)) throw new HttpError(404, 'Nicht gefunden.');
  return n;
}
