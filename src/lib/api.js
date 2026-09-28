// Fetch-Wrapper für die REST-API
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details || {};
  }
}

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(method, path, body, { isForm = false } = {}) {
  const headers = { 'X-Requested-With': 'crm' };
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Keine Verbindung zum Server. Bitte Internetverbindung prüfen.');
  }
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized && !path.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(res.status, data?.error || `Fehler ${res.status}`, data?.details);
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  patch: (p, b = {}) => request('PATCH', p, b),
  put: (p, b = {}) => request('PUT', p, b),
  del: (p) => request('DELETE', p),
  upload: (p, formData) => request('POST', p, formData, { isForm: true }),
};

/** Baut einen Querystring aus einem Objekt (leere Werte werden weggelassen). */
export function qs(obj) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    s.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const str = s.toString();
  return str ? '?' + str : '';
}
