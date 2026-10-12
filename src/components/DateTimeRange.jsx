// Beginn (Datum + Uhrzeit) und Ende (Datum + Uhrzeit) – überall gleich (Kalender, Media-Produktion)
import { Field } from './ui.jsx';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toDate = (date, time) => {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, h || 0, mi || 0);
};

/** ISO-Zeitpunkte → Formularwerte. Bei ganztägig ist das Ende exklusiv (nächster Tag 00:00). */
export function rangeToParts(startIso, endIso, { allDay = false, defaultMinutes = 60 } = {}) {
  if (!startIso) return { startDate: '', startTime: '', endDate: '', endTime: '' };
  const s = new Date(startIso);
  let e = endIso ? new Date(endIso) : new Date(s.getTime() + defaultMinutes * 60e3);
  if (allDay) e = new Date(e.getTime() - 1);
  return { startDate: ymd(s), startTime: hm(s), endDate: ymd(e), endTime: hm(e) };
}

/** Formularwerte → { start, end } als ISO (oder null, wenn kein Beginn). Fehlertext in `error`. */
export function partsToRange(p, { allDay = false } = {}) {
  if (!p.startDate) return { start: null, end: null };
  let s = toDate(p.startDate, allDay ? '00:00' : p.startTime || '00:00');
  let e;
  if (allDay) {
    e = toDate(p.endDate || p.startDate, '00:00');
    e.setDate(e.getDate() + 1);
  } else {
    e = toDate(p.endDate || p.startDate, p.endTime || p.startTime || '00:00');
  }
  if (e < s) return { start: null, end: null, error: 'Das Ende liegt vor dem Beginn.' };
  return { start: s.toISOString(), end: e.toISOString() };
}

/**
 * value: { startDate, startTime, endDate, endTime }
 * Verschiebt beim Ändern des Beginns das Ende mit (Dauer bleibt gleich).
 */
export function DateTimeRange({ value, onChange, allDay = false, errors = {}, labels = {}, defaultMinutes = 60, required = false }) {
  const v = value || {};
  const set = (patch) => onChange({ ...v, ...patch });
  const duration = () => {
    const s = toDate(v.startDate, v.startTime);
    const e = toDate(v.endDate, v.endTime);
    return s && e && e >= s ? e - s : defaultMinutes * 60e3;
  };
  const moveStart = (date, time) => {
    if (!date) return set({ startDate: '', startTime: '', endDate: '', endTime: '' });
    const s = toDate(date, time || v.startTime || '10:00');
    const e = new Date(s.getTime() + duration());
    onChange({ startDate: ymd(s), startTime: time ?? (v.startTime || '10:00'), endDate: ymd(e), endTime: hm(e) });
  };
  return (
    <div className="dt-range span-2">
      <div className="dt-row">
        <Field label={labels.start || 'Beginn'} required={required} error={errors.start}>
          <div className="dt-inputs">
            <input className="input" type="date" value={v.startDate || ''} onChange={(e) => moveStart(e.target.value, v.startTime)} aria-label="Startdatum" />
            {!allDay && <input className="input dt-time" type="time" step="900" value={v.startTime || ''} disabled={!v.startDate}
              onChange={(e) => moveStart(v.startDate, e.target.value)} aria-label="Startzeit" />}
          </div>
        </Field>
        <Field label={labels.end || 'Ende'} error={errors.end}>
          <div className="dt-inputs">
            <input className="input" type="date" value={v.endDate || ''} min={v.startDate || undefined} disabled={!v.startDate}
              onChange={(e) => set({ endDate: e.target.value })} aria-label="Enddatum" />
            {!allDay && <input className="input dt-time" type="time" step="900" value={v.endTime || ''} disabled={!v.startDate}
              onChange={(e) => set({ endTime: e.target.value })} aria-label="Endzeit" />}
          </div>
        </Field>
      </div>
      {v.startDate && !allDay && <DurationHint v={v} />}
    </div>
  );
}

function DurationHint({ v }) {
  const s = toDate(v.startDate, v.startTime);
  const e = toDate(v.endDate, v.endTime);
  if (!s || !e) return null;
  if (e < s) return <div className="dt-hint tone-red">Das Ende liegt vor dem Beginn.</div>;
  const min = Math.round((e - s) / 60e3);
  const days = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const txt = [days && `${days} ${days === 1 ? 'Tag' : 'Tage'}`, h && `${h} Std.`, m && `${m} Min.`].filter(Boolean).join(' ') || '0 Min.';
  return <div className="dt-hint muted">Dauer: {txt}</div>;
}
