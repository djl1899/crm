// Team-Kalender im Stil von Teams/Outlook: links Personen auswählen, rechts Wochenübersicht
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useApi, invalidateAll } from '../lib/useApi.js';
import { useAuth } from '../lib/auth.jsx';
import { useNavigate } from '../lib/router.jsx';
import { Button, Field, Select, Modal, Segmented, Spinner, ErrorBox, useUi, handleFormError } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { CreatorPicker } from '../components/forms.jsx';
import { DateTimeRange, rangeToParts, partsToRange } from '../components/DateTimeRange.jsx';
import { TEAM_EVENT_KINDS } from '../../shared/constants.js';

const HOUR_PX = 48;
const DAY_NAMES = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const SOURCES = [
  { key: 'event', label: 'Termine' },
  { key: 'task', label: 'Aufgaben' },
  { key: 'media', label: 'Media-Produktion' },
  { key: 'deal', label: 'Deal-Termine' },
  { key: 'followup', label: 'Follow-ups' },
];
const UNASSIGNED = 0;

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const sameDay = (a, b) => ymd(a) === ymd(b);
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

function load(key, def) {
  try { const x = JSON.parse(localStorage.getItem(key)); return x ?? def; } catch { return def; }
}
function store(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* egal */ }
}

export function TeamCalendarPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 760;
  const [view, setView] = useState(() => (isMobile ? 'day' : load('tcal-view', 'week')));
  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => load('tcal-users', null));
  const [sources, setSources] = useState(() => load('tcal-sources', SOURCES.map((s) => s.key)));
  const [edit, setEdit] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  useEffect(() => store('tcal-view', view), [view]);
  useEffect(() => store('tcal-sources', sources), [sources]);
  useEffect(() => { if (selected) store('tcal-users', selected); }, [selected]);

  const days = useMemo(() => {
    if (view === 'day') return [new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())];
    const s = startOfWeek(anchor);
    return Array.from({ length: view === 'workweek' ? 5 : 7 }, (_, i) => addDays(s, i));
  }, [view, anchor]);
  const range = { start: ymd(days[0]), end: ymd(days[days.length - 1]) };
  const { data, error, loading, reload } = useApi(`/team-calendar?start=${range.start}&end=${range.end}`);
  const users = data?.users.filter((u) => u.is_active) || [];
  const colorOf = useMemo(() => Object.fromEntries((data?.users || []).map((u) => [u.id, u.color])), [data]);
  const nameOf = useMemo(() => Object.fromEntries((data?.users || []).map((u) => [u.id, u.name])), [data]);
  const sel = selected || [user.id];

  const items = (data?.items || []).filter((it) => {
    if (!sources.includes(it.source)) return false;
    if (!it.user_ids.length) return sel.includes(UNASSIGNED);
    return it.user_ids.some((id) => sel.includes(id));
  });
  // Farbe: erste ausgewählte Person, die beteiligt ist
  const colorFor = (it) => {
    const uid = it.user_ids.find((id) => sel.includes(id));
    return uid ? colorOf[uid] : '#6b7280';
  };

  const toggleUser = (id) => setSelected(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  const toggleSource = (k) => setSources(sources.includes(k) ? sources.filter((x) => x !== k) : [...sources, k]);
  const step = view === 'day' ? 1 : 7;
  const label = view === 'day'
    ? days[0].toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : days[0].getMonth() === days[days.length - 1].getMonth()
      ? `${days[0].getDate()}.–${days[days.length - 1].getDate()}. ${MONTHS[days[0].getMonth()]} ${days[0].getFullYear()}`
      : `${days[0].getDate()}. ${MONTHS[days[0].getMonth()].slice(0, 3)} – ${days[days.length - 1].getDate()}. ${MONTHS[days[days.length - 1].getMonth()].slice(0, 3)} ${days[days.length - 1].getFullYear()}`;

  const openItem = (it) => {
    if (it.source === 'event') setEdit(it);
    else if (it.link) navigate(it.link);
  };
  const newAt = (date, hour = 9, minute = 0) => {
    const s = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
    setEdit({ start: s.toISOString(), end: new Date(s.getTime() + 3600e3).toISOString(), user_ids: [user.id], all_day: false });
  };

  return (
    <div className="tcal">
      <aside className={`tcal-side ${panelOpen ? 'open' : ''}`}>
        <Button variant="primary" icon="plus" className="btn-block" onClick={() => newAt(days[0], 10)}>Neuer Termin</Button>
        <MiniMonth value={anchor} days={days} onPick={(d) => { setAnchor(d); setPanelOpen(false); }} />
        <div className="tcal-section">
          <div className="tcal-section-head">
            <span>Personen</span>
            <span className="row">
              <button className="link small" onClick={() => setSelected([user.id])}>Nur ich</button>
              <button className="link small" onClick={() => setSelected([...users.map((u) => u.id), UNASSIGNED])}>Alle</button>
            </span>
          </div>
          {users.map((u) => (
            <label key={u.id} className="tcal-person">
              <input type="checkbox" checked={sel.includes(u.id)} onChange={() => toggleUser(u.id)} style={{ accentColor: u.color }} />
              <span className="tcal-avatar" style={{ background: u.color }}>{u.name.split(/\s+/).map((x) => x[0]).slice(0, 2).join('')}</span>
              <span className="grow clamp-1">{u.name}{u.id === user.id ? ' (ich)' : ''}</span>
            </label>
          ))}
          <label className="tcal-person">
            <input type="checkbox" checked={sel.includes(UNASSIGNED)} onChange={() => toggleUser(UNASSIGNED)} />
            <span className="tcal-avatar" style={{ background: '#9ca3af' }}>?</span>
            <span className="grow">Ohne Zuständigkeit</span>
          </label>
        </div>
        <div className="tcal-section">
          <div className="tcal-section-head"><span>Anzeigen</span></div>
          {SOURCES.map((s) => (
            <label key={s.key} className="tcal-person">
              <input type="checkbox" checked={sources.includes(s.key)} onChange={() => toggleSource(s.key)} />
              <span className="grow">{s.label}</span>
            </label>
          ))}
        </div>
      </aside>
      {panelOpen && <div className="sidebar-backdrop tcal-backdrop" onClick={() => setPanelOpen(false)} />}

      <section className="tcal-main card">
        <div className="tcal-toolbar">
          <button className="icon-btn icon-btn-bordered tcal-panel-btn" onClick={() => setPanelOpen(true)} aria-label="Personen auswählen"><Icon name="users" size={16} /></button>
          <Button size="sm" onClick={() => setAnchor(new Date())}>Heute</Button>
          <button className="icon-btn" onClick={() => setAnchor(addDays(anchor, -step))} aria-label="Zurück"><Icon name="chevronLeft" size={18} /></button>
          <button className="icon-btn" onClick={() => setAnchor(addDays(anchor, step))} aria-label="Weiter"><Icon name="chevronRight" size={18} /></button>
          <div className="tcal-label">{label}</div>
          {loading && <span className="spinner spinner-sm" aria-label="Lädt" />}
          <div className="grow" />
          <Segmented value={view} onChange={setView} options={[{ value: 'day', label: 'Tag' }, { value: 'workweek', label: 'Arbeitswoche' }, { value: 'week', label: 'Woche' }]} />
        </div>
        {error && !data ? <ErrorBox error={error} onRetry={reload} /> : !data ? <Spinner /> : (
          <WeekGrid days={days} items={items} colorFor={colorFor} nameOf={nameOf} onOpen={openItem} onNew={newAt} />
        )}
      </section>
      <EventModal event={edit} users={users} onClose={() => setEdit(null)} />
    </div>
  );
}

// ------------------------------------------------------------------
function MiniMonth({ value, days, onPick }) {
  const [cursor, setCursor] = useState(new Date(value.getFullYear(), value.getMonth(), 1));
  useEffect(() => setCursor(new Date(value.getFullYear(), value.getMonth(), 1)), [value]);
  const start = startOfWeek(cursor);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const today = new Date();
  const inRange = (d) => days.some((x) => sameDay(x, d));
  return (
    <div className="mini-month">
      <div className="mini-month-head">
        <strong>{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</strong>
        <span>
          <button className="icon-btn" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} aria-label="Vorheriger Monat"><Icon name="chevronLeft" size={14} /></button>
          <button className="icon-btn" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} aria-label="Nächster Monat"><Icon name="chevronRight" size={14} /></button>
        </span>
      </div>
      <div className="mini-month-grid">
        {DAY_NAMES.map((d) => <span key={d} className="mm-dow">{d[0]}</span>)}
        {cells.map((d) => (
          <button key={ymd(d)} onClick={() => onPick(d)}
            className={`mm-day ${d.getMonth() !== cursor.getMonth() ? 'other' : ''} ${sameDay(d, today) ? 'today' : ''} ${inRange(d) ? 'in' : ''}`}>{d.getDate()}</button>
        ))}
      </div>
    </div>
  );
}

// Überlappende Termine nebeneinander anordnen
function layoutDay(events) {
  const sorted = [...events].sort((a, b) => a.s - b.s || b.e - a.e);
  const out = [];
  let group = [];
  let groupEnd = 0;
  const flush = () => {
    const cols = [];
    for (const ev of group) {
      let c = cols.findIndex((end) => end <= ev.s);
      if (c === -1) { c = cols.length; cols.push(0); }
      cols[c] = ev.e;
      ev.col = c;
    }
    for (const ev of group) { ev.cols = cols.length; out.push(ev); }
    group = [];
  };
  for (const ev of sorted) {
    if (group.length && ev.s >= groupEnd) flush();
    group.push(ev);
    groupEnd = Math.max(groupEnd, ev.e);
  }
  flush();
  return out;
}

function WeekGrid({ days, items, colorFor, nameOf, onOpen, onNew }) {
  const scroller = useRef(null);
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  const wrap = useRef(null);
  useLayoutEffect(() => { if (scroller.current) scroller.current.scrollTop = 7 * HOUR_PX; }, []);
  // Breite der Scrollleiste ausgleichen, damit Kopfzeile und Raster bündig sind
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && wrap.current) wrap.current.style.setProperty('--sbw', `${el.offsetWidth - el.clientWidth}px`);
  });

  // Ganztägige Einträge + mehrtägige Termine pro Tag
  const allDay = days.map((d) => items.filter((it) => {
    if (it.all_day && it.date) return it.date === ymd(d);
    if (it.all_day) { const s = new Date(it.start), e = new Date(it.end); return ymd(s) <= ymd(d) && ymd(new Date(e.getTime() - 1)) >= ymd(d); }
    return false;
  }));
  const timed = days.map((d) => {
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayEnd = dayStart + 864e5;
    const evs = items.filter((it) => !it.all_day && new Date(it.start).getTime() < dayEnd && new Date(it.end).getTime() > dayStart)
      .map((it) => {
        const s = Math.max(new Date(it.start).getTime(), dayStart);
        const e = Math.min(Math.max(new Date(it.end).getTime(), new Date(it.start).getTime() + 15 * 60e3), dayEnd);
        return { it, s: (s - dayStart) / 60e3, e: (e - dayStart) / 60e3 };
      });
    return layoutDay(evs);
  });
  const maxAllDay = Math.max(1, ...allDay.map((x) => x.length));

  const clickSlot = (d, ev) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const minutes = Math.floor(((ev.clientY - rect.top) / HOUR_PX) * 2) * 30;
    onNew(d, Math.floor(minutes / 60), minutes % 60);
  };

  return (
    <div className="tcal-grid-wrap" ref={wrap} style={{ '--days': days.length }}>
      <div className="tcal-head">
        <div className="tcal-gutter" />
        {days.map((d) => (
          <div key={ymd(d)} className={`tcal-dayhead ${sameDay(d, now) ? 'today' : ''}`}>
            <span className="tcal-dow">{DAY_NAMES[(d.getDay() + 6) % 7]}</span>
            <span className="tcal-dnum">{d.getDate()}</span>
          </div>
        ))}
      </div>
      <div className="tcal-allday">
        <div className="tcal-gutter small muted">ganztägig</div>
        {days.map((d, i) => (
          <div key={ymd(d)} className="tcal-allday-cell" style={{ minHeight: Math.min(maxAllDay, 6) * 24 + 8 }}>
            {allDay[i].map((it) => (
              <button key={it.id} className={`tcal-chip src-${it.source}`} style={{ '--c': colorFor(it) }} onClick={() => onOpen(it)} title={`${it.kind}: ${it.title}`}>
                {it.title}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="tcal-scroll" ref={scroller}>
        <div className="tcal-body" style={{ height: 24 * HOUR_PX }}>
          <div className="tcal-gutter tcal-hours">
            {Array.from({ length: 24 }, (_, h) => <div key={h} className="tcal-hour" style={{ top: h * HOUR_PX }}>{h ? `${pad(h)}:00` : ''}</div>)}
          </div>
          {days.map((d, i) => (
            <div key={ymd(d)} className={`tcal-col ${[5, 6].includes((d.getDay() + 6) % 7) ? 'weekend' : ''}`} onClick={(e) => e.target === e.currentTarget && clickSlot(d, e)}>
              {timed[i].map(({ it, s, e, col, cols }) => {
                const short = e - s < 45;
                const compact = !short && e - s <= 75;
                return (
                  <button key={it.id + i} className={`tcal-event src-${it.source} ${short ? 'short' : ''} ${compact ? 'compact' : ''}`} onClick={() => onOpen(it)}
                    style={{ '--c': colorFor(it), top: (s / 60) * HOUR_PX + 1, height: Math.max(((e - s) / 60) * HOUR_PX - 2, 18), left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)` }}
                    title={`${hm(new Date(it.start))}–${hm(new Date(it.end))} ${it.title}`}>
                    <span className="tcal-event-title">{it.title}</span>
                    {!short && <span className="tcal-event-meta">{hm(new Date(it.start))}–{hm(new Date(it.end))}{it.location ? ` · ${it.location}` : ''}</span>}
                    {!short && !compact && it.user_ids.length > 1 && <span className="tcal-event-meta">{it.user_ids.map((u) => nameOf[u]?.split(' ')[0]).filter(Boolean).join(', ')}</span>}
                  </button>
                );
              })}
              {sameDay(d, now) && <div className="tcal-now" style={{ top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX }} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
function EventModal({ event, users, onClose }) {
  const { toast, confirm } = useUi();
  const [v, setV] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const isEdit = !!event?.event_id;
  useEffect(() => {
    if (!event) return;
    setErrors({});
    setV({
      title: event.title || '', kind: event.kind || 'Termin', all_day: !!event.all_day,
      when: rangeToParts(event.start, event.end, { allDay: !!event.all_day }),
      location: event.location || '', notes: event.notes || '', attendee_ids: event.user_ids || [],
      creator_id: event.creator_id || null, creator_label: event.creator_name || '',
    });
  }, [event]);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const toggleAtt = (id) => setV((x) => ({ ...x, attendee_ids: x.attendee_ids.includes(id) ? x.attendee_ids.filter((y) => y !== id) : [...x.attendee_ids, id] }));

  const save = async (ev) => {
    ev.preventDefault();
    const r = partsToRange(v.when, { allDay: v.all_day });
    if (r.error || !r.start) return setErrors({ end: r.error || 'Bitte einen Beginn angeben.' });
    setSaving(true);
    try {
      const body = { title: v.title, kind: v.kind, all_day: v.all_day, starts_at: r.start, ends_at: r.end, location: v.location, notes: v.notes, attendee_ids: v.attendee_ids, creator_id: v.creator_id || null };
      if (isEdit) await api.patch(`/team-events/${event.event_id}`, body);
      else await api.post('/team-events', body);
      invalidateAll();
      toast(isEdit ? 'Termin gespeichert.' : 'Termin angelegt.');
      onClose();
    } catch (err) {
      handleFormError(err, setErrors, toast);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Termin löschen?', message: `„${event.title}“ wird für alle Teilnehmer entfernt.`, confirmLabel: 'Löschen', danger: true }))) return;
    try {
      await api.del(`/team-events/${event.event_id}`);
      invalidateAll();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <Modal open={!!event} onClose={onClose} title={isEdit ? 'Termin bearbeiten' : 'Neuer Termin'} size="lg"
      footer={<>
        {isEdit && <Button variant="ghost-danger" icon="trash" onClick={remove} className="mr-auto">Löschen</Button>}
        <Button onClick={onClose}>Abbrechen</Button>
        <Button variant="primary" type="submit" form="tevent-form" loading={saving}>Speichern</Button>
      </>}>
      <form id="tevent-form" className="form-grid" onSubmit={save}>
        <Field label="Titel" required error={errors.title} className="span-2">
          <input className="input" value={v.title || ''} onChange={set('title')} placeholder="z. B. Shooting mit Anna, Call mit Marke, Schnitt Reel" autoFocus />
        </Field>
        <Field label="Art" error={errors.kind}><Select value={v.kind} onChange={set('kind')} options={TEAM_EVENT_KINDS} /></Field>
        <Field label=" "><label className="checkline"><input type="checkbox" checked={!!v.all_day} onChange={set('all_day')} /> Ganztägig</label></Field>
        <DateTimeRange value={v.when} onChange={(when) => { setV((x) => ({ ...x, when })); setErrors({}); }} allDay={!!v.all_day} required
          errors={{ start: errors.starts_at, end: errors.end || errors.ends_at }} labels={v.all_day ? { start: 'Erster Tag', end: 'Letzter Tag' } : {}} />
        <Field label="Für wen?" className="span-2" error={errors.attendee_ids} hint="Erscheint im Kalender aller ausgewählten Personen.">
          <div className="tcal-att">
            {users.map((u) => (
              <button type="button" key={u.id} className={`tcal-att-chip ${v.attendee_ids?.includes(u.id) ? 'on' : ''}`} style={{ '--c': u.color }} onClick={() => toggleAtt(u.id)}>
                <span className="tcal-avatar sm" style={{ background: u.color }}>{u.name.split(/\s+/).map((x) => x[0]).slice(0, 2).join('')}</span>{u.name}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Ort" error={errors.location}><input className="input" value={v.location || ''} onChange={set('location')} placeholder="Adresse, Studio oder Link" /></Field>
        <Field label="Creator (optional)" error={errors.creator_id}>
          {event && <CreatorPicker value={v.creator_id} initialLabel={v.creator_label} onChange={(id, label) => setV((x) => ({ ...x, creator_id: id, creator_label: label }))} />}
        </Field>
        <Field label="Notizen" error={errors.notes} className="span-2"><textarea className="input" rows={3} value={v.notes || ''} onChange={set('notes')} placeholder="Was ist zu tun, was mitbringen, Ansprechpartner…" /></Field>
        {isEdit && event.created_by_name && <p className="small muted span-2">Angelegt von {event.created_by_name}</p>}
      </form>
    </Modal>
  );
}
