import { HttpError } from './http.js';

// Kleine, abhängigkeitsfreie Validierung. Jeder Validator gibt den bereinigten Wert zurück
// oder wirft einen String (Fehlermeldung).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isEmpty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

export const v = {
  str: ({ label, required = false, max = 500 } = {}) => (val) => {
    if (isEmpty(val)) {
      if (required) throw `${label} ist ein Pflichtfeld.`;
      return null;
    }
    if (typeof val !== 'string' && typeof val !== 'number') throw `${label} ist ungültig.`;
    const s = String(val).trim();
    if (s.length > max) throw `${label} darf höchstens ${max} Zeichen lang sein.`;
    return s;
  },
  email: ({ label = 'E-Mail', required = false } = {}) => (val) => {
    if (isEmpty(val)) {
      if (required) throw `${label} ist ein Pflichtfeld.`;
      return null;
    }
    const s = String(val).trim().toLowerCase();
    if (s.length > 254 || !EMAIL_RE.test(s)) throw `${label}: Bitte eine gültige E-Mail-Adresse eingeben.`;
    return s;
  },
  url: ({ label = 'URL' } = {}) => (val) => {
    if (isEmpty(val)) return null;
    let s = String(val).trim();
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    try {
      const u = new URL(s);
      if (!['http:', 'https:'].includes(u.protocol) || !u.hostname.includes('.')) throw new Error();
    } catch {
      throw `${label}: Bitte eine gültige URL eingeben (z. B. https://…).`;
    }
    if (s.length > 500) throw `${label} ist zu lang.`;
    return s;
  },
  int: ({ label, min = 0, max = 2_000_000_000, required = false } = {}) => (val) => {
    if (isEmpty(val)) {
      if (required) throw `${label} ist ein Pflichtfeld.`;
      return null;
    }
    const n = typeof val === 'number' ? val : Number(String(val).replace(/[.\s]/g, ''));
    if (!Number.isInteger(n)) throw `${label} muss eine ganze Zahl sein.`;
    if (n < min) throw min === 0 ? `${label} darf nicht negativ sein.` : `${label} muss mindestens ${min} sein.`;
    if (n > max) throw `${label} ist zu groß.`;
    return n;
  },
  num: ({ label, min = 0, max = 1e12, required = false } = {}) => (val) => {
    if (isEmpty(val)) {
      if (required) throw `${label} ist ein Pflichtfeld.`;
      return null;
    }
    const n = typeof val === 'number' ? val : Number(String(val).replace(',', '.'));
    if (!Number.isFinite(n)) throw `${label} muss eine Zahl sein.`;
    if (n < min) throw min === 0 ? `${label} darf nicht negativ sein.` : `${label} muss mindestens ${min} sein.`;
    if (n > max) throw `${label} ist zu groß.`;
    return Math.round(n * 100) / 100;
  },
  date: ({ label, required = false } = {}) => (val) => {
    if (isEmpty(val)) {
      if (required) throw `${label} ist ein Pflichtfeld.`;
      return null;
    }
    const s = String(val).trim().slice(0, 10);
    if (!DATE_RE.test(s)) throw `${label}: ungültiges Datum.`;
    const d = new Date(s + 'T00:00:00Z');
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw `${label}: ungültiges Datum.`;
    return s;
  },
  datetime: ({ label, required = false } = {}) => (val) => {
    if (isEmpty(val)) {
      if (required) throw `${label} ist ein Pflichtfeld.`;
      return null;
    }
    const d = new Date(String(val));
    if (Number.isNaN(d.getTime())) throw `${label}: ungültiges Datum/Uhrzeit.`;
    return d.toISOString();
  },
  oneOf: (list, { label, required = false, def } = {}) => (val) => {
    if (isEmpty(val)) {
      if (def !== undefined) return def;
      if (required) throw `${label} ist ein Pflichtfeld.`;
      return null;
    }
    if (!list.includes(val)) throw `${label}: ungültiger Wert.`;
    return val;
  },
  bool: ({ label } = {}) => (val) => {
    if (val === true || val === 'true' || val === 1 || val === '1') return true;
    if (val === false || val === 'false' || val === 0 || val === '0' || isEmpty(val)) return false;
    throw `${label}: ungültiger Wert.`;
  },
  ref: ({ label, required = false } = {}) => (val) => {
    if (isEmpty(val)) {
      if (required) throw `${label} ist ein Pflichtfeld.`;
      return null;
    }
    const n = Number(val);
    if (!Number.isInteger(n) || n <= 0) throw `${label}: ungültige Auswahl.`;
    return n;
  },
  ids: ({ label } = {}) => (val) => {
    if (isEmpty(val)) return [];
    if (!Array.isArray(val)) throw `${label}: ungültige Liste.`;
    const out = [];
    for (const x of val) {
      const n = Number(x);
      if (!Number.isInteger(n) || n <= 0) throw `${label}: ungültige Auswahl.`;
      if (!out.includes(n)) out.push(n);
    }
    return out;
  },
};

/**
 * Validiert `input` gegen `schema` ({ feld: validator }).
 * partial=true: nur übergebene Felder werden geprüft/zurückgegeben (für PATCH).
 */
export function validate(input, schema, { partial = false } = {}) {
  const out = {};
  const errors = {};
  for (const [key, fn] of Object.entries(schema)) {
    if (partial && !(key in input)) continue;
    try {
      out[key] = fn(input[key]);
    } catch (msg) {
      if (typeof msg !== 'string') throw msg;
      errors[key] = msg;
    }
  }
  if (Object.keys(errors).length) {
    throw new HttpError(422, Object.values(errors)[0], errors);
  }
  return out;
}

export function assertDateRange(start, end, labelStart = 'Startdatum', labelEnd = 'Enddatum') {
  if (start && end && end < start) {
    throw new HttpError(422, `${labelEnd} darf nicht vor dem ${labelStart} liegen.`, { end_date: `${labelEnd} liegt vor ${labelStart}.` });
  }
}
