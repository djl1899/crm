// Creator-Bereich: eigene Oberfläche für eingeloggte Creator.
// Das Team kann denselben Bereich als Vorschau öffnen (/creators/:id/ansicht) – dann nur lesend.
import { createContext, Fragment, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, matchPath, Link, useNavigate } from '../lib/router.jsx';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { useApi, invalidateAll } from '../lib/useApi.js';
import {
  Button, Card, Badge, Avatar, Spinner, ErrorBox, Empty, PageHeader, Segmented, Field, Select, Modal, useUi, handleFormError,
} from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { fmtMoney, fmtDate, fmtDue, fmtBytes, fmtDateTime, fmtNumber, todayStr } from '../lib/format.js';
import { ProfileCard, PasswordCard, TwoFactorCard } from '../pages/Settings.jsx';
import {
  SIZE_TOP_GROUPS, SIZE_BOTTOM_GROUPS, SHOE_SIZES, MAX_UPLOAD_BYTES, CREATOR_STAGES, CALENDAR_KINDS, CREATOR_EXPENSE_CATEGORIES,
} from '../../shared/constants.js';

// ------------------------------------------------------------------
// Kontext: Basis-Pfad + Vorschau
// ------------------------------------------------------------------
const PortalCtx = createContext({ base: '', preview: false, as: null });
const usePortal = () => {
  const ctx = useContext(PortalCtx);
  return {
    ...ctx,
    to: (path) => ctx.base + (path === '/' ? '' : path) || '/',
    p: (path) => (ctx.as ? `${path}${path.includes('?') ? '&' : '?'}as=${ctx.as}` : path),
  };
};
const PREVIEW_HINT = 'In der Vorschau nicht möglich';

const NAV = [
  { to: '/', label: 'Übersicht', icon: 'home' },
  { to: '/kalender', label: 'Kalender', icon: 'calendar' },
  { to: '/kooperationen', label: 'Kooperationen', icon: 'briefcase' },
  { to: '/finanzen', label: 'Finanzen', icon: 'wallet' },
  { to: '/rechnungen', label: 'Rechnungen & Export', icon: 'euro' },
  { to: '/dokumente', label: 'Verträge & Dokumente', icon: 'file' },
  { section: 'Konto' },
  { to: '/profil', label: 'Meine Daten', icon: 'user' },
  { to: '/einstellungen', label: 'Sicherheit', icon: 'lock', hideInPreview: true },
];

const STAGE_TONE = {
  Anfrage: 'gray', Verhandlung: 'orange', 'Bestätigt': 'blue', 'Content fällig': 'violet', 'Veröffentlicht': 'teal', Rechnung: 'amber', Bezahlt: 'green', Abgebrochen: 'red',
};
const StageBadge = ({ stage }) => <Badge tone={STAGE_TONE[stage] || 'gray'} dot>{stage}</Badge>;
const KIND_TONE = {
  Briefing: 'blue', Freigabe: 'teal', 'Content-Abgabe': 'violet', 'Veröffentlichung': 'green', Zahlung: 'amber',
  Erinnerung: 'red', Frist: 'red', 'Content-Plan': 'gray', Termin: 'orange',
};
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const MONTHS_LONG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const CAN_SUBMIT = ['Geplant', 'Aktiv', 'Content ausstehend', 'Abnahme'];
const pct = (n) => `${String(Number(n)).replace('.', ',')} %`;

const ROUTES = [
  ['/', HomePage],
  ['/kalender', CalendarPage],
  ['/kooperationen', CollabsPage],
  ['/kooperationen/:id', CollabDetailPage],
  ['/finanzen', FinancePage],
  ['/rechnungen', InvoicesPage],
  ['/dokumente', DocumentsPage],
  ['/profil', ProfilePage],
  ['/einstellungen', SecurityPage],
];

export function PortalApp({ agencyName = 'LLK Management', previewId = null }) {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [pathname]);
  const base = previewId ? `/creators/${previewId}/ansicht` : '';
  const ctx = useMemo(() => ({ base, preview: !!previewId, as: previewId }), [base, previewId]);
  const local = (base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname) || '/';
  const isActive = (to) => (to === '/' ? local === '/' : local === to || local.startsWith(to + '/'));
  const head = useApi(previewId ? `/portal/overview?as=${previewId}` : null);
  const link = (to) => base + (to === '/' ? '' : to) || '/';

  let page = <Empty icon="alert" title="Seite nicht gefunden" text="Diese Seite gibt es im Creator-Bereich nicht." action={<Link to={link('/')} className="link">Zur Übersicht</Link>} />;
  for (const [pattern, Page] of ROUTES) {
    if (previewId && pattern === '/einstellungen') continue;
    const params = matchPath(pattern, local);
    if (params) { page = <Page key={pattern + JSON.stringify(params)} params={params} />; break; }
  }
  const name = previewId ? head.data?.creator?.display_name || 'Creator' : user.name;

  return (
    <PortalCtx.Provider value={ctx}>
      <div className={`app portal ${previewId ? 'portal-preview' : ''}`}>
        {previewId && (
          <div className="preview-banner">
            <Icon name="eye" size={16} />
            <span><strong>Vorschau:</strong> So sieht {name} den Creator-Bereich. Nur ansehen – Änderungen sind hier gesperrt.</span>
            <Link to={`/creators/${previewId}`} className="preview-banner-btn"><Icon name="x" size={14} /> Vorschau schließen</Link>
          </div>
        )}
        <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
          <div className="brand">
            <span className="brand-stack"><img src="/llk-logo.png" alt={agencyName} className="brand-logo" /><span className="brand-sub">Creator-Bereich</span></span>
            <button className="icon-btn sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Menü schließen"><Icon name="x" /></button>
          </div>
          <nav className="nav">
            {NAV.filter((n) => !(previewId && n.hideInPreview)).map((n, i) =>
              n.section ? <div key={i} className="nav-section">{n.section}</div> : (
                <Link key={n.to} to={link(n.to)} className={`nav-item ${isActive(n.to) ? 'active' : ''}`}>
                  <Icon name={n.icon} size={18} /><span>{n.label}</span>
                </Link>
              )
            )}
          </nav>
          <div className="sidebar-footer">
            <Avatar name={name} size={32} />
            <div className="sidebar-user">
              <div className="sidebar-user-name">{name}</div>
              <div className="sidebar-user-role">{previewId ? 'Vorschau' : 'Creator'}</div>
            </div>
            {!previewId && <button className="icon-btn" onClick={logout} title="Abmelden" aria-label="Abmelden"><Icon name="logout" size={17} /></button>}
          </div>
        </aside>
        {mobileOpen && <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />}
        <div className="main">
          <header className="topbar portal-topbar">
            <button className="icon-btn menu-toggle" onClick={() => setMobileOpen(true)} aria-label="Menü öffnen"><Icon name="menu" /></button>
            <div className="portal-topbar-title"><img src="/llk-logo.png" alt={agencyName} className="brand-logo brand-logo-sm" /></div>
            <div className="topbar-actions">
              {!previewId && <button className="icon-btn" onClick={logout} title="Abmelden" aria-label="Abmelden"><Icon name="logout" size={17} /></button>}
            </div>
          </header>
          <main className="content">{page}</main>
        </div>
      </div>
    </PortalCtx.Provider>
  );
}

// ------------------------------------------------------------------
// Übersicht
// ------------------------------------------------------------------
function HomePage() {
  const { p, to, preview } = usePortal();
  const { data, error, loading, reload } = useApi(p('/portal/overview'));
  const { toast } = useUi();
  if (loading && !data) return <Spinner label="Lade deinen Bereich…" />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const { creator, income, buffer, events, todos, documents, messages, active, year, by_stage } = data;
  const h = new Date().getHours();
  const hello = h < 11 ? 'Guten Morgen' : h < 18 ? 'Hallo' : 'Guten Abend';
  const open = (by_stage['Anfrage'] || 0) + (by_stage['Verhandlung'] || 0);

  const done = async (t) => {
    try {
      await api.post(`/portal/todos/${t.id}/done`);
      invalidateAll();
      toast('Danke! Dein Team ist informiert.');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="page">
      <div className="portal-hello">
        <Avatar name={creator.display_name} url={creator.avatar_url} size={52} />
        <div>
          <h1 className="page-title">{hello}, {creator.first_name || creator.display_name}</h1>
          <p className="page-subtitle">Deine Deals, Termine und Finanzen auf einen Blick.</p>
        </div>
      </div>

      {creator.profile_missing.length > 0 && (
        <Link to={to('/profil')} className="portal-notice">
          <Icon name="alert" size={18} />
          <span><strong>Deine Rechnungs- oder Bankdaten fehlen noch.</strong> Ohne sie können wir nicht abrechnen – trag sie kurz unter „Meine Daten“ ein.</span>
          <Icon name="chevronRight" size={16} />
        </Link>
      )}

      <div className="stat-row portal-stats">
        <StatTile icon="clock" label={`Erwartet ${year}`} value={fmtMoney(income.expected.net)} hint={`${income.expected.count} Deals bestätigt`} to={to('/finanzen')} />
        <StatTile icon="file" label="Fakturiert, offen" value={fmtMoney(income.invoiced.net)} hint={income.invoiced.vat ? `+ ${fmtMoney(income.invoiced.vat)} USt` : null} to={to('/finanzen')} />
        <StatTile icon="check" label={`Bezahlt ${year}`} value={fmtMoney(income.paid.net)} tone="green" to={to('/finanzen')} />
        <StatTile icon="lock" label="Steuerpuffer (Schätzung)" value={fmtMoney(buffer.total)} hint={`${pct(buffer.rate)} + USt-Zahllast`} to={to('/finanzen')} />
      </div>

      <div className="grid-2 align-start">
        <div className="stack-lg">
          <Card title="Als Nächstes" subtitle="Termine der nächsten 3 Wochen" padded={false} actions={<Link to={to('/kalender')} className="link small">Kalender</Link>}>
            {!events.length ? <Empty icon="calendar" title="Gerade nichts geplant" text="Briefings, Abgaben und Zahlungen erscheinen hier automatisch." /> : (
              <ul className="portal-list">
                {events.map((e) => <EventRow key={e.id} e={e} />)}
              </ul>
            )}
          </Card>
          {todos.length > 0 && (
            <Card title="Deine To-dos" subtitle="Dein Team wartet hier auf dich" padded={false}>
              <ul className="portal-list">
                {todos.map((t) => (
                  <li key={t.id} className="portal-list-row">
                    <span className="todo-dot" />
                    <div className="grow">
                      <div className="strong">{t.title}</div>
                      <div className="small muted">{[t.brand, t.due_date && `fällig ${fmtDue(t.due_date)}`].filter(Boolean).join(' · ')}</div>
                      {t.description && <div className="small pre-wrap">{t.description}</div>}
                    </div>
                    <Button size="sm" icon="check" onClick={() => done(t)} disabled={preview} title={preview ? PREVIEW_HINT : undefined}>Erledigt</Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Laufende Kooperationen" padded={false} actions={<Link to={to('/kooperationen')} className="link small">Alle{open ? ` · ${open} offene Anfragen` : ''}</Link>}>
            {!active.length ? <Empty icon="briefcase" title="Keine laufenden Deals" text="Sobald ein Deal bestätigt ist, siehst du ihn hier." /> : (
              <ul className="portal-list">
                {active.map((c) => (
                  <li key={c.id}>
                    <Link to={to(`/kooperationen/${c.id}`)} className="portal-list-row">
                      <div className="grow">
                        <div className="strong">{c.brand}{c.campaign_name && <span className="muted"> · {c.campaign_name}</span>}</div>
                        <div className="small muted">{[c.platform, c.deadline && `Abgabe ${fmtDate(c.deadline)}`].filter(Boolean).join(' · ') || 'Details folgen'}</div>
                      </div>
                      <StageBadge stage={c.stage} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="stack-lg">
          {creator.manager_name && (
            <Card title="Dein Ansprechpartner">
              <div className="row">
                <Avatar name={creator.manager_name} size={40} />
                <div>
                  <div className="strong">{creator.manager_name}</div>
                  {creator.manager_email && <a className="link small" href={`mailto:${creator.manager_email}`}>{creator.manager_email}</a>}
                </div>
              </div>
            </Card>
          )}
          <Card title="Neueste Nachrichten" padded={false}>
            {!messages.length ? <Empty icon="message" title="Noch keine Nachrichten" text="Fragen zu einem Deal stellst du direkt in der Kooperation." /> : (
              <ul className="portal-list">
                {messages.map((m) => (
                  <li key={m.id}>
                    <Link to={to(`/kooperationen/${m.collaboration_id}`)} className="portal-list-row">
                      <Icon name="message" size={17} />
                      <div className="grow">
                        <div className="small muted">{m.brand} · {m.mine ? 'Du' : m.author || 'Team'} · {fmtDateTime(m.created_at)}</div>
                        <div className="clamp-1">{m.body}</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Neue Dokumente" padded={false} actions={<Link to={to('/dokumente')} className="link small">Alle</Link>}>
            {!documents.length ? <Empty icon="file" title="Noch keine Dokumente" text="Verträge, Briefings und Rechnungen findest du hier." /> : (
              <ul className="portal-list">
                {documents.map((d) => (
                  <li key={d.id}>
                    <a className="portal-list-row" href={p(`/api/portal/documents/${d.id}/file`)} target="_blank" rel="noopener noreferrer">
                      <Icon name="file" size={18} />
                      <div className="grow"><div className="strong clamp-1">{d.filename}</div><div className="small muted">{d.category} · {fmtDate(d.created_at)}</div></div>
                      <Icon name="external" size={15} />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatTile({ icon, label, value, hint, to, tone }) {
  return (
    <Link to={to} className="stat stat-link">
      <div className="stat-label"><Icon name={icon} size={15} />{label}</div>
      <div className={`stat-value ${tone ? 'tone-' + tone : ''}`}>{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </Link>
  );
}

function EventRow({ e, onEdit }) {
  const { to } = usePortal();
  const overdue = e.date < todayStr() && !e.done;
  const inner = (
    <>
      <div className="portal-date">
        <span>{fmtDate(e.date).slice(0, 6)}</span>
        <small className={overdue && e.source !== 'tax' ? 'tone-red' : ''}>{e.time || fmtDue(e.date)}</small>
      </div>
      <div className="grow">
        <div className={`strong ${e.done ? 'line-through muted' : ''}`}>{e.title}</div>
        {(e.note || e.brand) && <div className="small muted clamp-1">{[e.source === 'entry' && e.brand, e.note].filter(Boolean).join(' · ')}</div>}
      </div>
      <Badge tone={KIND_TONE[e.kind] || 'gray'}>{e.kind}</Badge>
    </>
  );
  if (e.source === 'entry' && onEdit) return <li><button className="portal-list-row btn-reset" onClick={() => onEdit(e)}>{inner}</button></li>;
  if (e.collaboration_id) return <li><Link to={to(`/kooperationen/${e.collaboration_id}`)} className="portal-list-row">{inner}</Link></li>;
  return <li className="portal-list-row">{inner}</li>;
}

// ------------------------------------------------------------------
// Kalender
// ------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function CalendarPage() {
  const { p, preview } = usePortal();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [view, setView] = useState('month');
  const [edit, setEdit] = useState(null);
  const first = cursor;
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const gridStart = new Date(first); gridStart.setDate(1 - ((first.getDay() + 6) % 7));
  const gridEnd = new Date(last); gridEnd.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)));
  const { data, error, loading, reload } = useApi(p(`/portal/calendar?from=${ymd(gridStart)}&to=${ymd(gridEnd)}`));
  const events = data?.events || [];
  const byDay = useMemo(() => {
    const m = {};
    for (const e of events) (m[e.date] ||= []).push(e);
    return m;
  }, [events]);
  const days = [];
  for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  const today = todayStr();
  const monthEvents = events.filter((e) => e.date >= ymd(first) && e.date <= ymd(last));
  const move = (n) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1));
  const openEntry = (e) => setEdit(e.source === 'entry' ? e : null);

  return (
    <div className="page">
      <PageHeader title="Kalender" subtitle="Abgaben, Veröffentlichungen, Briefings, Freigaben, Zahlungen und dein Content-Plan."
        actions={<Button variant="primary" icon="plus" disabled={preview} title={preview ? PREVIEW_HINT : undefined} onClick={() => setEdit({ date: today })}>Eintrag</Button>} />
      <div className="toolbar cal-toolbar">
        <div className="row">
          <button className="icon-btn icon-btn-bordered" onClick={() => move(-1)} aria-label="Vorheriger Monat"><Icon name="chevronLeft" size={16} /></button>
          <div className="cal-title">{MONTHS_LONG[cursor.getMonth()]} {cursor.getFullYear()}</div>
          <button className="icon-btn icon-btn-bordered" onClick={() => move(1)} aria-label="Nächster Monat"><Icon name="chevronRight" size={16} /></button>
          <Button size="sm" onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Heute</Button>
        </div>
        <Segmented value={view} onChange={setView} options={[{ value: 'month', label: 'Monat' }, { value: 'list', label: 'Liste' }]} />
      </div>
      {loading && !data ? <Spinner /> : error && !data ? <ErrorBox error={error} onRetry={reload} /> : view === 'month' ? (
        <div className="card cal">
          <div className="cal-grid cal-head">{['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => <div key={d}>{d}</div>)}</div>
          <div className="cal-grid">
            {days.map((d) => {
              const key = ymd(d);
              const list = byDay[key] || [];
              return (
                <div key={key} className={`cal-day ${d.getMonth() !== cursor.getMonth() ? 'other' : ''} ${key === today ? 'today' : ''}`}
                  onDoubleClick={() => !preview && setEdit({ date: key })}>
                  <div className="cal-num">{d.getDate()}</div>
                  {list.slice(0, 4).map((e) => <CalChip key={e.id} e={e} onEdit={openEntry} />)}
                  {list.length > 4 && <div className="cal-more">+{list.length - 4} weitere</div>}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <Card padded={false}>
          {!monthEvents.length ? <Empty icon="calendar" title="Keine Termine in diesem Monat" /> : (
            <ul className="portal-list">{monthEvents.map((e) => <EventRow key={e.id} e={e} onEdit={openEntry} />)}</ul>
          )}
        </Card>
      )}
      <div className="cal-legend">
        {Object.entries(KIND_TONE).filter(([k]) => k !== 'Termin').map(([k, t]) => <span key={k}><i className={`dot dot-${t}`} />{k}</span>)}
      </div>
      <p className="small muted">Steuerfristen sind allgemeine Termine – ob sie für dich gelten, klärst du am besten mit deinem Steuerberater.</p>
      <EntryModal entry={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

function CalChip({ e, onEdit }) {
  const { to } = usePortal();
  const cls = `cal-chip k-${KIND_TONE[e.kind] || 'gray'} ${e.done ? 'done' : ''}`;
  const label = `${e.time ? e.time + ' ' : ''}${e.title}`;
  if (e.source === 'entry') return <button className={cls} onClick={() => onEdit(e)} title={label}>{label}</button>;
  if (e.collaboration_id) return <Link to={to(`/kooperationen/${e.collaboration_id}`)} className={cls} title={label}>{label}</Link>;
  return <span className={cls} title={`${label}${e.note ? ' – ' + e.note : ''}`}>{label}</span>;
}

function EntryModal({ entry, onClose }) {
  const { toast, confirm } = useUi();
  const { p, preview } = usePortal();
  const collabs = useApi(entry ? p('/portal/collaborations') : null);
  const [v, setV] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const isEdit = !!entry?.entry_id;
  useEffect(() => {
    if (!entry) return;
    setErrors({});
    setV({
      entry_date: entry.date || todayStr(), entry_time: entry.time || '', kind: entry.kind || 'Content-Plan', title: entry.title || '',
      platform: entry.platform || '', collaboration_id: entry.collaboration_id ? String(entry.collaboration_id) : '', notes: entry.note || '', done: !!entry.done,
    });
  }, [entry]);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async (ev) => {
    ev.preventDefault();
    setSaving(true);
    try {
      const body = { ...v, collaboration_id: v.collaboration_id || null };
      if (isEdit) await api.patch(`/portal/calendar/${entry.entry_id}`, body);
      else await api.post('/portal/calendar', body);
      invalidateAll();
      toast('Gespeichert.');
      onClose();
    } catch (err) {
      handleFormError(err, setErrors, toast);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Eintrag löschen?', message: `„${entry.title}“ wird aus deinem Kalender entfernt.`, confirmLabel: 'Löschen', danger: true }))) return;
    try {
      await api.del(`/portal/calendar/${entry.entry_id}`);
      invalidateAll();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <Modal open={!!entry} onClose={onClose} title={isEdit ? 'Eintrag bearbeiten' : 'Neuer Kalendereintrag'}
      footer={<>
        {isEdit && !preview && <Button variant="ghost-danger" icon="trash" onClick={remove} className="mr-auto">Löschen</Button>}
        <Button onClick={onClose}>{preview ? 'Schließen' : 'Abbrechen'}</Button>
        {!preview && <Button variant="primary" type="submit" form="entry-form" loading={saving}>Speichern</Button>}
      </>}>
      <form id="entry-form" className="form-grid" onSubmit={save}>
        <Field label="Titel" required error={errors.title} className="span-2"><input className="input" value={v.title || ''} onChange={set('title')} placeholder="z. B. Reel drehen, Story posten" autoFocus /></Field>
        <Field label="Datum" required error={errors.entry_date}><input className="input" type="date" value={v.entry_date || ''} onChange={set('entry_date')} /></Field>
        <Field label="Uhrzeit (optional)" error={errors.entry_time}><input className="input" type="time" value={v.entry_time || ''} onChange={set('entry_time')} /></Field>
        <Field label="Art" error={errors.kind}><Select value={v.kind} onChange={set('kind')} options={CALENDAR_KINDS} /></Field>
        <Field label="Plattform" error={errors.platform}><Select value={v.platform} onChange={set('platform')} placeholder="–" options={['Instagram', 'TikTok', 'YouTube', 'Pinterest', 'Sonstiges']} /></Field>
        <Field label="Zu Kooperation (optional)" error={errors.collaboration_id} className="span-2">
          <Select value={v.collaboration_id} onChange={set('collaboration_id')} placeholder="– keine –" options={(collabs.data?.items || []).map((c) => ({ value: String(c.id), label: `${c.brand}${c.campaign_name ? ' · ' + c.campaign_name : ''}` }))} />
        </Field>
        <Field label="Notiz" error={errors.notes} className="span-2"><textarea className="input" rows={3} value={v.notes || ''} onChange={set('notes')} /></Field>
        {isEdit && <label className="checkline span-2"><input type="checkbox" checked={!!v.done} onChange={set('done')} /> Erledigt</label>}
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------
// Kooperationen
// ------------------------------------------------------------------
function StageBar({ index, stage }) {
  if (stage === 'Abgebrochen') return <Badge tone="red">Abgebrochen</Badge>;
  return (
    <ol className="stagebar" aria-label={`Status: ${stage}`}>
      {CREATOR_STAGES.map((s, i) => (
        <li key={s} className={i < index ? 'done' : i === index ? 'current' : ''}>
          <span className="stagebar-dot">{i < index ? <Icon name="check" size={11} /> : i + 1}</span>
          <span className="stagebar-label">{s}</span>
        </li>
      ))}
    </ol>
  );
}

function MiniStages({ index }) {
  return <div className="mini-stages" aria-hidden="true">{CREATOR_STAGES.map((s, i) => <span key={s} className={i <= index ? 'on' : ''} />)}</div>;
}

function CollabsPage() {
  const { p, to } = usePortal();
  const navigate = useNavigate();
  const params = new URLSearchParams(useLocation().search);
  const filter = params.get('filter') || 'all';
  const { data, error, loading, reload } = useApi(p(`/portal/collaborations${filter === 'all' ? '' : `?filter=${filter}`}`));
  return (
    <div className="page">
      <PageHeader title="Kooperationen" subtitle="Jeder Deal von der Anfrage bis zur Zahlung – mit Vertrag, Briefing und Nachrichten." />
      <div className="toolbar">
        <Segmented value={filter} onChange={(f) => navigate(to(`/kooperationen?filter=${f}`))} options={[
          { value: 'all', label: 'Alle' }, { value: 'open', label: 'Anfragen' }, { value: 'active', label: 'Laufend' }, { value: 'billing', label: 'Rechnung' }, { value: 'done', label: 'Bezahlt' },
        ]} />
      </div>
      {loading && !data ? <Spinner /> : error && !data ? <ErrorBox error={error} onRetry={reload} /> : !data.items.length ? (
        <Card><Empty icon="briefcase" title="Hier ist gerade nichts" text="Sobald es passende Kooperationen gibt, siehst du sie hier." /></Card>
      ) : (
        <div className="deal-list">
          {data.items.map((c) => (
            <Link key={c.id} to={to(`/kooperationen/${c.id}`)} className="card deal-card">
              <div className="deal-card-top">
                <div className="grow">
                  <div className="collab-card-title">{c.brand}</div>
                  <div className="small muted clamp-1">{c.campaign_name || c.description || 'Kampagne'}</div>
                </div>
                <StageBadge stage={c.stage} />
              </div>
              <MiniStages index={c.stage_index} />
              <div className="deal-card-meta">
                <span>{[c.platform, c.deadline ? `Abgabe ${fmtDate(c.deadline)}` : c.publish_date ? `Posting ${fmtDate(c.publish_date)}` : null].filter(Boolean).join(' · ') || 'Termine folgen'}</span>
                <strong>{fmtMoney(c.money.net)}</strong>
              </div>
              {c.message_count > 0 && <div className="small muted"><Icon name="message" size={13} /> {c.message_count} Nachrichten</div>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function CollabDetailPage({ params }) {
  const { p, to, preview } = usePortal();
  const { data, error, loading, reload } = useApi(p(`/portal/collaborations/${params.id}`));
  const [submit, setSubmit] = useState(false);
  const [expense, setExpense] = useState(null);
  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const c = data.item;
  const m = c.money;
  const dates = [
    ['Briefing', c.briefing_date], ['Content-Abgabe', c.deadline], ['Freigabe bis', c.approval_date], ['Veröffentlichung geplant', c.publish_date],
    ['Veröffentlicht am', c.published_on], ['Zeitraum', c.start_date || c.end_date ? `${fmtDate(c.start_date)} – ${fmtDate(c.end_date)}` : null],
    ['Zahlung fällig', c.invoice_due_date], ['Ausgezahlt am', c.payout_date],
  ].filter(([, d]) => d);
  const contracts = data.documents.filter((d) => ['Kampagnenverträge', 'Verträge'].includes(d.category));
  const briefings = data.documents.filter((d) => ['Briefings', 'Freigaben', 'Kampagnenunterlagen'].includes(d.category));
  const otherDocs = data.documents.filter((d) => !contracts.includes(d) && !briefings.includes(d));
  const DocLinks = ({ list, empty }) => (!list.length ? <p className="small muted">{empty}</p> : list.map((d) => (
    <a key={d.id} className="doc-chip" href={p(`/api/portal/documents/${d.id}/file`)} target="_blank" rel="noopener noreferrer"><Icon name="file" size={14} /> {d.filename}</a>
  )));

  return (
    <div className="page">
      <PageHeader back={{ to: to('/kooperationen'), label: 'Kooperationen' }} title={c.brand} subtitle={c.campaign_name || 'Kooperation'}
        actions={<StageBadge stage={c.stage} />} />
      <Card className="stagebar-card"><StageBar index={c.stage_index} stage={c.stage} /></Card>
      <div className="grid-2 align-start">
        <div className="stack-lg">
          <Card title="Kampagne">
            <div className="stack">
              {c.description && <div><div className="label">Beschreibung / Briefing</div><div className="pre-wrap">{c.description}</div></div>}
              <dl className="facts">
                <dt>Plattform</dt><dd>{c.platform || '–'}</dd>
                <dt>Vereinbarte Inhalte</dt><dd className="pre-wrap">{c.deliverables || '–'}</dd>
              </dl>
            </div>
          </Card>
          <Card title="Rechte & Exklusivität">
            <dl className="facts">
              <dt>Nutzungsrechte</dt><dd className="pre-wrap">{c.usage_rights || 'Noch nicht festgelegt'}</dd>
              <dt>Exklusivität</dt><dd className="pre-wrap">{c.exclusivity || 'Keine vereinbart'}</dd>
            </dl>
          </Card>
          <Card title="Termine">
            {!dates.length ? <p className="muted small">Termine folgen, sobald der Deal steht.</p> : (
              <dl className="facts">{dates.map(([l, d]) => <Fragment key={l}><dt>{l}</dt><dd>{l === 'Zeitraum' ? d : fmtDue(d) === fmtDate(d) ? fmtDate(d) : `${fmtDate(d)} (${fmtDue(d)})`}</dd></Fragment>)}</dl>
            )}
          </Card>
          <Card title="Ansprechpartner">
            <dl className="facts">
              <dt>Bei der Marke</dt><dd>{c.contact_name || '–'}{c.contact_email && <> · <a className="link" href={`mailto:${c.contact_email}`}>{c.contact_email}</a></>}</dd>
            </dl>
            <p className="small muted">Absprachen zum Deal bitte über die Nachrichten hier – dann ist alles an einem Ort.</p>
          </Card>
        </div>
        <div className="stack-lg">
          <Card title="Honorar">
            <div className="money-box">
              <div className="money-row"><span>Honorar der Marke</span><span>{fmtMoney(m.fee)}</span></div>
              <div className="money-row muted"><span>LLK-Provision ({pct(m.commission_rate)})</span><span>− {fmtMoney(m.agency_fee)}</span></div>
              <div className="money-row total"><span>Dein Honorar netto</span><span>{fmtMoney(m.net)}</span></div>
              <div className="money-row muted"><span>{m.vat_rate ? `Umsatzsteuer ${m.vat_rate} %` : 'Keine USt (Kleinunternehmer)'}</span><span>{m.vat_rate ? `+ ${fmtMoney(m.vat)}` : '–'}</span></div>
              <div className="money-row"><span>Rechnungsbetrag brutto</span><span>{fmtMoney(m.gross)}</span></div>
              <div className="money-status"><StageBadge stage={c.stage} />{c.overdue && <Badge tone="red">Zahlung überfällig</Badge>}</div>
            </div>
            {m.vat_rate > 0 && <p className="small muted">Die Umsatzsteuer gehört dem Finanzamt – sie ist im Steuerpuffer unter „Finanzen“ eingeplant.</p>}
          </Card>
          <Card title="Vertrag & Briefing">
            <div className="stack">
              <div><div className="label">Vertrag</div><DocLinks list={contracts} empty="Noch kein Vertrag hinterlegt." /></div>
              <div><div className="label">Briefing & Freigaben</div><DocLinks list={briefings} empty="Noch kein Briefing-Dokument." /></div>
              {otherDocs.length > 0 && <div><div className="label">Rechnungen & Sonstiges</div><DocLinks list={otherDocs} empty="" /></div>}
            </div>
          </Card>
          <Card title="Content">
            {c.content_submitted_at ? (
              <div className="submitted-box">
                <div className="strong small"><Icon name="check" size={14} /> Eingereicht am {fmtDateTime(c.content_submitted_at)}</div>
                {(c.content_links || '').split('\n').filter(Boolean).map((l) => <a key={l} className="link small break" href={l} target="_blank" rel="noopener noreferrer">{l}</a>)}
                {CAN_SUBMIT.includes(c.status) && !preview && <button className="link small" onClick={() => setSubmit(true)}>Links ändern</button>}
              </div>
            ) : CAN_SUBMIT.includes(c.status) ? (
              <div className="collab-card-actions">
                <Button variant="primary" icon="upload" onClick={() => setSubmit(true)} disabled={preview} title={preview ? PREVIEW_HINT : undefined}>Content einreichen</Button>
                <span className="small muted">Links zu Entwürfen oder fertigen Posts – dein Team prüft und gibt Bescheid.</span>
              </div>
            ) : <p className="small muted">Content kann eingereicht werden, sobald der Deal bestätigt ist.</p>}
          </Card>
          <MessagesCard collabId={c.id} messages={data.messages} />
          <Card title="Ausgaben zu diesem Deal" padded={false}
            actions={<Button size="sm" icon="plus" disabled={preview} title={preview ? PREVIEW_HINT : undefined} onClick={() => setExpense({ collaboration_id: c.id })}>Ausgabe</Button>}>
            {!data.expenses.length ? <p className="small muted card-pad">Fahrtkosten, Requisiten o. Ä. hier erfassen – auch zur Erstattung durch die Marke.</p> : (
              <ul className="portal-list">
                {data.expenses.map((e) => (
                  <li key={e.id} className="portal-list-row">
                    <div className="grow"><div className="strong">{e.title}</div><div className="small muted">{fmtDate(e.expense_date)}</div></div>
                    {e.reimbursable && <ReimbBadge s={e.reimbursement_status} />}
                    <strong>{fmtMoney(e.amount_gross)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <SubmitModal collab={submit ? c : null} onClose={() => setSubmit(false)} />
      <ExpenseModal expense={expense} onClose={() => setExpense(null)} />
    </div>
  );
}

function MessagesCard({ collabId, messages }) {
  const { preview } = usePortal();
  const { toast } = useUi();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const send = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    try {
      await api.post(`/portal/collaborations/${collabId}/messages`, { body });
      setBody('');
      invalidateAll();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSending(false);
    }
  };
  return (
    <Card title="Nachrichten" subtitle="Direkt mit deinem Team, zu genau diesem Deal">
      <div className="thread">
        {!messages.length && <p className="small muted">Noch keine Nachrichten. Frag hier alles zum Deal.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.mine ? 'mine' : ''}`}>
            <div className="msg-meta">{m.mine ? 'Du' : m.author || 'Team'} · {fmtDateTime(m.created_at)}</div>
            <div className="msg-body pre-wrap">{m.body}</div>
          </div>
        ))}
      </div>
      <form className="msg-form" onSubmit={send}>
        <textarea className="input" rows={2} value={body} onChange={(e) => setBody(e.target.value)} disabled={preview}
          placeholder={preview ? 'In der Vorschau kann nicht geschrieben werden – antworte im Team-CRM an der Kooperation.' : 'Nachricht schreiben…'} />
        <Button variant="primary" icon="send" type="submit" loading={sending} disabled={preview || !body.trim()}>Senden</Button>
      </form>
    </Card>
  );
}

function SubmitModal({ collab, onClose }) {
  const { toast } = useUi();
  const [v, setV] = useState({ content_links: '', content_note: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (collab) setV({ content_links: collab.content_links || '', content_note: collab.content_note || '' });
    setErrors({});
  }, [collab]);
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/portal/collaborations/${collab.id}/content`, v);
      toast('Eingereicht – dein Team prüft jetzt.');
      invalidateAll();
      onClose();
    } catch (err) {
      handleFormError(err, setErrors, toast);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open={!!collab} onClose={onClose} title={collab ? `Content für ${collab.brand}` : ''}
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" type="submit" form="submit-form" loading={saving}>Einreichen</Button></>}>
      <form id="submit-form" className="stack" onSubmit={save}>
        <Field label="Links" required error={errors.content_links} hint="Ein Link pro Zeile, z. B. Google Drive, WeTransfer, Dropbox oder der fertige Post.">
          <textarea className="input" rows={4} value={v.content_links} onChange={(e) => setV({ ...v, content_links: e.target.value })} placeholder="https://…" />
        </Field>
        <Field label="Nachricht ans Team (optional)" error={errors.content_note}>
          <textarea className="input" rows={3} value={v.content_note} onChange={(e) => setV({ ...v, content_note: e.target.value })} />
        </Field>
        <p className="small muted">Denk an die Kennzeichnung mit „Werbung“ oder „Anzeige“ – gut sichtbar am Anfang.</p>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------
// Finanzen
// ------------------------------------------------------------------
const REIMB_TONE = { Keine: 'gray', Beantragt: 'amber', Erstattet: 'green', Abgelehnt: 'red' };
const ReimbBadge = ({ s }) => <Badge tone={REIMB_TONE[s] || 'gray'}>{s === 'Keine' ? 'Keine Erstattung' : `Erstattung ${s.toLowerCase()}`}</Badge>;

function PeriodPicker({ year, month, years, onChange }) {
  return (
    <div className="row period-picker">
      <Select value={String(month || '')} onChange={(e) => onChange(year, Number(e.target.value) || null)} placeholder="Ganzes Jahr"
        options={MONTHS_LONG.map((m, i) => ({ value: String(i + 1), label: m }))} />
      <Select value={String(year)} onChange={(e) => onChange(Number(e.target.value), month)} options={(years || [year]).map((y) => ({ value: String(y), label: String(y) }))} />
    </div>
  );
}

function FinancePage() {
  const { p, preview } = usePortal();
  const [period, setPeriod] = useState({ year: new Date().getFullYear(), month: null });
  const { data, error, loading, reload } = useApi(p(`/portal/finance?year=${period.year}${period.month ? `&month=${period.month}` : ''}`));
  const [expense, setExpense] = useState(null);
  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const { income, buffer, expenses: ex, months, items, expense_items } = data;
  const label = period.month ? `${MONTHS_LONG[period.month - 1]} ${period.year}` : String(period.year);
  const max = Math.max(1, ...months.map((m) => m.paid + m.invoiced + m.expected));
  const vatIn = income.invoiced.vat + income.paid.vat;

  return (
    <div className="page">
      <PageHeader title="Finanzen" subtitle={`Einnahmen, Ausgaben, Provision und Steuerpuffer · ${label}`}
        actions={<PeriodPicker year={period.year} month={period.month} years={data.years} onChange={(year, month) => setPeriod({ year, month })} />} />
      <div className="stat-row portal-stats">
        <div className="stat"><div className="stat-label"><Icon name="clock" size={15} />Erwartet</div><div className="stat-value">{fmtMoney(income.expected.net)}</div><div className="stat-hint">{income.expected.count} bestätigte Deals · netto</div></div>
        <div className="stat"><div className="stat-label"><Icon name="file" size={15} />Fakturiert</div><div className="stat-value tone-amber">{fmtMoney(income.invoiced.net)}</div><div className="stat-hint">Rechnung raus, noch nicht bezahlt</div></div>
        <div className="stat"><div className="stat-label"><Icon name="check" size={15} />Bezahlt</div><div className="stat-value tone-green">{fmtMoney(income.paid.net)}</div><div className="stat-hint">{income.paid.count} Deals · netto</div></div>
        <div className="stat"><div className="stat-label"><Icon name="briefcase" size={15} />LLK-Provision</div><div className="stat-value">{fmtMoney(data.agency_fee)}</div><div className="stat-hint">von {fmtMoney(data.gross_fees)} Honoraren gesamt</div></div>
      </div>

      {!period.month && (
        <Card title={`Monate ${period.year}`} subtitle="Dunkelgrün = bezahlt · Gelb = fakturiert · Hell = erwartet (netto)">
          <div className="bars" role="img" aria-label={`Einnahmen pro Monat ${period.year}`}>
            {months.map((m) => (
              <button key={m.month} className="bar-col btn-reset" onClick={() => setPeriod({ ...period, month: m.month })}
                title={`${MONTHS[m.month - 1]}: ${fmtMoney(m.paid)} bezahlt, ${fmtMoney(m.invoiced)} fakturiert, ${fmtMoney(m.expected)} erwartet, ${fmtMoney(m.expenses)} Ausgaben`}>
                <div className="bar-stack">
                  <div className="bar bar-open" style={{ height: `${(m.expected / max) * 100}%` }} />
                  <div className="bar bar-invoiced" style={{ height: `${(m.invoiced / max) * 100}%` }} />
                  <div className="bar bar-paid" style={{ height: `${(m.paid / max) * 100}%` }} />
                </div>
                <div className="bar-label">{MONTHS[m.month - 1]}</div>
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="grid-2 align-start">
        <div className="stack-lg">
          <TaxBufferCard buffer={buffer} />
          <Card title="Umsatzsteuer" subtitle="Separat ausgewiesen – sie gehört nicht dir, sondern dem Finanzamt">
            {buffer.small_business === true ? (
              <p className="small">Du bist als <strong>Kleinunternehmer</strong> hinterlegt: Du weist keine Umsatzsteuer aus und ziehst keine Vorsteuer ab. Achte auf die Umsatzgrenzen (25.000 € Vorjahr / 100.000 € laufendes Jahr).</p>
            ) : (
              <div className="money-box">
                <div className="money-row"><span>USt auf deine Rechnungen</span><span>{fmtMoney(vatIn)}</span></div>
                <div className="money-row muted"><span>− Vorsteuer aus Ausgaben</span><span>{fmtMoney(ex.input_vat)}</span></div>
                <div className="money-row total"><span>Voraussichtliche Zahllast</span><span>{fmtMoney(buffer.vat_due)}</span></div>
                {buffer.small_business == null && <p className="small muted">Bitte unter „Meine Daten“ angeben, ob du Kleinunternehmer bist – bis dahin rechnen wir mit 19 % USt.</p>}
              </div>
            )}
          </Card>
        </div>
        <div className="stack-lg">
          <Card title="Ausgaben & Auslagen" subtitle={`${label} · Belege bitte immer hochladen`} padded={false}
            actions={<Button size="sm" variant="primary" icon="plus" disabled={preview} title={preview ? PREVIEW_HINT : undefined} onClick={() => setExpense({})}>Ausgabe</Button>}>
            <div className="card-pad money-mini">
              <span>Gesamt <strong>{fmtMoney(ex.gross)}</strong></span>
              <span>Eigene netto <strong>{fmtMoney(ex.net)}</strong></span>
              <span>Erstattung offen <strong className="tone-amber">{fmtMoney(ex.reimbursable_open)}</strong></span>
              <span>Erstattet <strong className="tone-green">{fmtMoney(ex.reimbursed)}</strong></span>
            </div>
            {!expense_items.length ? <Empty icon="wallet" title="Keine Ausgaben im Zeitraum" text="Equipment, Software, Fahrtkosten – alles, was du beruflich ausgibst." /> : (
              <ul className="portal-list">
                {expense_items.map((e) => (
                  <li key={e.id}>
                    <button className="portal-list-row btn-reset" onClick={() => setExpense(e)}>
                      <div className="grow">
                        <div className="strong">{e.title}</div>
                        <div className="small muted">{[fmtDate(e.expense_date), e.category, e.collaboration_brand, `${Number(e.vat_rate)} % USt`].filter(Boolean).join(' · ')}</div>
                      </div>
                      {e.reimbursable && <ReimbBadge s={e.reimbursement_status} />}
                      {e.document_id ? <Icon name="file" size={15} title="Beleg vorhanden" /> : <Badge tone="red">Beleg fehlt</Badge>}
                      <strong>{fmtMoney(e.amount_gross)}</strong>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card title="Einnahmen je Deal" subtitle="Deine Anteile nach Provision" padded={false}>
        {!items.length ? <Empty icon="wallet" title={`Keine Einnahmen ${label}`} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Datum</th><th>Marke</th><th>Status</th><th className="num">Honorar</th><th className="num">Provision</th><th className="num">Netto</th><th className="num">USt</th><th className="num">Brutto</th></tr></thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id}>
                    <td className="nowrap">{fmtDate(c.stage === 'Bezahlt' ? c.payout_date || c.rev_date : c.rev_date)}</td>
                    <td><div className="strong">{c.brand}</div>{c.campaign_name && <div className="small muted">{c.campaign_name}</div>}</td>
                    <td><StageBadge stage={c.stage} /></td>
                    <td className="num">{fmtMoney(c.money.fee)}</td>
                    <td className="num muted">− {fmtMoney(c.money.agency_fee)}</td>
                    <td className="num strong">{fmtMoney(c.money.net)}</td>
                    <td className="num muted">{fmtMoney(c.money.vat)}</td>
                    <td className="num">{fmtMoney(c.money.gross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <ExpenseModal expense={expense} onClose={() => setExpense(null)} />
    </div>
  );
}

function TaxBufferCard({ buffer }) {
  const { preview } = usePortal();
  const { toast } = useUi();
  const [rate, setRate] = useState(buffer.rate);
  const [saving, setSaving] = useState(false);
  useEffect(() => setRate(buffer.rate), [buffer.rate]);
  const incomeTax = (buffer.profit_basis * rate) / 100;
  const save = async () => {
    setSaving(true);
    try {
      await api.put('/portal/profile', { tax_buffer_rate: rate });
      invalidateAll();
      toast('Steuerpuffer gespeichert.');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card title="Steuerpuffer" subtitle="Was du ungefähr zurücklegen solltest">
      <div className="stack">
        <div className="buffer-total">{fmtMoney(incomeTax + buffer.vat_due)}</div>
        <label className="buffer-slider">
          <span>Anteil vom Gewinn: <strong>{rate} %</strong></span>
          <input type="range" min="0" max="50" step="1" value={rate} onChange={(e) => setRate(Number(e.target.value))} />
        </label>
        <div className="money-box">
          <div className="money-row"><span>Gewinn (fakturiert + bezahlt − eigene Ausgaben, netto)</span><span>{fmtMoney(buffer.profit_basis)}</span></div>
          <div className="money-row"><span>× {rate} % für Einkommen-/Gewerbesteuer</span><span>{fmtMoney(incomeTax)}</span></div>
          <div className="money-row"><span>+ Umsatzsteuer-Zahllast</span><span>{fmtMoney(buffer.vat_due)}</span></div>
        </div>
        {rate !== buffer.rate && <Button size="sm" variant="primary" onClick={save} loading={saving} disabled={preview}>Satz speichern</Button>}
        <div className="disclaimer">
          <Icon name="alert" size={16} />
          <span><strong>Nur eine Schätzung, keine Steuerberatung.</strong> Die tatsächliche Steuer hängt von deinem gesamten Einkommen, Freibeträgen, Gewerbesteuer und Vorauszahlungen ab. Den passenden Satz stimmst du am besten mit deinem Steuerberater ab.</span>
        </div>
      </div>
    </Card>
  );
}

function ExpenseModal({ expense, onClose }) {
  const { toast, confirm } = useUi();
  const { p, preview } = usePortal();
  const collabs = useApi(expense ? p('/portal/collaborations') : null);
  const [v, setV] = useState({});
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const isEdit = !!expense?.id;
  const locked = preview || expense?.reimbursement_status === 'Erstattet';
  useEffect(() => {
    if (!expense) return;
    setFile(null);
    setErrors({});
    setV({
      expense_date: expense.expense_date ? String(expense.expense_date).slice(0, 10) : todayStr(), title: expense.title || '', category: expense.category || 'Sonstiges',
      amount_gross: expense.amount_gross ? String(expense.amount_gross) : '', vat_rate: String(expense.vat_rate ?? 19), reimbursable: !!expense.reimbursable,
      collaboration_id: expense.collaboration_id ? String(expense.collaboration_id) : '', notes: expense.notes || '',
    });
  }, [expense]);
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async (ev) => {
    ev.preventDefault();
    if (file && file.size > MAX_UPLOAD_BYTES) return setErrors({ file: `Die Datei ist zu groß (max. ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).` });
    setSaving(true);
    try {
      const body = { ...v, amount_gross: String(v.amount_gross).replace(',', '.'), collaboration_id: v.collaboration_id || null };
      let id = expense.id;
      if (isEdit) await api.patch(`/portal/expenses/${id}`, body);
      else id = (await api.post('/portal/expenses', body)).id;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        await api.upload(`/portal/expenses/${id}/receipt`, fd);
      }
      invalidateAll();
      toast(v.reimbursable && !expense.reimbursable ? 'Gespeichert – Erstattung beim Team beantragt.' : 'Gespeichert.');
      onClose();
    } catch (err) {
      handleFormError(err, setErrors, toast);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Ausgabe löschen?', message: `„${expense.title}“ wird entfernt. Ein hochgeladener Beleg bleibt unter Dokumente erhalten.`, confirmLabel: 'Löschen', danger: true }))) return;
    try {
      await api.del(`/portal/expenses/${expense.id}`);
      invalidateAll();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const categories = CREATOR_EXPENSE_CATEGORIES;
  return (
    <Modal open={!!expense} onClose={onClose} title={isEdit ? 'Ausgabe' : 'Neue Ausgabe'}
      footer={<>
        {isEdit && !locked && <Button variant="ghost-danger" icon="trash" onClick={remove} className="mr-auto">Löschen</Button>}
        <Button onClick={onClose}>{locked ? 'Schließen' : 'Abbrechen'}</Button>
        {!locked && <Button variant="primary" type="submit" form="expense-form" loading={saving}>Speichern</Button>}
      </>}>
      <form id="expense-form" className="form-grid" onSubmit={save}>
        <fieldset disabled={locked} className="contents">
          <Field label="Beschreibung" required error={errors.title} className="span-2"><input className="input" value={v.title || ''} onChange={set('title')} placeholder="z. B. Ringlicht, Bahnticket zum Shooting" /></Field>
          <Field label="Datum" required error={errors.expense_date}><input className="input" type="date" value={v.expense_date || ''} onChange={set('expense_date')} /></Field>
          <Field label="Kategorie" error={errors.category}><Select value={v.category} onChange={set('category')} options={categories} /></Field>
          <Field label="Betrag brutto (€)" required error={errors.amount_gross}><input className="input" inputMode="decimal" value={v.amount_gross || ''} onChange={set('amount_gross')} placeholder="0,00" /></Field>
          <Field label="Umsatzsteuer im Beleg" error={errors.vat_rate}><Select value={v.vat_rate} onChange={set('vat_rate')} options={[{ value: '19', label: '19 %' }, { value: '7', label: '7 %' }, { value: '0', label: '0 % / ohne' }]} /></Field>
          <Field label="Zu Kooperation (optional)" error={errors.collaboration_id} className="span-2">
            <Select value={v.collaboration_id} onChange={set('collaboration_id')} placeholder="– keine –" options={(collabs.data?.items || []).map((c) => ({ value: String(c.id), label: `${c.brand}${c.campaign_name ? ' · ' + c.campaign_name : ''}` }))} />
          </Field>
          <label className="checkline span-2"><input type="checkbox" checked={!!v.reimbursable} onChange={set('reimbursable')} /> Auslage – soll von Marke/Management erstattet werden</label>
          <Field label="Notiz" error={errors.notes} className="span-2"><textarea className="input" rows={2} value={v.notes || ''} onChange={set('notes')} /></Field>
          <Field label={expense?.document_id ? 'Beleg ersetzen' : 'Beleg (PDF oder Foto)'} error={errors.file} className="span-2"
            hint={expense?.receipt_filename ? `Aktuell: ${expense.receipt_filename}` : 'Ohne Beleg erkennt das Finanzamt die Ausgabe meist nicht an.'}>
            <label className={`dropzone ${file ? 'has-file' : ''}`}>
              <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files[0] || null)} />
              <Icon name={file ? 'file' : 'upload'} size={20} />
              {file ? <span><strong>{file.name}</strong> · {fmtBytes(file.size)}</span> : <span>Datei auswählen</span>}
            </label>
          </Field>
        </fieldset>
        {expense?.reimbursement_status === 'Erstattet' && <p className="small muted span-2">Diese Auslage wurde bereits erstattet und kann nicht mehr geändert werden.</p>}
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------
// Rechnungen & Steuerberater-Export
// ------------------------------------------------------------------
const DATEV_DEFAULTS = { bank: '1200', revenue: '8400', revenue_small: '8195', expense: '4900', berater: '', mandant: '' };
function loadDatev() {
  try { return { ...DATEV_DEFAULTS, ...JSON.parse(localStorage.getItem('portal-datev') || '{}') }; } catch { return DATEV_DEFAULTS; }
}

function InvoicesPage() {
  const { p, preview } = usePortal();
  const [period, setPeriod] = useState({ year: new Date().getFullYear(), month: null });
  const [datev, setDatev] = useState(loadDatev);
  const [showDatev, setShowDatev] = useState(false);
  const [upload, setUpload] = useState(false);
  const fin = useApi(p(`/portal/finance?year=${period.year}`));
  const docs = useApi(p('/portal/documents'));
  useEffect(() => { try { localStorage.setItem('portal-datev', JSON.stringify(datev)); } catch { /* egal */ } }, [datev]);
  const q = `year=${period.year}${period.month ? `&month=${period.month}` : ''}`;
  const datevQ = Object.entries(datev).filter(([, x]) => x).map(([k, x]) => `${k}=${encodeURIComponent(x)}`).join('&');
  const url = (kind, extra = '') => p(`/api/portal/export/${kind}?${q}${extra ? '&' + extra : ''}`);
  const invoiceGroup = docs.data?.groups.find((g) => g.key === 'invoices');
  const label = period.month ? `${MONTHS_LONG[period.month - 1]} ${period.year}` : `Jahr ${period.year}`;
  const setD = (k) => (e) => setDatev((d) => ({ ...d, [k]: e.target.value.replace(/\D/g, '') }));

  return (
    <div className="page">
      <PageHeader title="Rechnungen & Steuerberater-Export" subtitle="Rechnungen und Belege an einem Ort – und alles für die Buchhaltung mit einem Klick."
        actions={<PeriodPicker year={period.year} month={period.month} years={fin.data?.years} onChange={(year, month) => setPeriod({ year, month })} />} />
      <div className="portal-notice info">
        <Icon name="alert" size={18} />
        <span><strong>Vorher mit deinem Steuerberater klären:</strong> welches Format er braucht (DATEV, CSV oder nur Belege), welcher Kontenrahmen (SKR03/SKR04) und welche Kontierung. Die DATEV-Konten unten sind nur Vorschläge.</span>
      </div>
      <div className="export-grid">
        <ExportTile icon="download" title="Einnahmen (CSV)" text="Alle Deals mit Honorar, Provision, Netto, USt, Brutto und Zahlstatus – öffnet in Excel." href={url('income.csv')} />
        <ExportTile icon="download" title="Ausgaben (CSV)" text="Ausgaben mit Kategorie, USt-Satz, Netto, Erstattung und Belegname." href={url('expenses.csv')} />
        <ExportTile icon="download" title="DATEV-Buchungsstapel" text="EXTF-Format zum Import in DATEV (bezahlte Einnahmen + eigene Ausgaben)." href={url('datev.csv', datevQ)}
          extra={<button className="link small" onClick={() => setShowDatev(!showDatev)}>{showDatev ? 'Konten ausblenden' : 'Konten & Nummern einstellen'}</button>} />
        <ExportTile icon="archive" title="Steuerberater-Paket (ZIP)" text="Übersicht, beide CSVs, DATEV-Datei und alle Rechnungen & Belege als PDF – fertig zum Weiterleiten." href={url('package.zip', datevQ)} primary />
      </div>
      <p className="small muted">Zeitraum: <strong>{label}</strong>. Einnahmen zählen nach Leistungs- bzw. Zahlungsdatum.</p>
      {showDatev && (
        <Card title="DATEV-Einstellungen" subtitle="Werden nur in diesem Browser gespeichert">
          <div className="form-grid four">
            <Field label="Bankkonto"><input className="input mono" value={datev.bank} onChange={setD('bank')} /></Field>
            <Field label="Erlöskonto (19 %)"><input className="input mono" value={datev.revenue} onChange={setD('revenue')} /></Field>
            <Field label="Erlöse Kleinunternehmer"><input className="input mono" value={datev.revenue_small} onChange={setD('revenue_small')} /></Field>
            <Field label="Aufwandskonto"><input className="input mono" value={datev.expense} onChange={setD('expense')} /></Field>
            <Field label="Beraternummer (optional)"><input className="input mono" value={datev.berater} onChange={setD('berater')} maxLength={7} /></Field>
            <Field label="Mandantennummer (optional)"><input className="input mono" value={datev.mandant} onChange={setD('mandant')} maxLength={5} /></Field>
          </div>
          <div className="row"><Button size="sm" onClick={() => setDatev(DATEV_DEFAULTS)}>Auf SKR03-Standard zurücksetzen</Button></div>
        </Card>
      )}
      <Card title="Rechnungen & Belege" padded={false}
        actions={<Button size="sm" variant="primary" icon="upload" disabled={preview} title={preview ? PREVIEW_HINT : undefined} onClick={() => setUpload(true)}>Hochladen</Button>}>
        {docs.loading && !docs.data ? <Spinner /> : !invoiceGroup?.items.length ? (
          <Empty icon="file" title="Noch keine Rechnungen oder Belege" text="Lade deine Rechnungen an Marken und Belege für Ausgaben hier hoch." />
        ) : <DocList items={invoiceGroup.items} />}
      </Card>
      <PortalUploadModal open={upload} onClose={() => setUpload(false)} categories={['Rechnungen', 'Belege']} />
    </div>
  );
}

function ExportTile({ icon, title, text, href, extra, primary }) {
  return (
    <div className={`card export-tile ${primary ? 'primary' : ''}`}>
      <div className="strong">{title}</div>
      <div className="small muted grow">{text}</div>
      <div className="row">
        <a className={`btn ${primary ? 'btn-primary' : 'btn-secondary'} btn-sm`} href={href} download><Icon name={icon} size={15} /> Herunterladen</a>
        {extra}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Verträge & Dokumente
// ------------------------------------------------------------------
const GROUP_ICON = { mgmt: 'shield', campaign: 'briefcase', briefing: 'note', invoices: 'euro', other: 'file' };

function DocumentsPage() {
  const { p, preview } = usePortal();
  const { data, error, loading, reload } = useApi(p('/portal/documents'));
  const [upload, setUpload] = useState(false);
  return (
    <div className="page">
      <PageHeader title="Verträge & Dokumente" subtitle="Managementvertrag, Vollmachten, Kampagnenverträge, Briefings, Freigaben und Rechnungen."
        actions={<Button variant="primary" icon="upload" disabled={preview} title={preview ? PREVIEW_HINT : undefined} onClick={() => setUpload(true)}>Hochladen</Button>} />
      {loading && !data ? <Spinner /> : error && !data ? <ErrorBox error={error} onRetry={reload} /> : (
        <div className="stack-lg">
          {data.groups.map((g) => (
            <Card key={g.key} title={<span className="row"><Icon name={GROUP_ICON[g.key] || 'file'} size={17} /> {g.label}</span>} subtitle={`${g.items.length} ${g.items.length === 1 ? 'Datei' : 'Dateien'}`} padded={false}>
              {!g.items.length ? <p className="small muted card-pad">{g.key === 'mgmt' ? 'Dein Managementvertrag und Vollmachten erscheinen hier, sobald dein Team sie hochlädt.' : 'Noch nichts vorhanden.'}</p> : <DocList items={g.items} />}
            </Card>
          ))}
        </div>
      )}
      <PortalUploadModal open={upload} onClose={() => setUpload(false)} categories={data?.upload_categories || ['Rechnungen', 'Sonstige Dokumente']} />
    </div>
  );
}

function DocList({ items }) {
  const { p } = usePortal();
  return (
    <ul className="doc-list">
      {items.map((d) => (
        <li key={d.id} className="doc-row">
          <span className="doc-icon"><Icon name="file" size={18} /></span>
          <div className="doc-main">
            <a href={p(`/api/portal/documents/${d.id}/file`)} target="_blank" rel="noopener noreferrer" className="strong doc-name">{d.filename}</a>
            <div className="cell-sub muted">
              <Badge tone="gray">{d.category}</Badge>{d.uploaded_by_me && <> <Badge tone="violet">Von dir</Badge></>} {fmtBytes(d.size_bytes)} · {fmtDate(d.created_at)}
              {d.collaboration_brand && <> · {d.collaboration_brand}</>}
            </div>
          </div>
          <div className="doc-actions">
            <a className="icon-btn" href={p(`/api/portal/documents/${d.id}/file`)} target="_blank" rel="noopener noreferrer" title="Öffnen"><Icon name="eye" size={16} /></a>
            <a className="icon-btn" href={p(`/api/portal/documents/${d.id}/file?download=1`)} title="Herunterladen"><Icon name="download" size={16} /></a>
          </div>
        </li>
      ))}
    </ul>
  );
}

function PortalUploadModal({ open, onClose, categories }) {
  const { toast } = useUi();
  const { p } = usePortal();
  const collabs = useApi(open ? p('/portal/collaborations') : null);
  const [file, setFile] = useState(null);
  const [category, setCategory] = useState(categories[0]);
  const [collab, setCollab] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setFile(null); setErrors({}); setCollab(''); setCategory(categories[0]); } }, [open]); // eslint-disable-line
  const submit = async (e) => {
    e.preventDefault();
    if (!file) return setErrors({ file: 'Bitte eine Datei auswählen.' });
    if (file.size > MAX_UPLOAD_BYTES) return setErrors({ file: `Die Datei ist zu groß (max. ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).` });
    const fd = new FormData();
    fd.append('file', file);
    fd.append('category', category);
    if (collab) fd.append('collaboration_id', collab);
    setSaving(true);
    try {
      await api.upload('/portal/documents', fd);
      toast('Hochgeladen – dein Team sieht die Datei jetzt.');
      invalidateAll();
      onClose();
    } catch (err) {
      handleFormError(err, setErrors, toast);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Datei hochladen"
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" type="submit" form="portal-upload" loading={saving} icon="upload">Hochladen</Button></>}>
      <form id="portal-upload" className="form-grid" onSubmit={submit}>
        <Field label="Art" error={errors.category}><Select value={category} onChange={(e) => setCategory(e.target.value)} options={categories} /></Field>
        <Field label="Zu Kooperation (optional)" error={errors.collaboration_id}>
          <Select value={collab} onChange={(e) => setCollab(e.target.value)} placeholder="– keine –" options={(collabs.data?.items || []).map((c) => ({ value: String(c.id), label: `${c.brand}${c.campaign_name ? ' · ' + c.campaign_name : ''}` }))} />
        </Field>
        <Field label="Datei" required error={errors.file} className="span-2" hint={`PDF, Bilder oder Office-Dokumente · max. ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`}>
          <label className={`dropzone ${file ? 'has-file' : ''}`}>
            <input type="file" onChange={(e) => { setFile(e.target.files[0] || null); setErrors({}); }} />
            <Icon name={file ? 'file' : 'upload'} size={22} />
            {file ? <span><strong>{file.name}</strong> · {fmtBytes(file.size)}</span> : <span>Datei auswählen oder hierher ziehen</span>}
          </label>
        </Field>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------
// Meine Daten & Sicherheit
// ------------------------------------------------------------------
function ProfilePage() {
  const { p } = usePortal();
  const { data, error, loading, reload } = useApi(p('/portal/profile'));
  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  return <ProfileForm key={JSON.stringify(data.profile)} data={data} />;
}

function ProfileForm({ data }) {
  const { toast } = useUi();
  const { preview } = usePortal();
  const pr = data.profile;
  const str = (x) => (x === null || x === undefined ? '' : String(x));
  const [v, setV] = useState(() => ({
    ...Object.fromEntries(Object.entries(pr).map(([k, x]) => [k, str(x)])),
    small_business: pr.small_business === true ? 'true' : pr.small_business === false ? 'false' : '',
  }));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => { setV((x) => ({ ...x, [k]: e.target.value })); setErrors((er) => ({ ...er, [k]: undefined })); };
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { ...v };
      if (body.small_business === '') delete body.small_business;
      await api.put('/portal/profile', body);
      invalidateAll();
      toast('Gespeichert.');
    } catch (err) {
      handleFormError(err, setErrors, toast);
    } finally {
      setSaving(false);
    }
  };
  const F = (key, label, props = {}) => (
    <Field label={label} error={errors[key]} className={props.span ? 'span-2' : ''} hint={props.hint}>
      <input className={`input ${props.mono ? 'mono' : ''}`} value={v[key]} onChange={set(key)} type={props.type || 'text'} placeholder={props.placeholder} />
    </Field>
  );
  const sizeOptions = (groups) => groups.flatMap((g) => g.options);
  return (
    <form className="page" onSubmit={save}>
      <PageHeader title="Meine Daten" subtitle="Halte deine Daten aktuell – dann klappen Rechnungen, Auszahlungen und Produktsendungen reibungslos."
        actions={<Button variant="primary" type="submit" loading={saving} icon="check" disabled={preview} title={preview ? PREVIEW_HINT : undefined}>Speichern</Button>} />
      <fieldset disabled={preview} className="contents">
        <div className="grid-2 align-start">
          <div className="stack-lg">
            <Card title="Kontakt">
              <div className="form-grid">
                {F('first_name', 'Vorname')}
                {F('last_name', 'Nachname')}
                {F('email', 'Kontakt-E-Mail', { type: 'email' })}
                {F('phone', 'Telefon', { type: 'tel' })}
                {F('city', 'Wohnort', { span: true })}
                <Field label="Kurzvorstellung" error={errors.bio} className="span-2" hint="Wird für dein Media Kit genutzt.">
                  <textarea className="input" rows={3} value={v.bio} onChange={set('bio')} />
                </Field>
              </div>
            </Card>
            <Card title="Rechnungs- & Bankdaten" subtitle="Nur für dich und dein Management sichtbar">
              <div className="form-grid">
                {F('billing_name', 'Name / Firma auf Rechnungen', { span: true })}
                {F('billing_street', 'Straße und Hausnummer', { span: true })}
                {F('billing_zip', 'PLZ')}
                {F('billing_city', 'Ort')}
                {F('iban', 'IBAN', { mono: true, placeholder: 'DE00 0000 0000 0000 0000 00' })}
                {F('bank_holder', 'Kontoinhaber')}
                {F('tax_number', 'Steuernummer')}
                {F('vat_id', 'USt-IdNr. (falls vorhanden)')}
                <Field label="Kleinunternehmer (§ 19 UStG)?" error={errors.small_business} className="span-2" hint="Steht in deinem Fragebogen zur steuerlichen Erfassung – oder frag dein Team.">
                  <Select value={v.small_business} onChange={set('small_business')} placeholder="– bitte wählen –" options={[{ value: 'true', label: 'Ja, ich bin Kleinunternehmer' }, { value: 'false', label: 'Nein, ich weise Umsatzsteuer aus' }]} />
                </Field>
                {F('tax_buffer_rate', 'Steuerpuffer in % vom Gewinn', { type: 'number', span: true, hint: 'Nur für die Schätzung unter „Finanzen“. Üblich sind 20–35 % – stimm den Wert mit deinem Steuerberater ab.' })}
              </div>
            </Card>
          </div>
          <div className="stack-lg">
            <Card title="Größen" subtitle="Für Fashion-Anfragen und Produktsendungen">
              <div className="form-grid">
                <Field label="Oberteil" error={errors.size_top}><Select value={v.size_top} onChange={set('size_top')} placeholder="–" options={sizeOptions(SIZE_TOP_GROUPS)} /></Field>
                <Field label="Hose" error={errors.size_bottom}><Select value={v.size_bottom} onChange={set('size_bottom')} placeholder="–" options={sizeOptions(SIZE_BOTTOM_GROUPS)} /></Field>
                <Field label="Schuhe" error={errors.size_shoes}><Select value={v.size_shoes} onChange={set('size_shoes')} placeholder="–" options={SHOE_SIZES} /></Field>
                {F('height_cm', 'Körpergröße (cm)', { type: 'number' })}
                {F('size_notes', 'Hinweis', { span: true, placeholder: 'z. B. fällt bei Jeans eher klein aus' })}
              </div>
            </Card>
            <Card title="Deine Kanäle" subtitle="Pflegt dein Team – sag Bescheid, wenn sich etwas ändert">
              {!data.socials.length ? <p className="muted small">Noch keine Kanäle hinterlegt.</p> : (
                <ul className="portal-list">
                  {data.socials.map((s) => (
                    <li key={s.platform} className="portal-list-row">
                      <Icon name={s.platform} size={18} />
                      <div className="grow"><div className="strong">@{s.username || '–'}</div></div>
                      <span className="muted small">{fmtNumber(s.followers)} Follower</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Dein Management">
              <dl className="facts">
                <dt>Ansprechpartner</dt><dd>{data.readonly.manager_name || '–'}</dd>
                {data.readonly.manager_email && <><dt>E-Mail</dt><dd><a className="link" href={`mailto:${data.readonly.manager_email}`}>{data.readonly.manager_email}</a></dd></>}
                {data.readonly.commission_rate != null && <><dt>LLK-Provision</dt><dd>{pct(data.readonly.commission_rate)}</dd></>}
              </dl>
            </Card>
          </div>
        </div>
      </fieldset>
    </form>
  );
}

function SecurityPage() {
  return (
    <div className="page">
      <PageHeader title="Sicherheit" subtitle="Login-Daten, Passwort und Zwei-Faktor-Anmeldung" />
      <div className="grid-2 align-start">
        <div className="stack-lg"><ProfileCard /><PasswordCard /></div>
        <div className="stack-lg"><TwoFactorCard /></div>
      </div>
    </div>
  );
}
