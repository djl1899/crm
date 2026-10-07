import { useState, useEffect } from 'react';
import { api, qs } from '../lib/api.js';
import { useApi, invalidateAll } from '../lib/useApi.js';
import { useSearchParams, useNavigate, Link } from '../lib/router.jsx';
import { useAuth, useLookups } from '../lib/auth.jsx';
import {
  Button, IconButton, Card, Avatar, StatusBadge, TagChip, Tabs, Spinner, ErrorBox, Empty, Menu, Field, Select, Badge,
  useUi, handleFormError,
} from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { OutreachModal, CollaborationModal, TaskModal, UploadModal, UserSelect, TagPicker } from '../components/forms.jsx';
import { ActivityFeed } from './Dashboard.jsx';
import {
  fmtNumber, fmtMoney, fmtDate, fmtDateTime, fmtRelative, fmtDue, fmtPercent, fmtBytes,
} from '../lib/format.js';
import {
  CREATOR_STATUSES, OUTREACH_STATUSES, CONTRACT_STATUSES, PLATFORMS, INVOICE_STATUSES, TASK_STATUSES, PAYOUT_STATUSES,
  SIZE_TOP_GROUPS, SIZE_BOTTOM_GROUPS, SHOE_SIZES, DOCUMENT_CATEGORIES,
} from '../../shared/constants.js';

const TABS = [
  ['overview', 'Übersicht'], ['contact', 'Kontaktdaten'], ['social', 'Social Media'], ['outreach', 'Outreach'],
  ['collaborations', 'Kooperationen'], ['tasks', 'Aufgaben'], ['contract', 'Vertrag & Dokumente'], ['finance', 'Finanzen'],
  ['activity', 'Aktivitäten'], ['notes', 'Notizen'],
];

export function CreatorProfilePage({ params }) {
  const id = Number(params.id);
  const { data, error, loading, reload } = useApi(`/creators/${id}`);
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'overview';
  const [modal, setModal] = useState(null); // {type, item}

  if (loading && !data) return <Spinner label="Profil wird geladen…" />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const { creator, stats } = data;
  const open = (type, item = null) => setModal({ type, item });
  const close = () => setModal(null);

  return (
    <div className="page profile">
      <ProfileHeader data={data} onContact={() => open('outreach')} />

      <div className="profile-kpis">
        <Kpi icon="instagram" label="Instagram Follower" value={fmtNumber(data.socials.instagram?.followers)} />
        <Kpi icon="tiktok" label="TikTok Follower" value={fmtNumber(data.socials.tiktok?.followers)} />
        <Kpi icon="euro" label="Gesamtumsatz" value={fmtMoney(stats.total_revenue)} sub={`davon Provision ${fmtMoney(stats.agency_revenue)}`} subTone="muted" onClick={() => setSp({ tab: 'finance' })} />
        <Kpi icon="briefcase" label="Aktive Kooperationen" value={stats.active_collabs} onClick={() => setSp({ tab: 'collaborations' })} />
        <Kpi icon="tasks" label="Offene Aufgaben" value={stats.open_tasks} tone={stats.overdue_tasks ? 'red' : null}
          sub={stats.overdue_tasks ? `${stats.overdue_tasks} überfällig` : null} onClick={() => setSp({ tab: 'tasks' })} />
        <Kpi icon="file" label="Vertrag" value={<StatusBadge value={data.contract.status} />} onClick={() => setSp({ tab: 'contract' })} />
      </div>

      <Tabs
        value={tab}
        onChange={(t) => setSp({ tab: t === 'overview' ? null : t })}
        tabs={TABS.map(([key, label]) => ({
          key, label,
          count: key === 'outreach' ? stats.outreach_count : key === 'collaborations' ? stats.collab_count : key === 'tasks' ? stats.open_tasks : key === 'contract' ? stats.document_count : undefined,
        }))}
      />

      <div className="tab-panel">
        {tab === 'overview' && <OverviewTab data={data} open={open} setTab={(t) => setSp({ tab: t })} />}
        {tab === 'contact' && <ContactTab creator={creator} />}
        {tab === 'social' && <SocialTab socials={data.socials} creatorId={id} />}
        {tab === 'outreach' && <OutreachTab creator={creator} open={open} />}
        {tab === 'collaborations' && <CollabTab creator={creator} open={open} />}
        {tab === 'tasks' && <TasksTab creator={creator} open={open} />}
        {tab === 'contract' && <ContractTab data={data} open={open} />}
        {tab === 'finance' && <FinanceTab creator={creator} stats={stats} open={open} />}
        {tab === 'activity' && <ActivityTab creatorId={id} />}
        {tab === 'notes' && <NotesTab creator={creator} />}
      </div>

      <OutreachModal open={modal?.type === 'outreach'} onClose={close} creator={creator} activity={modal?.item} />
      <CollaborationModal open={modal?.type === 'collab'} onClose={close} creator={creator} collaboration={modal?.item} />
      <TaskModal open={modal?.type === 'task'} onClose={close} task={modal?.item} defaults={{ creator, collaborationId: modal?.collabId }} />
      <UploadModal open={modal?.type === 'upload'} onClose={close} creator={creator} defaultCategory={modal?.item || 'Sonstige Dokumente'} />
    </div>
  );
}

function Kpi({ icon, label, value, sub, subTone, tone, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`kpi ${onClick ? 'kpi-link' : ''}`} onClick={onClick} type={onClick ? 'button' : undefined}>
      <div className="kpi-label"><Icon name={icon} size={14} /> {label}</div>
      <div className={`kpi-value ${tone ? 'tone-' + tone : ''}`}>{value}</div>
      {sub && <div className={`kpi-sub ${subTone === 'muted' ? 'muted' : ''}`}>{sub}</div>}
    </Tag>
  );
}

// ------------------------------------------------------------------
function ProfileHeader({ data, onContact }) {
  const { creator, socials, tags } = data;
  const { user } = useAuth();
  const { toast, confirm } = useUi();
  const navigate = useNavigate();
  const [uploading, setUploading] = useState(false);

  const patch = async (payload, msg) => {
    try {
      await api.patch(`/creators/${creator.id}`, payload);
      invalidateAll();
      if (msg) toast(msg);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const uploadAvatar = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    setUploading(true);
    try {
      await api.upload(`/creators/${creator.id}/avatar`, fd);
      invalidateAll();
      toast('Profilbild aktualisiert.');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const archived = creator.status === 'Archiviert';
  const archive = async () => {
    if (archived) return patch({ status: 'Pausiert' }, 'Creator wiederhergestellt (Status: Pausiert).');
    const ok = await confirm({ title: 'Creator archivieren?', message: `„${creator.display_name}“ wird aus der aktiven Liste ausgeblendet, bleibt aber über den Archiv-Filter auffindbar.`, confirmLabel: 'Archivieren' });
    if (ok) patch({ status: 'Archiviert' }, 'Creator archiviert.');
  };
  const remove = async () => {
    const ok = await confirm({
      title: 'Creator endgültig löschen?',
      message: `„${creator.display_name}“ wird mit allen Kooperationen, Aufgaben, Kontakten, Verträgen und Dateien gelöscht.`,
      warning: 'Dieser Vorgang kann nicht rückgängig gemacht werden.',
      confirmLabel: 'Endgültig löschen',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/creators/${creator.id}`);
      invalidateAll();
      toast('Creator gelöscht.');
      navigate('/creators', { replace: true });
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="profile-header card">
      <div className="profile-top">
        <Link to="/creators" className="back-link"><Icon name="chevronLeft" size={16} /> Creator</Link>
      </div>
      <div className="profile-main">
        <label className="profile-avatar" title="Profilbild ändern">
          <Avatar name={creator.display_name} url={creator.avatar_url} size={84} />
          <span className="profile-avatar-overlay">{uploading ? <span className="spinner spinner-sm" /> : <Icon name="camera" size={18} />}</span>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={uploadAvatar} />
        </label>
        <div className="profile-id">
          <div className="profile-name-row">
            <h1 className="profile-name">{creator.display_name}</h1>
            <span className="muted small">#{creator.id}</span>
          </div>
          <div className="profile-handles">
            {PLATFORMS.map((p) =>
              socials[p.key]?.username ? (
                <a key={p.key} href={socials[p.key].url} target="_blank" rel="noopener noreferrer" className="handle">
                  <Icon name={p.key} size={15} /> @{socials[p.key].username} <Icon name="external" size={12} />
                </a>
              ) : null
            )}
            {(creator.city || creator.region) && (
              <span className="handle plain"><Icon name="pin" size={15} /> {[creator.city, creator.region !== creator.city ? creator.region : null, creator.country].filter(Boolean).join(', ')}</span>
            )}
            {creator.niche && <span className="handle plain"><Icon name="sparkle" size={15} /> {creator.niche}</span>}
          </div>
          {tags.length > 0 && <div className="profile-tags">{tags.map((t) => <TagChip key={t.id} tag={t} />)}</div>}
        </div>
        <div className="profile-actions">
          <Button variant="primary" icon="send" onClick={onContact}>Kontakt erfassen</Button>
          <Button icon="eye" onClick={() => navigate(`/creators/${creator.id}/ansicht`)}>Creator-Ansicht ansehen</Button>
          <Button icon="edit" onClick={() => navigate(`/creators/${creator.id}/edit`)}>Bearbeiten</Button>
          <Menu
            trigger={<IconButton icon="more" label="Weitere Aktionen" className="icon-btn-bordered" />}
            items={[
              { label: 'Mediakit öffnen (für Brands)', icon: 'sparkle', onClick: () => window.open(`/api/creators/${creator.id}/mediakit`, '_blank', 'noopener') },
              { label: 'Datenauskunft ansehen / drucken', icon: 'eye', onClick: () => window.open(`/api/creators/${creator.id}/export?format=html`, '_blank', 'noopener') },
              { label: 'Datenauskunft als JSON', icon: 'download', onClick: () => { window.location.href = `/api/creators/${creator.id}/export?format=json`; } },
              { label: archived ? 'Wiederherstellen' : 'Archivieren', icon: archived ? 'restore' : 'archive', onClick: archive },
              user.role === 'admin' && { label: 'Endgültig löschen', icon: 'trash', danger: true, onClick: remove },
            ]}
          />
        </div>
      </div>

      <div className="profile-fields">
        <label className="pf">
          <span>Creator Status</span>
          <select className={`input input-sm status-select tone-${creator.status}`} value={creator.status} onChange={(e) => patch({ status: e.target.value }, 'Status geändert.')}>
            {CREATOR_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="pf">
          <span>Outreach Status</span>
          <select className="input input-sm" value={creator.outreach_status} onChange={(e) => patch({ outreach_status: e.target.value }, 'Outreach-Status geändert.')}>
            {OUTREACH_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <div className="pf">
          <span>Bereits angeschrieben?</span>
          <div className="yesno yesno-sm">
            <button type="button" className={!creator.contacted ? 'active no' : ''} onClick={() => creator.contacted && patch({ contacted: false })}>Nein</button>
            <button type="button" className={creator.contacted ? 'active yes' : ''} onClick={() => !creator.contacted && patch({ contacted: true })}>Ja</button>
          </div>
        </div>
        <label className="pf">
          <span>Verantwortlicher Manager</span>
          <UserSelect className="input input-sm" value={creator.manager_id ? String(creator.manager_id) : ''} onChange={(e) => patch({ manager_id: e.target.value || null }, 'Manager geändert.')} />
        </label>
        <div className="pf">
          <span>Letzter Kontakt</span>
          <strong>{data.last_contact ? <span title={fmtDateTime(data.last_contact.occurred_at)}>{fmtRelative(data.last_contact.occurred_at)} · {data.last_contact.channel}</span> : <span className="muted">noch nie</span>}</strong>
        </div>
        <div className="pf">
          <span>Nächstes Follow-up</span>
          <strong>
            {data.next_follow_up ? (
              <span className={fmtDue(data.next_follow_up.follow_up_date).startsWith('vor') ? 'tone-red' : fmtDue(data.next_follow_up.follow_up_date) === 'heute' ? 'tone-amber' : ''}>
                {fmtDate(data.next_follow_up.follow_up_date)} ({fmtDue(data.next_follow_up.follow_up_date)})
              </span>
            ) : <span className="muted">keins geplant</span>}
          </strong>
        </div>
      </div>
      {archived && (
        <div className="alert alert-warn"><Icon name="archive" size={16} /> Dieser Creator ist archiviert und erscheint nicht in der aktiven Creator-Liste.</div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
function OverviewTab({ data, open, setTab }) {
  const { creator, socials, stats, contract } = data;
  const collabs = useApi(`/collaborations${qs({ creator_id: creator.id, page_size: 100 })}`);
  const tasks = useApi(`/tasks${qs({ creator_id: creator.id, status: 'open', page_size: 5 })}`);
  const outreach = useApi(`/outreach${qs({ creator_id: creator.id, page_size: 3 })}`);
  const current = (collabs.data?.items || []).filter((c) => c.timeframe === 'current');
  const past = (collabs.data?.items || []).filter((c) => c.timeframe === 'past');
  const platforms = PLATFORMS.filter((p) => socials[p.key]).map((p) => p.label);

  return (
    <div className="overview-grid">
      <div className="stack-lg">
      <Card title="Auf einen Blick">
        <dl className="facts">
          <Fact label="Standort" value={[creator.city, creator.region, creator.country].filter(Boolean).join(', ')} />
          <Fact label="Plattformen" value={platforms.join(', ')} />
          <Fact label="Nische" value={creator.niche} />
          <Fact label="Interessen" value={creator.interests} />
          <Fact label="Sprache" value={creator.language} />
          <Fact label="Manager" value={creator.manager_name} />
          <Fact label="Kontaktiert" value={creator.contacted ? 'Ja' : 'Nein'} />
          <Fact label="Letzter Kontakt" value={data.last_contact ? fmtDateTime(data.last_contact.occurred_at) : 'noch nie'} />
          <Fact label="Nachfassen am" value={data.next_follow_up ? fmtDate(data.next_follow_up.follow_up_date) : '–'} />
          <Fact label="Kooperationen" value={`${stats.collab_count} gesamt · ${stats.active_collabs} aktiv`} />
          <Fact label="Vertrag" value={contract.status + (contract.end_date ? ` (bis ${fmtDate(contract.end_date)})` : '')} />
          <Fact label="Gesamtumsatz" value={`${fmtMoney(stats.total_revenue)} (Provision ${fmtMoney(stats.agency_revenue)})`} />
          <Fact label="Provision" value={creator.commission_rate !== null && creator.commission_rate !== undefined ? `${String(creator.commission_rate).replace('.', ',')} % (individuell)` : 'Standard'} />
          <Fact label="Angelegt" value={`${fmtDate(creator.created_at)}${creator.created_by_name ? ' von ' + creator.created_by_name : ''}`} />
        </dl>
      </Card>
      <SizesCard creator={creator} />
      </div>

      <div className="stack-lg">
        <Card title="Aktuelle Kooperationen" actions={<Button size="sm" icon="plus" onClick={() => open('collab')}>Neu</Button>} padded={false}>
          {!current.length ? (
            <Empty icon="briefcase" title="Keine laufenden Kooperationen" text={past.length ? `${past.length} vergangene Kooperation(en)` : null} />
          ) : (
            <ul className="list">
              {current.map((c) => (
                <li key={c.id}>
                  <button className="list-row" onClick={() => open('collab', c)}>
                    <div className="list-main">
                      <div className="list-title">{c.brand}{c.campaign_name ? ` – ${c.campaign_name}` : ''}</div>
                      <div className="list-sub">{c.deadline ? `Deadline ${fmtDate(c.deadline)} · ` : ''}{fmtMoney(c.fee)}</div>
                    </div>
                    <StatusBadge value={c.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Offene Aufgaben" actions={<Button size="sm" icon="plus" onClick={() => open('task')}>Neu</Button>} padded={false}>
          {!tasks.data?.items.length ? (
            <Empty icon="check" title="Keine offenen Aufgaben" />
          ) : (
            <TaskList items={tasks.data.items} onOpen={(t) => open('task', t)} compact />
          )}
        </Card>

        <Card title="Letzte Kontakte" actions={<button className="link" onClick={() => setTab('outreach')}>Kontaktverlauf</button>} padded={false}>
          {!outreach.data?.items.length ? (
            <Empty icon="send" title="Noch nicht kontaktiert" action={<Button size="sm" variant="primary" icon="send" onClick={() => open('outreach')}>Kontakt erfassen</Button>} />
          ) : (
            <ul className="list">
              {outreach.data.items.map((o) => (
                <li key={o.id} className="list-row static">
                  <div className="list-main">
                    <div className="list-title">{o.subject || o.result || o.channel}</div>
                    <div className="list-sub">{fmtDateTime(o.occurred_at)} · {o.channel} · {o.user_name || '–'}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

const Fact = ({ label, value }) => (
  <>
    <dt>{label}</dt>
    <dd>{value || <span className="muted">–</span>}</dd>
  </>
);

// ------------------------------------------------------------------
const SIZE_FIELDS = ['size_top', 'size_bottom', 'size_shoes', 'height_cm', 'size_notes'];
const sizeValues = (c) => Object.fromEntries(SIZE_FIELDS.map((k) => [k, c[k] === null || c[k] === undefined ? '' : String(c[k])]));

function SizeSelect({ value, onChange, groups, options, label }) {
  // eigene Eingaben (z. B. alte Werte) bleiben auswählbar
  const all = groups ? groups.flatMap((g) => g.options) : options;
  return (
    <select className="input" value={value} onChange={onChange} aria-label={label}>
      <option value="">– nicht angegeben –</option>
      {value && !all.includes(value) && <option value={value}>{value}</option>}
      {groups
        ? groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </optgroup>
          ))
        : options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function SizesCard({ creator }) {
  const { toast } = useUi();
  const [vals, setVals] = useState(() => sizeValues(creator));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setVals(sizeValues(creator)); }, [creator.id, creator.updated_at]);
  const initial = sizeValues(creator);
  const dirty = SIZE_FIELDS.some((k) => vals[k] !== initial[k]);
  const set = (k) => (e) => setVals((v) => ({ ...v, [k]: e.target.value }));
  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/creators/${creator.id}`, { ...vals, height_cm: vals.height_cm === '' ? null : vals.height_cm });
      invalidateAll();
      toast('Größen gespeichert.');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card
      title={<span className="with-icon"><Icon name="tag" size={16} /> Größen</span>}
      subtitle="Für Produkte, Outfits & Shootings"
      actions={dirty ? <Button variant="primary" size="sm" onClick={save} loading={saving}>Speichern</Button> : null}
    >
      <div className="sizes-grid">
        <Field label="Oberteile">
          <SizeSelect label="Oberteile" value={vals.size_top} onChange={set('size_top')} groups={SIZE_TOP_GROUPS} />
        </Field>
        <Field label="Hosen">
          <SizeSelect label="Hosen" value={vals.size_bottom} onChange={set('size_bottom')} groups={SIZE_BOTTOM_GROUPS} />
        </Field>
        <Field label="Schuhe (EU)">
          <SizeSelect label="Schuhe" value={vals.size_shoes} onChange={set('size_shoes')} options={SHOE_SIZES} />
        </Field>
        <Field label="Körpergröße (cm)">
          <input className="input" type="number" inputMode="numeric" min="50" max="250" placeholder="z. B. 172" value={vals.height_cm} onChange={set('height_cm')} />
        </Field>
        <Field label="Hinweis" className="span-2">
          <input className="input" maxLength={500} placeholder="z. B. trägt Sneaker eher eine Nummer größer" value={vals.size_notes} onChange={set('size_notes')} />
        </Field>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------
function ContactTab({ creator }) {
  const navigate = useNavigate();
  return (
    <div className="overview-grid">
    <div className="stack-lg">
    <Card title="Kontaktdaten" actions={<Button size="sm" icon="edit" onClick={() => navigate(`/creators/${creator.id}/edit`)}>Bearbeiten</Button>}>
      <dl className="facts">
        <Fact label="Vorname" value={creator.first_name} />
        <Fact label="Nachname" value={creator.last_name} />
        <Fact label="E-Mail" value={creator.email && <a className="link" href={`mailto:${creator.email}`}>{creator.email}</a>} />
        <Fact label="Telefon" value={creator.phone && <a className="link" href={`tel:${creator.phone.replace(/\s/g, '')}`}>{creator.phone}</a>} />
        <Fact label="Ort" value={creator.city} />
        <Fact label="Region" value={creator.region} />
        <Fact label="Land" value={creator.country} />
        <Fact label="Sprache" value={creator.language} />
      </dl>
    </Card>
    <Card title="Rechnungs- & Bankdaten" subtitle="Pflegt der Creator selbst im Creator-Bereich" actions={<Button size="sm" icon="edit" onClick={() => navigate(`/creators/${creator.id}/edit`)}>Bearbeiten</Button>}>
      <dl className="facts">
        <Fact label="Rechnungsname" value={creator.billing_name} />
        <Fact label="Anschrift" value={[creator.billing_street, [creator.billing_zip, creator.billing_city].filter(Boolean).join(' ')].filter(Boolean).join(', ')} />
        <Fact label="IBAN" value={creator.iban && <span className="mono">{creator.iban.replace(/(.{4})/g, '$1 ').trim()}</span>} />
        <Fact label="Kontoinhaber" value={creator.bank_holder} />
        <Fact label="Steuernummer" value={creator.tax_number} />
        <Fact label="USt-IdNr." value={creator.vat_id} />
        <Fact label="Kleinunternehmer" value={creator.small_business === null || creator.small_business === undefined ? null : creator.small_business ? 'Ja (§ 19 UStG)' : 'Nein'} />
      </dl>
    </Card>
    </div>
    <PortalAccessCard creator={creator} />
    </div>
  );
}

function PortalAccessCard({ creator }) {
  const { toast, confirm } = useUi();
  const { data, reload } = useApi(`/creators/${creator.id}/portal`);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState(null);
  const [error, setError] = useState(null);
  const access = data?.access;
  useEffect(() => setEmail(access?.email || creator.email || ''), [access?.email, creator.email]);

  const invite = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post(`/creators/${creator.id}/portal`, { email });
      setLink(r.link);
      toast(r.mailed ? 'Einladung per E-Mail verschickt.' : 'Einladungslink erstellt.');
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = async () => {
    if (access.is_active && !(await confirm({ title: 'Zugang sperren?', message: `${creator.display_name} kann sich danach nicht mehr im Creator-Bereich anmelden.`, confirmLabel: 'Sperren', danger: true }))) return;
    try {
      await api.patch(`/creators/${creator.id}/portal`, { is_active: !access.is_active });
      toast(access.is_active ? 'Zugang gesperrt.' : 'Zugang freigeschaltet.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('Link kopiert.');
    } catch {
      toast('Bitte den Link markieren und kopieren.', 'error');
    }
  };

  return (
    <Card title="Creator-Bereich" subtitle="Eigener Login: Kooperationen, Auszahlungen, Dokumente, Leitfäden">
      {!data ? <Spinner /> : (
        <div className="stack">
          {access ? (
            <dl className="facts">
              <Fact label="Status" value={!access.is_active ? <Badge tone="red">Gesperrt</Badge> : access.has_logged_in ? <Badge tone="green" dot>Aktiv</Badge> : access.invite_pending ? <Badge tone="amber" dot>Eingeladen</Badge> : <Badge tone="gray">Einladung abgelaufen</Badge>} />
              <Fact label="Login-E-Mail" value={access.email} />
              <Fact label="Letzte Anmeldung" value={access.last_login_at ? fmtRelative(access.last_login_at) : 'noch nie'} />
              {access.invite_pending && <Fact label="Einladung gültig bis" value={fmtDateTime(access.invite_expires_at)} />}
            </dl>
          ) : (
            <p className="muted small">Noch kein Zugang. Lege einen an – der Creator bekommt einen Link, um sein Passwort festzulegen.</p>
          )}
          {(!access || !access.has_logged_in || !access.is_active) && (
            <Field label="E-Mail für den Login" error={error}>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@beispiel.de" />
            </Field>
          )}
          {error && access?.has_logged_in && <div className="field-error">{error}</div>}
          <div className="row-wrap">
            <Button variant={access ? 'secondary' : 'primary'} icon="send" loading={busy} onClick={invite} disabled={!email}>
              {!access ? 'Zugang anlegen & einladen' : access.has_logged_in ? 'Neuen Link (Passwort vergessen)' : 'Einladung erneut senden'}
            </Button>
            {access && <Button variant={access.is_active ? 'ghost' : 'secondary'} onClick={toggle}>{access.is_active ? 'Zugang sperren' : 'Wieder freischalten'}</Button>}
          </div>
          {link && (
            <div className="invite-link">
              <div className="small muted">{data.mail_configured ? 'Die Einladung wurde per E-Mail verschickt. Du kannst den Link auch direkt teilen (z. B. per WhatsApp):' : 'E-Mail-Versand ist nicht eingerichtet – schick diesen Link direkt an den Creator:'}</div>
              <div className="invite-link-row">
                <input className="input mono small" readOnly value={link} onFocus={(e) => e.target.select()} />
                <Button size="sm" onClick={copy}>Kopieren</Button>
              </div>
              <div className="small muted">Gültig 7 Tage, nur einmal nutzbar.</div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function SocialTab({ socials, creatorId }) {
  const navigate = useNavigate();
  return (
    <div className="grid-2">
      {PLATFORMS.map((p) => {
        const s = socials[p.key];
        return (
          <Card key={p.key} title={<span className="with-icon"><Icon name={p.key} size={17} /> {p.label}</span>}
            actions={<Button size="sm" icon="edit" onClick={() => navigate(`/creators/${creatorId}/edit`)}>Bearbeiten</Button>}>
            {!s ? (
              <Empty icon={p.key} title={`Kein ${p.label}-Profil hinterlegt`} />
            ) : (
              <dl className="facts">
                <Fact label="Username" value={s.username && '@' + s.username} />
                <Fact label="Profil" value={s.url && <a href={s.url} target="_blank" rel="noopener noreferrer" className="link">{s.url} <Icon name="external" size={12} /></a>} />
                <Fact label="Follower" value={fmtNumber(s.followers)} />
                <Fact label="Engagement Rate" value={fmtPercent(s.engagement_rate)} />
                <Fact label="Notizen" value={s.notes} />
                <Fact label="Aktualisiert" value={fmtDate(s.updated_at)} />
              </dl>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------
function OutreachTab({ creator, open }) {
  const { data, loading } = useApi(`/outreach${qs({ creator_id: creator.id, page_size: 200 })}`);
  const { toast, confirm } = useUi();
  const items = data?.items || [];

  const toggleDone = async (o) => {
    await api.patch(`/outreach/${o.id}`, { follow_up_done: !o.follow_up_done }).catch((e) => toast(e.message, 'error'));
    invalidateAll();
  };
  const remove = async (o) => {
    if (!(await confirm({ title: 'Kontakt löschen?', message: 'Der Eintrag wird aus dem Kontaktverlauf entfernt.', confirmLabel: 'Löschen', danger: true }))) return;
    await api.del(`/outreach/${o.id}`).catch((e) => toast(e.message, 'error'));
    invalidateAll();
  };

  return (
    <Card title="Kontaktverlauf" subtitle="Chronologisch, neueste zuerst" actions={<Button variant="primary" size="sm" icon="plus" onClick={() => open('outreach')}>Kontakt erfassen</Button>}>
      {loading && !data ? <Spinner /> : !items.length ? (
        <Empty icon="send" title="Noch keine Kontakte" text="Erfasse den ersten Kontakt – Status und „angeschrieben“ werden automatisch gesetzt." />
      ) : (
        <ol className="timeline">
          {items.map((o) => (
            <li key={o.id} className="timeline-item">
              <span className="timeline-dot"><Icon name={o.channel === 'E-Mail' ? 'mail' : o.channel === 'Telefon' ? 'phone' : o.channel === 'Instagram DM' ? 'instagram' : 'message'} size={14} /></span>
              <div className="timeline-body">
                <div className="timeline-head">
                  <strong>{fmtDateTime(o.occurred_at)}</strong>
                  <Badge tone="gray">{o.channel}</Badge>
                  {o.result && <Badge tone="blue">{o.result}</Badge>}
                  <span className="muted small">{o.user_name || '–'}</span>
                  <span className="timeline-actions">
                    <IconButton icon="edit" label="Bearbeiten" onClick={() => open('outreach', o)} />
                    <IconButton icon="trash" label="Löschen" onClick={() => remove(o)} />
                  </span>
                </div>
                {o.subject && <div className="timeline-subject">{o.subject}</div>}
                {o.message && <p className="timeline-text">{o.message}</p>}
                {o.follow_up_date && (
                  <button className={`followup-chip ${o.follow_up_done ? 'done' : fmtDue(o.follow_up_date).startsWith('vor') ? 'overdue' : ''}`} onClick={() => toggleDone(o)} title="Als erledigt markieren / wieder öffnen">
                    <Icon name={o.follow_up_done ? 'check' : 'calendar'} size={13} />
                    Follow-up {fmtDate(o.follow_up_date)} {o.follow_up_done ? '· erledigt' : `· ${fmtDue(o.follow_up_date)}`}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------
function CollabTab({ creator, open }) {
  const { data, loading } = useApi(`/collaborations${qs({ creator_id: creator.id, page_size: 200 })}`);
  const items = data?.items || [];
  const groups = [
    ['current', 'Aktuell'],
    ['future', 'Zukünftig / in Anbahnung'],
    ['past', 'Vergangen'],
  ];
  return (
    <div className="stack-lg">
      <div className="toolbar">
        <span className="muted">{items.length} Kooperation(en)</span>
        <Button variant="primary" size="sm" icon="plus" onClick={() => open('collab')}>Kooperation hinzufügen</Button>
      </div>
      {loading && !data ? <Spinner /> : !items.length ? (
        <div className="card"><Empty icon="briefcase" title="Noch keine Kooperationen" /></div>
      ) : (
        groups.map(([key, label]) => {
          const list = items.filter((c) => c.timeframe === key);
          if (!list.length) return null;
          return (
            <Card key={key} title={`${label} (${list.length})`} padded={false}>
              <CollabTable items={list} onOpen={(c) => open('collab', c)} />
            </Card>
          );
        })
      )}
    </div>
  );
}

export function CollabTable({ items, onOpen, showCreator = false }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>ID</th>
            {showCreator && <th>Creator</th>}
            <th>Brand / Kampagne</th>
            <th>Zeitraum</th>
            <th>Deadline</th>
            <th>Plattform</th>
            <th className="num">Vergütung</th>
            <th>Status</th>
            <th>Rechnung</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id} className="row-link" onClick={() => onOpen(c)}>
              <td className="muted">#{c.id}</td>
              {showCreator && <td><Link to={`/creators/${c.creator_id}`} className="strong" onClick={(e) => e.stopPropagation()}>{c.creator_name}</Link></td>}
              <td>
                <div className="strong">{c.brand}</div>
                {c.campaign_name && <div className="cell-sub muted">{c.campaign_name}</div>}
              </td>
              <td className="nowrap">{c.start_date || c.end_date ? `${fmtDate(c.start_date)} – ${fmtDate(c.end_date)}` : <span className="muted">–</span>}</td>
              <td className="nowrap">{c.deadline ? fmtDate(c.deadline) : <span className="muted">–</span>}</td>
              <td className="clip">{c.platform || <span className="muted">–</span>}</td>
              <td className="num nowrap">{fmtMoney(c.fee)}</td>
              <td><StatusBadge value={c.status} /></td>
              <td><StatusBadge value={c.invoice_status} dot={false} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------
function TasksTab({ creator, open }) {
  const [showDone, setShowDone] = useState(false);
  const { data, loading } = useApi(`/tasks${qs({ creator_id: creator.id, status: showDone ? '' : 'open', page_size: 200 })}`);
  return (
    <Card
      title="Aufgaben"
      actions={
        <>
          <label className="checkbox small"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Erledigte anzeigen</label>
          <Button variant="primary" size="sm" icon="plus" onClick={() => open('task')}>Aufgabe</Button>
        </>
      }
      padded={false}
    >
      {loading && !data ? <Spinner /> : !data?.items.length ? (
        <Empty icon="check" title={showDone ? 'Keine Aufgaben' : 'Keine offenen Aufgaben'} />
      ) : (
        <TaskList items={data.items} onOpen={(t) => open('task', t)} />
      )}
    </Card>
  );
}

export function TaskList({ items, onOpen, compact = false, showCreator = false }) {
  const { toast } = useUi();
  const toggle = async (t, e) => {
    e.stopPropagation();
    try {
      await api.patch(`/tasks/${t.id}`, { status: t.status === 'Erledigt' ? 'Offen' : 'Erledigt' });
      invalidateAll();
      if (t.status !== 'Erledigt') toast('Aufgabe erledigt.');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <ul className="task-list">
      {items.map((t) => {
        const done = t.status === 'Erledigt' || t.status === 'Abgebrochen';
        return (
          <li key={t.id} className={`task-row ${done ? 'done' : ''}`} onClick={() => onOpen(t)}>
            <button className={`task-check ${t.status === 'Erledigt' ? 'on' : ''}`} onClick={(e) => toggle(t, e)} aria-label={t.status === 'Erledigt' ? 'Wieder öffnen' : 'Als erledigt markieren'}>
              {t.status === 'Erledigt' && <Icon name="check" size={13} strokeWidth={2.5} />}
            </button>
            <div className="task-main">
              <div className="task-title">{t.title}</div>
              <div className="task-meta">
                {t.due_date && <span className={t.is_overdue ? 'tone-red' : ''}><Icon name="calendar" size={12} /> {fmtDate(t.due_date)} ({fmtDue(t.due_date)})</span>}
                {showCreator && t.creator_name && <span><Icon name="user" size={12} /> {t.creator_name}</span>}
                {t.collaboration_brand && <span><Icon name="briefcase" size={12} /> {t.collaboration_brand}</span>}
                {!compact && t.assignee_name && <span>→ {t.assignee_name}</span>}
              </div>
            </div>
            <div className="task-badges">
              {t.priority !== 'Normal' && <StatusBadge value={t.priority} dot={false} />}
              {!compact && t.status !== 'Offen' && <StatusBadge value={t.status} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------
function ContractTab({ data, open }) {
  const { creator, contract } = data;
  const { toast, confirm } = useUi();
  const [values, setValues] = useState(contract);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => setValues(contract), [contract]);
  const docs = useApi(`/documents${qs({ creator_id: creator.id, page_size: 200 })}`);
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { status, start_date, end_date, exclusivity, usage_rights, notice_period, notes } = values;
      await api.put(`/creators/${creator.id}/contract`, { status, start_date, end_date, exclusivity, usage_rights, notice_period, notes });
      setErrors({});
      invalidateAll();
      toast('Vertrag gespeichert.');
    } catch (err) {
      handleFormError(err, setErrors, toast);
    } finally {
      setSaving(false);
    }
  };
  const toggleShare = async (d) => {
    try {
      await api.patch(`/documents/${d.id}`, { visible_to_creator: !d.visible_to_creator });
      invalidateAll();
      toast(d.visible_to_creator ? 'Im Creator-Bereich verborgen.' : 'Im Creator-Bereich freigegeben.');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const removeDoc = async (d) => {
    if (!(await confirm({ title: 'Datei löschen?', message: `„${d.filename}“ wird dauerhaft gelöscht.`, confirmLabel: 'Löschen', danger: true }))) return;
    try {
      await api.del(`/documents/${d.id}`);
      invalidateAll();
      toast('Datei gelöscht.');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="overview-grid">
      <Card title="Vertrag">
        <form className="form-grid" onSubmit={save}>
          <Field label="Vertragsstatus" error={errors.status}>
            <Select value={values.status} onChange={set('status')} options={CONTRACT_STATUSES} />
          </Field>
          <Field label="Kündigungsfrist" error={errors.notice_period}>
            <input className="input" value={values.notice_period || ''} onChange={set('notice_period')} placeholder="z. B. 3 Monate" />
          </Field>
          <Field label="Vertragsbeginn" error={errors.start_date}>
            <input type="date" className="input" value={values.start_date || ''} onChange={set('start_date')} />
          </Field>
          <Field label="Vertragsende" error={errors.end_date}>
            <input type="date" className="input" value={values.end_date || ''} onChange={set('end_date')} min={values.start_date || undefined} />
          </Field>
          <Field label="Exklusivität" error={errors.exclusivity} className="span-2">
            <input className="input" value={values.exclusivity || ''} onChange={set('exclusivity')} placeholder="z. B. Exklusiv für Beauty im DACH-Raum" />
          </Field>
          <Field label="Nutzungsrechte" error={errors.usage_rights} className="span-2">
            <textarea className="input" rows={2} value={values.usage_rights || ''} onChange={set('usage_rights')} />
          </Field>
          <Field label="Vertragsnotizen" error={errors.notes} className="span-2">
            <textarea className="input" rows={3} value={values.notes || ''} onChange={set('notes')} />
          </Field>
          <div className="span-2 form-actions">
            {contract.updated_at && <span className="muted small">Zuletzt geändert {fmtRelative(contract.updated_at)}</span>}
            <Button variant="primary" type="submit" loading={saving}>Vertrag speichern</Button>
          </div>
        </form>
      </Card>

      <Card
        title="Dokumente"
        actions={
          <Menu
            trigger={<Button size="sm" variant="primary" icon="upload">Hochladen</Button>}
            items={DOCUMENT_CATEGORIES.map((c) => ({ label: c, onClick: () => open('upload', c) }))}
          />
        }
        padded={false}
      >
        <DocumentList items={docs.data?.items} loading={docs.loading && !docs.data} onDelete={removeDoc} onToggleShare={toggleShare} />
      </Card>
    </div>
  );
}

export function DocumentList({ items, loading, onDelete, onToggleShare, showCreator = false }) {
  if (loading) return <Spinner />;
  if (!items?.length) return <Empty icon="file" title="Noch keine Dateien" text="Verträge, Rechnungen, Briefings und Kampagnenunterlagen hier hochladen." />;
  return (
    <ul className="doc-list">
      {items.map((d) => (
        <li key={d.id} className="doc-row">
          <span className="doc-icon"><Icon name="file" size={18} /></span>
          <div className="doc-main">
            <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noopener noreferrer" className="strong doc-name">{d.filename}</a>
            <div className="cell-sub muted">
              <Badge tone="gray">{d.category}</Badge>{' '}
              {d.uploaded_by_creator ? <Badge tone="violet">Vom Creator</Badge> : d.visible_to_creator ? <Badge tone="blue">Für Creator sichtbar</Badge> : null}{' '}
              {fmtBytes(d.size_bytes)} · {fmtDate(d.created_at)} · {d.uploaded_by_name || '–'}
              {showCreator && <> · <Link to={`/creators/${d.creator_id}?tab=contract`} className="link">{d.creator_name}</Link></>}
              {d.collaboration_brand && <> · {d.collaboration_brand}</>}
            </div>
          </div>
          <div className="doc-actions">
            <a className="icon-btn" href={`/api/documents/${d.id}/file`} target="_blank" rel="noopener noreferrer" title="Öffnen"><Icon name="eye" size={16} /></a>
            <a className="icon-btn" href={`/api/documents/${d.id}/file?download=1`} title="Herunterladen"><Icon name="download" size={16} /></a>
            {onToggleShare && (
              <IconButton icon={d.visible_to_creator ? 'eyeOff' : 'share'} label={d.visible_to_creator ? 'Im Creator-Bereich verbergen' : 'Für Creator freigeben'} onClick={() => onToggleShare(d)} />
            )}
            {onDelete && <IconButton icon="trash" label="Löschen" onClick={() => onDelete(d)} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------
function FinanceTab({ creator, stats, open }) {
  const { data } = useApi(`/collaborations${qs({ creator_id: creator.id, page_size: 200 })}`);
  const { toast } = useUi();
  const items = data?.items || [];
  const setField = async (c, patch) => {
    try {
      await api.patch(`/collaborations/${c.id}`, patch);
      invalidateAll();
      toast('Gespeichert.');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const setInvoice = async (c, invoice_status) => {
    try {
      await api.patch(`/collaborations/${c.id}`, { invoice_status });
      invalidateAll();
      toast('Rechnungsstatus aktualisiert.');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <div className="stack-lg">
      <div className="stat-row stat-row-3">
        <div className="stat"><div className="stat-label">Gesamtumsatz</div><div className="stat-value">{fmtMoney(stats.total_revenue)}</div><div className="stat-hint">Summe bestätigter Kooperationen</div></div>
        <div className="stat"><div className="stat-label">Agenturprovision</div><div className="stat-value tone-green">{fmtMoney(stats.agency_revenue)}</div><div className="stat-hint">{creator.commission_rate !== null && creator.commission_rate !== undefined ? `${String(creator.commission_rate).replace('.', ',')} % individuell` : 'Standard-Provision'}</div></div>
        <div className="stat"><div className="stat-label">Offene Auszahlung an Creator</div><div className="stat-value">{fmtMoney(stats.payout_open)}</div><div className="stat-hint">{fmtMoney(stats.open_invoices)} Rechnungen an Brands offen</div></div>
      </div>
      <Card title="Kooperationen & Rechnungsstatus" padded={false}>
        {!items.length ? <Empty icon="euro" title="Noch keine Kooperationen" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Kooperation</th><th>Status</th><th>Zeitraum</th><th className="num">Vergütung</th><th className="num">Provision</th><th>Rechnung (Brand)</th><th>Auszahlung (Creator)</th></tr></thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className={c.counts_as_revenue ? '' : 'row-muted'}>
                    <td><button className="link strong" onClick={() => open('collab', c)}>{c.brand}{c.campaign_name ? ` – ${c.campaign_name}` : ''}</button></td>
                    <td><StatusBadge value={c.status} /></td>
                    <td className="nowrap">{fmtDate(c.start_date)} – {fmtDate(c.end_date)}</td>
                    <td className="num nowrap">{fmtMoney(c.fee)}{!c.counts_as_revenue && <div className="cell-sub muted">nicht im Umsatz</div>}</td>
                    <td className="num nowrap"><div className="strong">{fmtMoney(c.agency_fee)}</div><div className="cell-sub muted">{String(c.commission_effective).replace('.', ',')} %</div></td>
                    <td>
                      <select className="input input-sm" value={c.invoice_status} onChange={(e) => setInvoice(c, e.target.value)}>
                        {INVOICE_STATUSES.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="input input-sm" value={c.payout_status} onChange={(e) => setField(c, { payout_status: e.target.value })}>
                        {PAYOUT_STATUSES.map((s) => <option key={s} value={s}>{s} ({fmtMoney(c.payout)})</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3}><strong>Summe (bestätigte Kooperationen)</strong></td><td className="num"><strong>{fmtMoney(stats.total_revenue)}</strong></td><td className="num"><strong>{fmtMoney(stats.agency_revenue)}</strong></td><td /><td /></tr></tfoot>
            </table>
          </div>
        )}
      </Card>
      <CreatorExpensesCard creatorId={creator.id} />
    </div>
  );
}

function ActivityTab({ creatorId }) {
  const { data, loading } = useApi(`/creators/${creatorId}/activities?limit=200`);
  return (
    <Card title="Aktivitäten-Historie" padded={false}>
      {loading && !data ? <Spinner /> : <ActivityFeed items={data?.items} />}
    </Card>
  );
}

function NotesTab({ creator }) {
  const { toast } = useUi();
  const [notes, setNotes] = useState(creator.notes || '');
  const [saving, setSaving] = useState(false);
  const dirty = notes !== (creator.notes || '');
  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/creators/${creator.id}`, { notes });
      invalidateAll();
      toast('Notizen gespeichert.');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card title="Interne Notizen" subtitle="Nur für das Team sichtbar" actions={<Button variant="primary" size="sm" onClick={save} loading={saving} disabled={!dirty}>Speichern</Button>}>
      <textarea className="input notes-area" rows={14} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notizen zum Creator…" />
      {dirty && <p className="muted small">Ungespeicherte Änderungen</p>}
    </Card>
  );
}


// Ausgaben & Auslagen, die der Creator im Creator-Bereich erfasst hat
const REIMB_TONE = { Keine: 'gray', Beantragt: 'amber', Erstattet: 'green', Abgelehnt: 'red' };
function CreatorExpensesCard({ creatorId }) {
  const { data } = useApi(`/creators/${creatorId}/expenses`);
  const { toast } = useUi();
  const items = data?.items || [];
  const setStatus = async (e, reimbursement_status) => {
    try {
      await api.patch(`/creator-expenses/${e.id}`, { reimbursement_status });
      invalidateAll();
      toast('Erstattung aktualisiert.');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const open = items.filter((e) => e.reimbursement_status === 'Beantragt');
  return (
    <Card title="Ausgaben & Auslagen des Creators" subtitle={open.length ? `${open.length} Erstattung(en) beantragt` : 'Erfasst der Creator selbst im Creator-Bereich'} padded={false}>
      {!items.length ? <Empty icon="wallet" title="Keine Ausgaben erfasst" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Datum</th><th>Beschreibung</th><th>Kooperation</th><th className="num">Brutto</th><th>Beleg</th><th>Erstattung</th></tr></thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{fmtDate(e.expense_date)}</td>
                  <td><div className="strong">{e.title}</div><div className="cell-sub muted">{e.category} · {Number(e.vat_rate)} % USt</div></td>
                  <td>{e.collaboration_brand || '–'}</td>
                  <td className="num nowrap">{fmtMoney(e.amount_gross)}</td>
                  <td>{e.document_id ? <a className="link small" href={`/api/documents/${e.document_id}/file`} target="_blank" rel="noopener noreferrer">{e.receipt_filename || 'Beleg'}</a> : <Badge tone="red">fehlt</Badge>}</td>
                  <td>
                    <select className={`status-select badge badge-${REIMB_TONE[e.reimbursement_status] || 'gray'}`} value={e.reimbursement_status} onChange={(ev) => setStatus(e, ev.target.value)} aria-label="Erstattung">
                      {(data.statuses || []).map((st) => <option key={st}>{st}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
