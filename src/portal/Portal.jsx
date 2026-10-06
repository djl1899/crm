// Creator-Bereich: eigene Oberfläche für eingeloggte Creator
import { useEffect, useState } from 'react';
import { useLocation, matchPath, Link, useNavigate } from '../lib/router.jsx';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { useApi, invalidateAll } from '../lib/useApi.js';
import {
  Button, Card, Badge, Avatar, Spinner, ErrorBox, Empty, PageHeader, Segmented, Field, Select, Modal, useUi, handleFormError,
} from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { fmtMoney, fmtDate, fmtDue, fmtBytes, fmtDateTime, fmtNumber } from '../lib/format.js';
import { GuidesPage, GuideViewPage } from '../pages/Guides.jsx';
import { ProfileCard, PasswordCard, TwoFactorCard } from '../pages/Settings.jsx';
import { SIZE_TOP_GROUPS, SIZE_BOTTOM_GROUPS, SHOE_SIZES, MAX_UPLOAD_BYTES } from '../../shared/constants.js';

const NAV = [
  { to: '/', label: 'Übersicht', icon: 'home' },
  { to: '/kooperationen', label: 'Kooperationen', icon: 'briefcase' },
  { to: '/verdienst', label: 'Verdienst', icon: 'wallet' },
  { to: '/dokumente', label: 'Dokumente', icon: 'file' },
  { to: '/wissen', label: 'Wissen', icon: 'book' },
  { section: 'Konto' },
  { to: '/profil', label: 'Meine Daten', icon: 'user' },
  { to: '/einstellungen', label: 'Sicherheit', icon: 'lock' },
];

// Wie Creator den Status einer Kooperation sehen
const STATUS = {
  Anfrage: ['Anfrage', 'gray'], Verhandlung: ['In Verhandlung', 'amber'], Geplant: ['Geplant', 'blue'], Aktiv: ['Läuft', 'green'],
  'Content ausstehend': ['Content fällig', 'violet'], Abnahme: ['In Prüfung', 'teal'], Abgeschlossen: ['Abgeschlossen', 'muted'], Abgebrochen: ['Abgebrochen', 'red'],
};
const CollabStatus = ({ value }) => <Badge tone={STATUS[value]?.[1] || 'gray'} dot>{STATUS[value]?.[0] || value}</Badge>;
const PayoutBadge = ({ c }) => (c.payout_status === 'Ausgezahlt' ? <Badge tone="green">Ausgezahlt</Badge> : c.confirmed ? <Badge tone="amber">Auszahlung offen</Badge> : <Badge tone="gray">Noch nicht bestätigt</Badge>);
const CAN_SUBMIT = ['Geplant', 'Aktiv', 'Content ausstehend', 'Abnahme'];

const ROUTES = [
  ['/', HomePage],
  ['/kooperationen', CollabsPage],
  ['/verdienst', EarningsPage],
  ['/dokumente', DocumentsPage],
  ['/wissen', (p) => <GuidesPage base="/wissen" title="Wissen" subtitle="Steuern, Werbekennzeichnung, Rechnungen – kurz erklärt und als PDF." {...p} />],
  ['/wissen/:slug', (p) => <GuideViewPage base="/wissen" backLabel="Alle Themen" {...p} />],
  ['/profil', ProfilePage],
  ['/einstellungen', SecurityPage],
];

export function PortalApp({ agencyName = 'LLK Management' }) {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [pathname]);
  const isActive = (to) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(to + '/'));

  let page = <Empty icon="alert" title="Seite nicht gefunden" text="Diese Seite gibt es im Creator-Bereich nicht." action={<Link to="/" className="link">Zur Übersicht</Link>} />;
  for (const [pattern, Page] of ROUTES) {
    const params = matchPath(pattern, pathname);
    if (params) { page = <Page key={pattern + JSON.stringify(params)} params={params} />; break; }
  }

  return (
    <div className="app portal">
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">{agencyName.slice(0, 1)}</span>
          <span className="brand-name">{agencyName}<span className="brand-sub">Creator-Bereich</span></span>
          <button className="icon-btn sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Menü schließen"><Icon name="x" /></button>
        </div>
        <nav className="nav">
          {NAV.map((n, i) =>
            n.section ? <div key={i} className="nav-section">{n.section}</div> : (
              <Link key={n.to} to={n.to} className={`nav-item ${isActive(n.to) ? 'active' : ''}`}>
                <Icon name={n.icon} size={18} /><span>{n.label}</span>
              </Link>
            )
          )}
        </nav>
        <div className="sidebar-footer">
          <Avatar name={user.name} size={32} />
          <div className="sidebar-user">
            <div className="sidebar-user-name">{user.name}</div>
            <div className="sidebar-user-role">Creator</div>
          </div>
          <button className="icon-btn" onClick={logout} title="Abmelden" aria-label="Abmelden"><Icon name="logout" size={17} /></button>
        </div>
      </aside>
      {mobileOpen && <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />}
      <div className="main">
        <header className="topbar portal-topbar">
          <button className="icon-btn menu-toggle" onClick={() => setMobileOpen(true)} aria-label="Menü öffnen"><Icon name="menu" /></button>
          <div className="portal-topbar-title">{agencyName}</div>
          <div className="topbar-actions">
            <button className="icon-btn" onClick={logout} title="Abmelden" aria-label="Abmelden"><Icon name="logout" size={17} /></button>
          </div>
        </header>
        <main className="content">{page}</main>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
function HomePage() {
  const { data, error, loading, reload } = useApi('/portal/overview');
  const { toast } = useUi();
  if (loading && !data) return <Spinner label="Lade deinen Bereich…" />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const { creator, stats, upcoming, todos, documents, year } = data;
  const hello = new Date().getHours() < 11 ? 'Guten Morgen' : new Date().getHours() < 18 ? 'Hallo' : 'Guten Abend';

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
          <p className="page-subtitle">Hier siehst du deine Kooperationen, Deadlines und Auszahlungen.</p>
        </div>
      </div>

      {creator.profile_missing.length > 0 && (
        <Link to="/profil" className="portal-notice">
          <Icon name="alert" size={18} />
          <span><strong>Deine Rechnungs- oder Bankdaten fehlen noch.</strong> Ohne sie können wir nicht auszahlen – trag sie kurz unter „Meine Daten“ ein.</span>
          <Icon name="chevronRight" size={16} />
        </Link>
      )}

      <div className="stat-row portal-stats">
        <StatTile icon="wallet" label={`Ausgezahlt ${year}`} value={fmtMoney(stats.paid_year)} to="/verdienst" tone="green" />
        <StatTile icon="clock" label="Auszahlung offen" value={fmtMoney(stats.open_payout)} to="/verdienst" />
        <StatTile icon="briefcase" label="Laufende Kooperationen" value={stats.active + stats.planned} hint={stats.planned ? `davon ${stats.planned} geplant` : null} to="/kooperationen" />
        <StatTile icon="send" label="Neue Anfragen" value={stats.requests} to="/kooperationen?filter=requests" />
      </div>

      <div className="grid-2 align-start">
        <div className="stack-lg">
          <Card title="Als Nächstes" subtitle="Deine nächsten Deadlines" padded={false} actions={<Link to="/kooperationen" className="link small">Alle anzeigen</Link>}>
            {!upcoming.length ? <Empty icon="calendar" title="Gerade nichts geplant" text="Neue Kooperationen erscheinen hier, sobald sie bestätigt sind." /> : (
              <ul className="portal-list">
                {upcoming.map((c) => {
                  const due = c.deadline || c.start_date;
                  const overdue = due && due < new Date().toISOString().slice(0, 10);
                  return (
                    <li key={c.id}>
                      <Link to={`/kooperationen?open=${c.id}`} className="portal-list-row">
                        <div className="portal-date">
                          <span>{due ? fmtDate(due).slice(0, 6) : '–'}</span>
                          <small className={overdue ? 'tone-red' : ''}>{due ? fmtDue(due) : 'ohne Datum'}</small>
                        </div>
                        <div className="grow">
                          <div className="strong">{c.brand}{c.campaign_name && <span className="muted"> · {c.campaign_name}</span>}</div>
                          <div className="small muted clamp-1">{c.deliverables || c.platform || 'Details folgen'}</div>
                        </div>
                        <CollabStatus value={c.status} />
                      </Link>
                    </li>
                  );
                })}
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
                    <Button size="sm" icon="check" onClick={() => done(t)}>Erledigt</Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
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
          <Card title="Neue Dokumente" padded={false} actions={<Link to="/dokumente" className="link small">Alle</Link>}>
            {!documents.length ? <Empty icon="file" title="Noch keine Dokumente" text="Verträge, Briefings und Abrechnungen findest du hier." /> : (
              <ul className="portal-list">
                {documents.map((d) => (
                  <li key={d.id}>
                    <a className="portal-list-row" href={`/api/portal/documents/${d.id}/file`} target="_blank" rel="noopener noreferrer">
                      <Icon name="file" size={18} />
                      <div className="grow"><div className="strong clamp-1">{d.filename}</div><div className="small muted">{d.category} · {fmtDate(d.created_at)}</div></div>
                      <Icon name="external" size={15} />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Gut zu wissen" padded={false}>
            <ul className="portal-list">
              {[
                ['werbekennzeichnung', 'Wann und wie du Werbung kennzeichnest'],
                ['steuern-ueberblick', 'Steuern: Was alles steuerpflichtig ist'],
                ['sachleistungen', 'Produkte & Reisen versteuern'],
              ].map(([slug, t]) => (
                <li key={slug}>
                  <Link to={`/wissen/${slug}`} className="portal-list-row"><Icon name="book" size={17} /><span className="grow">{t}</span><Icon name="chevronRight" size={15} /></Link>
                </li>
              ))}
            </ul>
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

// ------------------------------------------------------------------
function CollabsPage() {
  const params = new URLSearchParams(useLocation().search);
  const navigate = useNavigate();
  const filter = params.get('filter') || 'current';
  const openId = Number(params.get('open')) || null;
  const { data, error, loading, reload } = useApi(`/portal/collaborations?filter=${filter === 'all' ? '' : filter}`);
  const [submit, setSubmit] = useState(null);
  const setFilter = (f) => navigate(`/kooperationen?filter=${f}`);

  return (
    <div className="page">
      <PageHeader title="Kooperationen" subtitle="Alles zu deinen Deals: was zu tun ist, bis wann und was du bekommst." />
      <div className="toolbar">
        <Segmented value={filter} onChange={setFilter} options={[
          { value: 'current', label: 'Aktuell' }, { value: 'requests', label: 'Anfragen' }, { value: 'done', label: 'Abgeschlossen' }, { value: 'all', label: 'Alle' },
        ]} />
      </div>
      {loading && !data ? <Spinner /> : error && !data ? <ErrorBox error={error} onRetry={reload} /> : !data.items.length ? (
        <Card><Empty icon="briefcase" title="Hier ist gerade nichts" text={filter === 'requests' ? 'Neue Anfragen von Marken erscheinen hier.' : 'Sobald es Kooperationen gibt, siehst du sie hier.'} /></Card>
      ) : (
        <div className="stack">
          {data.items.map((c) => <CollabCard key={c.id} c={c} defaultOpen={c.id === openId || data.items.length === 1} onSubmit={() => setSubmit(c)} />)}
        </div>
      )}
      <SubmitModal collab={submit} onClose={() => setSubmit(null)} />
    </div>
  );
}

function CollabCard({ c, defaultOpen, onSubmit }) {
  const [open, setOpen] = useState(defaultOpen);
  const due = c.deadline;
  return (
    <section className={`card collab-card ${open ? 'open' : ''}`} id={`k${c.id}`}>
      <button className="collab-card-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="grow">
          <div className="collab-card-title">{c.brand}{c.campaign_name && <span className="muted"> · {c.campaign_name}</span>}</div>
          <div className="small muted">
            {[c.platform, due && `Deadline ${fmtDate(due)} (${fmtDue(due)})`, !due && c.start_date && `Start ${fmtDate(c.start_date)}`].filter(Boolean).join(' · ') || 'Details folgen'}
          </div>
        </div>
        <div className="collab-card-right">
          <CollabStatus value={c.status} />
          <div className="collab-card-amount">{fmtMoney(c.payout)}</div>
        </div>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={18} />
      </button>
      {open && (
        <div className="collab-card-body">
          <div className="grid-2 align-start">
            <div className="stack">
              {c.deliverables && <div><div className="label">Was du lieferst</div><div className="pre-wrap">{c.deliverables}</div></div>}
              {c.description && <div><div className="label">Briefing</div><div className="pre-wrap">{c.description}</div></div>}
              <dl className="facts">
                <dt>Zeitraum</dt><dd>{c.start_date || c.end_date ? `${fmtDate(c.start_date)} – ${fmtDate(c.end_date)}` : '–'}</dd>
                <dt>Deadline</dt><dd>{due ? `${fmtDate(due)} (${fmtDue(due)})` : '–'}</dd>
                <dt>Plattform</dt><dd>{c.platform || '–'}</dd>
              </dl>
            </div>
            <div className="stack">
              <div className="money-box">
                <div className="money-row"><span>Honorar der Marke</span><span>{fmtMoney(c.fee)}</span></div>
                <div className="money-row muted"><span>Provision Management ({String(Number(c.commission_rate)).replace('.', ',')} %)</span><span>− {fmtMoney(c.agency_fee)}</span></div>
                <div className="money-row total"><span>Deine Auszahlung</span><span>{fmtMoney(c.payout)}</span></div>
                <div className="money-status"><PayoutBadge c={c} /></div>
              </div>
              {c.documents?.length > 0 && (
                <div>
                  <div className="label">Dokumente</div>
                  {c.documents.map((d) => (
                    <a key={d.id} className="doc-chip" href={`/api/portal/documents/${d.id}/file`} target="_blank" rel="noopener noreferrer"><Icon name="file" size={14} /> {d.filename}</a>
                  ))}
                </div>
              )}
            </div>
          </div>
          {c.content_submitted_at ? (
            <div className="submitted-box">
              <div className="strong small"><Icon name="check" size={14} /> Content eingereicht am {fmtDateTime(c.content_submitted_at)}</div>
              {(c.content_links || '').split('\n').filter(Boolean).map((l) => <a key={l} className="link small break" href={l} target="_blank" rel="noopener noreferrer">{l}</a>)}
              {CAN_SUBMIT.includes(c.status) && <button className="link small" onClick={onSubmit}>Links ändern</button>}
            </div>
          ) : CAN_SUBMIT.includes(c.status) ? (
            <div className="collab-card-actions">
              <Button variant="primary" icon="upload" onClick={onSubmit}>Content einreichen</Button>
              <span className="small muted">Links zu deinen Entwürfen oder fertigen Posts – dein Team prüft und gibt Bescheid.</span>
            </div>
          ) : null}
        </div>
      )}
    </section>
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
        <p className="small muted">Denk an die Kennzeichnung mit „Werbung“ oder „Anzeige“ am Anfang. <Link to="/wissen/werbekennzeichnung" className="link">So geht's</Link></p>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

function EarningsPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, error, loading, reload } = useApi(`/portal/earnings?year=${year}`);
  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const { totals, months, items } = data;
  const max = Math.max(1, ...months.map((m) => m.paid + m.open));
  return (
    <div className="page">
      <PageHeader title="Verdienst" subtitle="Was du über Kooperationen verdienst und was schon überwiesen ist."
        actions={<Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))} options={data.years.map((y) => ({ value: String(y), label: String(y) }))} />} />
      <div className="stat-row portal-stats">
        <div className="stat"><div className="stat-label"><Icon name="check" size={15} />Ausgezahlt</div><div className="stat-value tone-green">{fmtMoney(totals.paid)}</div></div>
        <div className="stat"><div className="stat-label"><Icon name="clock" size={15} />Noch offen</div><div className="stat-value">{fmtMoney(totals.open)}</div></div>
        <div className="stat"><div className="stat-label"><Icon name="wallet" size={15} />Gesamt {year}</div><div className="stat-value">{fmtMoney(totals.paid + totals.open)}</div><div className="stat-hint">{totals.count} Kooperationen</div></div>
        <div className="stat"><div className="stat-label"><Icon name="euro" size={15} />Honorare gesamt</div><div className="stat-value">{fmtMoney(totals.gross)}</div><div className="stat-hint">davon Provision {fmtMoney(totals.agency)}</div></div>
      </div>
      <Card title={`Monate ${year}`} subtitle="Grün = ausgezahlt, hell = noch offen">
        <div className="bars" role="img" aria-label={`Verdienst pro Monat ${year}`}>
          {months.map((m) => (
            <div key={m.month} className="bar-col" title={`${MONTHS[m.month - 1]}: ${fmtMoney(m.paid)} ausgezahlt, ${fmtMoney(m.open)} offen`}>
              <div className="bar-stack">
                <div className="bar bar-open" style={{ height: `${(m.open / max) * 100}%` }} />
                <div className="bar bar-paid" style={{ height: `${(m.paid / max) * 100}%` }} />
              </div>
              <div className="bar-label">{MONTHS[m.month - 1]}</div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Einzelne Kooperationen" padded={false}>
        {!items.length ? <Empty icon="wallet" title={`Keine Einnahmen in ${year}`} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Datum</th><th>Marke</th><th className="num">Honorar</th><th className="num">Provision</th><th className="num">Deine Auszahlung</th><th>Status</th></tr></thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id}>
                    <td className="nowrap">{fmtDate(c.rev_date)}</td>
                    <td><div className="strong">{c.brand}</div>{c.campaign_name && <div className="small muted">{c.campaign_name}</div>}</td>
                    <td className="num">{fmtMoney(c.fee)}</td>
                    <td className="num muted">{fmtMoney(c.agency_fee)}</td>
                    <td className="num strong">{fmtMoney(c.payout)}</td>
                    <td><PayoutBadge c={c} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="portal-tip">
        <Icon name="sparkle" size={18} />
        <div><strong>Tipp:</strong> Leg von jeder Auszahlung etwa 25–35 % für Steuern zurück. Auch Produkte, die du behalten darfst, zählen als Einnahme. <Link to="/wissen/steuern-ueberblick" className="link">Mehr dazu</Link></div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
function DocumentsPage() {
  const { data, error, loading, reload } = useApi('/portal/documents');
  const [upload, setUpload] = useState(false);
  return (
    <div className="page">
      <PageHeader title="Dokumente" subtitle="Verträge, Briefings und Abrechnungen von deinem Team – und deine eigenen Uploads."
        actions={<Button variant="primary" icon="upload" onClick={() => setUpload(true)}>Hochladen</Button>} />
      <Card padded={false}>
        {loading && !data ? <Spinner /> : error && !data ? <ErrorBox error={error} onRetry={reload} /> : !data.items.length ? (
          <Empty icon="file" title="Noch keine Dokumente" text="Dein Team teilt hier Verträge und Briefings. Deine Rechnungen kannst du selbst hochladen." />
        ) : (
          <ul className="doc-list">
            {data.items.map((d) => (
              <li key={d.id} className="doc-row">
                <span className="doc-icon"><Icon name="file" size={18} /></span>
                <div className="doc-main">
                  <a href={`/api/portal/documents/${d.id}/file`} target="_blank" rel="noopener noreferrer" className="strong doc-name">{d.filename}</a>
                  <div className="cell-sub muted">
                    <Badge tone="gray">{d.category}</Badge>{d.uploaded_by_me && <> <Badge tone="violet">Von dir</Badge></>} {fmtBytes(d.size_bytes)} · {fmtDate(d.created_at)}
                    {d.collaboration_brand && <> · {d.collaboration_brand}</>}
                  </div>
                </div>
                <div className="doc-actions">
                  <a className="icon-btn" href={`/api/portal/documents/${d.id}/file`} target="_blank" rel="noopener noreferrer" title="Öffnen"><Icon name="eye" size={16} /></a>
                  <a className="icon-btn" href={`/api/portal/documents/${d.id}/file?download=1`} title="Herunterladen"><Icon name="download" size={16} /></a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <PortalUploadModal open={upload} onClose={() => setUpload(false)} categories={data?.upload_categories || ['Rechnungen', 'Sonstige Dokumente']} />
    </div>
  );
}

function PortalUploadModal({ open, onClose, categories }) {
  const { toast } = useUi();
  const collabs = useApi(open ? '/portal/collaborations?filter=' : null);
  const [file, setFile] = useState(null);
  const [category, setCategory] = useState('Rechnungen');
  const [collab, setCollab] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setFile(null); setErrors({}); setCollab(''); setCategory('Rechnungen'); } }, [open]);
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
function ProfilePage() {
  const { data, error, loading, reload } = useApi('/portal/profile');
  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  return <ProfileForm key={JSON.stringify(data.profile)} data={data} />;
}

function ProfileForm({ data }) {
  const { toast } = useUi();
  const p = data.profile;
  const str = (x) => (x === null || x === undefined ? '' : String(x));
  const [v, setV] = useState(() => ({
    ...Object.fromEntries(Object.entries(p).map(([k, x]) => [k, str(x)])),
    small_business: p.small_business === true ? 'true' : p.small_business === false ? 'false' : '',
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
        actions={<Button variant="primary" type="submit" loading={saving} icon="check">Speichern</Button>} />
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
              <Field label="Kleinunternehmer (§ 19 UStG)?" error={errors.small_business} className="span-2" hint="Weißt du nicht? Steht in deinem Fragebogen zur steuerlichen Erfassung – oder frag dein Team.">
                <Select value={v.small_business} onChange={set('small_business')} placeholder="– bitte wählen –" options={[{ value: 'true', label: 'Ja, ich bin Kleinunternehmer' }, { value: 'false', label: 'Nein, ich weise Umsatzsteuer aus' }]} />
              </Field>
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
          {data.readonly.manager_name && (
            <Card title="Dein Management">
              <dl className="facts">
                <dt>Ansprechpartner</dt><dd>{data.readonly.manager_name}</dd>
                {data.readonly.manager_email && <><dt>E-Mail</dt><dd><a className="link" href={`mailto:${data.readonly.manager_email}`}>{data.readonly.manager_email}</a></dd></>}
              </dl>
            </Card>
          )}
        </div>
      </div>
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
