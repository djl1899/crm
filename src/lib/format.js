const nf = new Intl.NumberFormat('de-DE');
const cf = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2, minimumFractionDigits: 0 });
const df = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dtf = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const fmtNumber = (n) => (n === null || n === undefined || n === '' ? '–' : nf.format(Number(n)));
export const fmtMoney = (n) => cf.format(Number(n || 0));
export const fmtPercent = (n) => (n === null || n === undefined ? '–' : `${String(Number(n).toFixed(1)).replace('.', ',')} %`);

export function fmtCompact(n) {
  if (n === null || n === undefined) return '–';
  const x = Number(n);
  if (x >= 1_000_000) return `${String((x / 1_000_000).toFixed(1)).replace('.', ',').replace(',0', '')} Mio.`;
  if (x >= 10_000) return `${Math.round(x / 1000)} Tsd.`;
  return nf.format(x);
}

// 'YYYY-MM-DD' → '12.09.2026' (ohne Zeitzonen-Verschiebung)
export function fmtDate(s) {
  if (!s) return '–';
  const str = String(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-');
    return `${d}.${m}.${y}`;
  }
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? '–' : df.format(d);
}
export function fmtDateTime(s) {
  if (!s) return '–';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '–' : dtf.format(d) + ' Uhr';
}

export function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtRelative(s) {
  if (!s) return '–';
  const d = new Date(s);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'gerade eben';
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return 'gestern';
  if (days < 30) return `vor ${days} Tagen`;
  return fmtDate(s);
}

// Relativ für ein Fälligkeitsdatum ('YYYY-MM-DD')
export function fmtDue(s) {
  if (!s) return '–';
  const today = todayStr();
  const a = new Date(s + 'T12:00:00');
  const b = new Date(today + 'T12:00:00');
  const days = Math.round((a - b) / 86400000);
  if (days === 0) return 'heute';
  if (days === 1) return 'morgen';
  if (days === -1) return 'gestern';
  if (days < 0) return `vor ${-days} Tagen`;
  if (days < 14) return `in ${days} Tagen`;
  return fmtDate(s);
}

export const fmtBytes = (b) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);

export const initials = (name) =>
  String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

// ISO → Wert für <input type="datetime-local">
export function toLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
