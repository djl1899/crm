// Bereich "App": Steuerung der Marktplatz-App. Eigene Daten (app_*), getrennt vom CRM.
import { useEffect, useState } from 'react';
import { api, qs } from '../lib/api.js';
import { useApi, useForm, useDebounced, invalidateAll } from '../lib/useApi.js';
import { useSearchParams } from '../lib/router.jsx';
import { useAuth, useLookups } from '../lib/auth.jsx';
import {
  PageHeader, Card, Stat, Button, IconButton, Modal, Field, Select, Tabs, Spinner, ErrorBox, Empty, Pagination, Badge,
  useUi, handleFormError,
} from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { fmtMoney, fmtDate, fmtDue, fmtNumber, fmtCompact, todayStr, fmtRelative } from '../lib/format.js';
import {
  APP_INFLUENCER_STATUSES, APP_COMPANY_STATUSES, APP_CAMPAIGN_STATUSES, APP_ASSIGNMENT_STATUSES, APP_ROADMAP_STATUSES,
  APP_ROADMAP_AREAS, APP_UPDATE_TYPES, APP_PLATFORMS, TASK_PRIORITIES,
} from '../../shared/constants.js';

const TONES = {
  Interessent: 'gray', Warteliste: 'amber', 'Beta-Tester': 'violet', Aktiv: 'green', Inaktiv: 'muted',
  Lead: 'gray', 'Im Gespräch': 'blue', Pilotkunde: 'violet', 'Zahlender Kunde': 'green', Abgesprungen: 'red',
  Entwurf: 'gray', Matching: 'violet', Abgeschlossen: 'green', Abgebrochen: 'red',
  Vorgeschlagen: 'gray', Angefragt: 'blue', Zugesagt: 'violet', 'Content geliefert': 'teal', Bezahlt: 'green', Abgesagt: 'red',
  Idee: 'gray', Geplant: 'blue', 'In Arbeit': 'amber', Test: 'violet', Fertig: 'green',
  Meilenstein: 'violet', Release: 'green', Feature: 'blue', Bugfix: 'red', Notiz: 'gray',
  Niedrig: 'gray', Normal: 'blue', Hoch: 'amber', Dringend: 'red',
};
const S = ({ value, dot = true }) => (value ? <Badge tone={TONES[value] || 'gray'} dot={dot}>{value}</Badge> : <span className="muted">–</span>);

const TABS = [
  ['overview', 'Übersicht'], ['influencers', 'Influencer'], ['companies', 'Firmen'], ['campaigns', 'Kampagnen'],
  ['roadmap', 'Roadmap'], ['updates', 'Updates'],
];

export function AppHubPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';
  const go = (t) => setParams({ tab: t === 'overview' ? null : t, q: null, status: null, page: null });
  return (
    <div className="page">
      <PageHeader title="App" subtitle="Marktplatz-App: kleine Influencer finden Kooperationen, Firmen verteilen ihr Budget auf viele passende Creator. Eigene Daten, getrennt vom CRM." />
      <Tabs value={tab} onChange={go} tabs={TABS.map(([key, label]) => ({ key, label }))} />
      <div className="tab-panel">
        {tab === 'overview' && <Overview go={go} />}
        {tab === 'influencers' && <EntityTab config={INFLUENCERS} />}
        {tab === 'companies' && <EntityTab config={COMPANIES} />}
        {tab === 'campaigns' && <EntityTab config={CAMPAIGNS} />}
        {tab === 'roadmap' && <RoadmapTab />}
        {tab === 'updates' && <UpdatesTab />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Übersicht
// ---------------------------------------------------------------------------
function Overview({ go }) {
  const { data, error, reload } = useApi('/app/overview');
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const k = data.kpi;
  const progress = k.roadmap_total ? Math.round((k.roadmap_done / k.roadmap_total) * 100) : 0;
  const count = (list, status) => list.find((x) => x.status === status)?.n || 0;
  const allocatedPct = Number(k.budget_total) ? Math.round((Number(k.budget_allocated) / Number(k.budget_total)) * 100) : 0;

  return (
    <div className="stack-lg">
      <div className="stat-row">
        <Stat icon="users" label="Influencer" value={fmtNumber(k.influencers)} hint={`${k.influencers_new} neu (30 Tage) · ${k.micro_influencers} unter 50 Tsd.`} />
        <Stat icon="briefcase" label="Firmen" value={fmtNumber(k.companies)} hint={`${k.companies_customers} Pilot- / zahlende Kunden`} />
        <Stat icon="sparkle" label="Laufende Kampagnen" value={k.campaigns_running} hint={`Ø ${String(k.avg_influencers_per_campaign).replace('.', ',')} Influencer pro Kampagne`} />
        <Stat icon="trending" label="Entwicklungsstand" value={`${progress} %`} hint={`${k.roadmap_done} von ${k.roadmap_total} Roadmap-Punkten fertig`} tone={progress >= 100 && k.roadmap_total ? 'green' : undefined} />
      </div>

      <div className="grid-3">
        <Card title="Influencer-Funnel" actions={<button className="link" onClick={() => go('influencers')}>Alle</button>}>
          <Funnel items={APP_INFLUENCER_STATUSES.map((s) => [s, count(data.influencers_by_status, s)])} total={k.influencers} />
        </Card>
        <Card title="Firmen-Pipeline" actions={<button className="link" onClick={() => go('companies')}>Alle</button>}>
          <Funnel items={APP_COMPANY_STATUSES.map((s) => [s, count(data.companies_by_status, s)])} total={k.companies} />
        </Card>
        <Card title="Budget-Verteilung" subtitle="Das Kernprinzip: ein Budget, viele kleine Creator">
          <div className="budget-split">
            <div className="budget-big">{fmtMoney(k.budget_allocated)}</div>
            <div className="muted small">von {fmtMoney(k.budget_total)} Kampagnenbudget verteilt ({allocatedPct} %)</div>
            <div className="cat-bar"><span style={{ width: `${Math.min(100, allocatedPct)}%`, background: 'var(--accent)' }} /></div>
            <dl className="facts facts-compact">
              <dt>Ø Honorar pro Influencer</dt><dd>{fmtMoney(k.avg_fee)}</dd>
              <dt>Ø Follower</dt><dd>{fmtCompact(k.avg_followers)}</dd>
              <dt>Kampagnen gesamt</dt><dd>{k.campaigns}</dd>
            </dl>
          </div>
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Als Nächstes in der Entwicklung" subtitle={`${k.roadmap_in_progress} in Arbeit${k.roadmap_overdue ? ` · ${k.roadmap_overdue} überfällig` : ''}`}
          actions={<button className="link" onClick={() => go('roadmap')}>Roadmap</button>} padded={false}>
          <div className="progress-wrap">
            <div className="progress"><span style={{ width: `${progress}%` }} /></div>
            <div className="progress-legend">
              {APP_ROADMAP_STATUSES.map((s) => <span key={s}><S value={s} dot={false} /> {count(data.roadmap_by_status, s)}</span>)}
            </div>
          </div>
          {!data.next_items.length ? <Empty icon="check" title="Keine offenen Punkte" text="Lege in der Roadmap die nächsten Schritte an." /> : (
            <ul className="list">
              {data.next_items.map((r) => (
                <li key={r.id} className="list-row static">
                  <span className={`due-pill ${r.overdue ? 'overdue' : ''}`}>{r.target_date ? fmtDue(r.target_date) : 'ohne Datum'}</span>
                  <div className="list-main">
                    <div className="list-title">{r.title}</div>
                    <div className="list-sub">{[r.area, r.assignee_name].filter(Boolean).join(' · ') || '–'}</div>
                  </div>
                  <S value={r.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Letzte Updates" actions={<button className="link" onClick={() => go('updates')}>Alle Updates</button>} padded={false}>
          {!data.updates.length ? <Empty icon="note" title="Noch keine Updates" text="Halte Releases, Meilensteine und Entscheidungen fest." /> : (
            <ul className="list">
              {data.updates.map((u) => (
                <li key={u.id} className="list-row static">
                  <div className="list-main">
                    <div className="list-title">{u.version ? `${u.version} · ` : ''}{u.title}</div>
                    <div className="list-sub">{fmtDate(u.published_at)} · {u.author_name || '–'}</div>
                  </div>
                  <S value={u.type} dot={false} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {data.top_niches.length > 0 && (
        <Card title="Stärkste Nischen im Influencer-Pool">
          <div className="niche-chips">
            {data.top_niches.map((n) => <span key={n.niche} className="niche-chip">{n.niche} <strong>{n.n}</strong></span>)}
          </div>
        </Card>
      )}
    </div>
  );
}

function Funnel({ items, total }) {
  return (
    <ul className="cat-list">
      {items.map(([label, n]) => (
        <li key={label}>
          <div className="cat-head"><span>{label}</span><strong>{n}</strong></div>
          <div className="cat-bar"><span style={{ width: `${total ? (n / total) * 100 : 0}%`, background: 'var(--accent)' }} /></div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Konfiguration der Listen
// ---------------------------------------------------------------------------
const INFLUENCERS = {
  path: '/app/influencers', label: 'Influencer', addLabel: 'Influencer hinzufügen', icon: 'users',
  statuses: APP_INFLUENCER_STATUSES, searchPlaceholder: 'Name, @username, Nische, Ort…',
  columns: [
    { label: 'Influencer', render: (r) => <><div className="strong">{r.name}</div>{r.handle && <div className="cell-sub muted">@{r.handle}</div>}</> },
    { label: 'Plattform', render: (r) => r.platform || <span className="muted">–</span> },
    { label: 'Follower', num: true, render: (r) => fmtCompact(r.followers) },
    { label: 'Nische', render: (r) => r.niche || <span className="muted">–</span> },
    { label: 'Ort', render: (r) => r.city || <span className="muted">–</span> },
    { label: 'Status', render: (r) => <S value={r.status} /> },
    { label: 'Kampagnen', num: true, render: (r) => r.campaign_count },
    { label: 'Verdient', num: true, render: (r) => fmtMoney(r.earned) },
  ],
  fields: [
    { key: 'name', label: 'Name', required: true },
    { key: 'handle', label: 'Username', placeholder: '@username' },
    { key: 'platform', label: 'Plattform', type: 'select', options: APP_PLATFORMS },
    { key: 'followers', label: 'Follower', type: 'number' },
    { key: 'niche', label: 'Nische', placeholder: 'z. B. Fashion' },
    { key: 'city', label: 'Ort' },
    { key: 'email', label: 'E-Mail', type: 'email' },
    { key: 'status', label: 'Status', type: 'select', options: APP_INFLUENCER_STATUSES, def: 'Interessent', noEmpty: true },
    { key: 'source', label: 'Quelle', placeholder: 'z. B. Instagram-Ad, Empfehlung' },
    { key: 'joined_at', label: 'Registriert am', type: 'date' },
    { key: 'notes', label: 'Notizen', type: 'textarea', span: 2 },
  ],
};

const COMPANIES = {
  path: '/app/companies', label: 'Firma', addLabel: 'Firma hinzufügen', icon: 'briefcase',
  statuses: APP_COMPANY_STATUSES, searchPlaceholder: 'Firma, Branche, Ansprechpartner…',
  columns: [
    { label: 'Firma', render: (r) => <><div className="strong">{r.name}</div>{r.website && <div className="cell-sub"><a className="link" href={r.website} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{r.website.replace(/^https?:\/\//, '')}</a></div>}</> },
    { label: 'Branche', render: (r) => r.industry || <span className="muted">–</span> },
    { label: 'Ansprechpartner', render: (r) => <>{r.contact_name || <span className="muted">–</span>}{r.contact_email && <div className="cell-sub muted">{r.contact_email}</div>}</> },
    { label: 'Status', render: (r) => <S value={r.status} /> },
    { label: 'Budget / Monat', num: true, render: (r) => (r.monthly_budget !== null ? fmtMoney(r.monthly_budget) : <span className="muted">–</span>) },
    { label: 'Kampagnen', num: true, render: (r) => r.campaign_count },
  ],
  fields: [
    { key: 'name', label: 'Firmenname', required: true },
    { key: 'industry', label: 'Branche', placeholder: 'z. B. Kosmetik' },
    { key: 'website', label: 'Website', type: 'url', placeholder: 'https://…' },
    { key: 'status', label: 'Status', type: 'select', options: APP_COMPANY_STATUSES, def: 'Lead', noEmpty: true },
    { key: 'contact_name', label: 'Ansprechpartner' },
    { key: 'contact_email', label: 'E-Mail', type: 'email' },
    { key: 'monthly_budget', label: 'Marketing-Budget pro Monat (€)', type: 'number', step: '0.01' },
    { key: 'notes', label: 'Notizen', type: 'textarea', span: 2 },
  ],
};

const CAMPAIGNS = {
  path: '/app/campaigns', label: 'Kampagne', addLabel: 'Kampagne anlegen', icon: 'sparkle', size: 'lg',
  statuses: APP_CAMPAIGN_STATUSES, searchPlaceholder: 'Kampagne, Firma, Nische…',
  columns: [
    { label: 'Kampagne', render: (r) => <><div className="strong">{r.name}</div><div className="cell-sub muted">{r.company_name || 'ohne Firma'}</div></> },
    { label: 'Zielgruppe', render: (r) => [r.target_niche, r.target_platform, r.max_followers ? `≤ ${fmtCompact(r.max_followers)}` : null].filter(Boolean).join(' · ') || <span className="muted">–</span> },
    { label: 'Zeitraum', render: (r) => (r.start_date || r.end_date ? `${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}` : <span className="muted">–</span>) },
    { label: 'Status', render: (r) => <S value={r.status} /> },
    { label: 'Influencer', num: true, render: (r) => `${r.influencer_count}${r.target_influencers ? ` / ${r.target_influencers}` : ''}` },
    { label: 'Budget verteilt', num: true, render: (r) => <><div>{fmtMoney(r.allocated)}</div><div className="cell-sub muted">von {fmtMoney(r.budget)}</div></> },
  ],
  fields: [
    { key: 'name', label: 'Kampagnenname', required: true },
    { key: 'company_id', label: 'Firma', type: 'company' },
    { key: 'status', label: 'Status', type: 'select', options: APP_CAMPAIGN_STATUSES, def: 'Entwurf', noEmpty: true },
    { key: 'budget', label: 'Gesamtbudget (€)', type: 'number', step: '0.01' },
    { key: 'target_influencers', label: 'Geplante Anzahl Influencer', type: 'number' },
    { key: 'target_niche', label: 'Ziel-Nische', placeholder: 'z. B. Beauty' },
    { key: 'target_platform', label: 'Plattform', type: 'select', options: APP_PLATFORMS },
    { key: 'max_followers', label: 'Max. Follower pro Influencer', type: 'number', placeholder: 'z. B. 50000' },
    { key: 'start_date', label: 'Start', type: 'date' },
    { key: 'end_date', label: 'Ende', type: 'date' },
    { key: 'goal', label: 'Ziel der Kampagne', type: 'textarea', span: 2 },
    { key: 'notes', label: 'Notizen', type: 'textarea', span: 2 },
  ],
  extra: (item) => <CampaignAssignments campaign={item} />,
};

// ---------------------------------------------------------------------------
// Generische Liste + Formular
// ---------------------------------------------------------------------------
function EntityTab({ config }) {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') || '');
  const debounced = useDebounced(search);
  const [modal, setModal] = useState(null);
  useEffect(() => {
    if ((params.get('q') || '') !== debounced) setParams({ q: debounced, page: null });
  }, [debounced]); // eslint-disable-line
  const { data, error, loading, reload } = useApi(config.path + qs({ q: params.get('q'), status: params.get('status'), page: params.get('page') }));

  return (
    <div className="stack-lg">
      <div className="filters card">
        <div className="filter-row">
          <div className="search-input">
            <Icon name="search" size={16} />
            <input className="input" placeholder={config.searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={params.get('status')} onChange={(e) => setParams({ status: e.target.value, page: null })} placeholder="Alle Status" options={config.statuses} />
          <Button variant="primary" icon="plus" onClick={() => setModal({ item: null })}>{config.addLabel}</Button>
        </div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {!data ? <Spinner /> : !data.items.length ? (
        <div className="card"><Empty icon={config.icon} title={`Noch keine Einträge`} action={<Button variant="primary" icon="plus" onClick={() => setModal({ item: null })}>{config.addLabel}</Button>} /></div>
      ) : (
        <div className={`card table-card ${loading ? 'is-loading' : ''}`}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr>{config.columns.map((c) => <th key={c.label} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr></thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id} className="row-link" onClick={() => setModal({ item: r })}>
                    {config.columns.map((c) => <td key={c.label} className={c.num ? 'num nowrap' : ''}>{c.render(r)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pages={data.pages} total={data.total} label="Einträge" onPage={(p) => setParams({ page: p > 1 ? p : null })} />
        </div>
      )}
      <EntityModal config={config} open={!!modal} item={modal?.item} onClose={() => setModal(null)} />
    </div>
  );
}

function initialValues(fields, item) {
  const v = {};
  for (const f of fields) {
    const raw = item ? item[f.key] : undefined;
    if (f.type === 'company' || f.type === 'user') v[f.key] = raw ? String(raw) : f.defFn ? f.defFn() : '';
    else v[f.key] = raw ?? (typeof f.def === 'function' ? f.def() : f.def ?? '');
  }
  return v;
}

function EntityModal({ config, open, item, onClose }) {
  const { toast, confirm } = useUi();
  const [saving, setSaving] = useState(false);
  const f = useForm({});
  const { user } = useAuth();
  const fields = config.fields.map((fd) => (fd.type === 'user' && fd.defaultMe ? { ...fd, defFn: () => String(user.id) } : fd));
  useEffect(() => {
    if (!open) return;
    f.setErrors({});
    f.setValues(initialValues(fields, item));
  }, [open, item?.id]); // eslint-disable-line

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (item) await api.patch(`${config.path}/${item.id}`, f.values);
      else await api.post(config.path, f.values);
      invalidateAll();
      toast(item ? `${config.label} gespeichert.` : `${config.label} angelegt.`);
      onClose();
    } catch (err) {
      handleFormError(err, f.setErrors, toast);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    const ok = await confirm({ title: `${config.label} löschen?`, message: 'Der Eintrag wird dauerhaft gelöscht.', warning: 'Dieser Vorgang kann nicht rückgängig gemacht werden.', confirmLabel: 'Löschen', danger: true });
    if (!ok) return;
    try {
      await api.del(`${config.path}/${item.id}`);
      invalidateAll();
      toast(`${config.label} gelöscht.`);
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size={config.size || 'md'}
      title={item ? `${config.label} bearbeiten` : config.addLabel}
      footer={
        <>
          {item && <Button variant="ghost-danger" icon="trash" onClick={remove} className="mr-auto">Löschen</Button>}
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" type="submit" form="entity-form" loading={saving}>Speichern</Button>
        </>
      }
    >
      <form id="entity-form" className="form-grid" onSubmit={submit}>
        {fields.map((fd, i) => (
          <Field key={fd.key} label={fd.label} required={fd.required} error={f.errors[fd.key]} className={fd.span === 2 ? 'span-2' : ''}>
            <FieldInput fd={fd} value={f.values[fd.key]} onChange={f.set(fd.key)} autoFocus={i === 0 && !item} />
          </Field>
        ))}
      </form>
      {item && config.extra && config.extra(item)}
    </Modal>
  );
}

function FieldInput({ fd, value, onChange, autoFocus }) {
  const { activeUsers } = useLookups();
  const companies = useApi(fd.type === 'company' ? '/app/companies?page_size=500' : null);
  if (fd.type === 'select') return <Select value={value} onChange={onChange} options={fd.options} placeholder={fd.noEmpty ? undefined : '–'} />;
  if (fd.type === 'textarea') return <textarea className="input" rows={3} value={value || ''} onChange={onChange} placeholder={fd.placeholder} />;
  if (fd.type === 'company') {
    return <Select value={value} onChange={onChange} placeholder="– keine –" options={(companies.data?.items || []).map((c) => ({ value: String(c.id), label: c.name }))} />;
  }
  if (fd.type === 'user') {
    return <Select value={value} onChange={onChange} placeholder="– niemand –" options={activeUsers.map((u) => ({ value: String(u.id), label: u.name }))} />;
  }
  return (
    <input
      className="input"
      type={fd.type || 'text'}
      min={fd.type === 'number' ? 0 : undefined}
      step={fd.step || (fd.type === 'number' ? '1' : undefined)}
      value={value ?? ''}
      onChange={onChange}
      placeholder={fd.placeholder}
      required={fd.required}
      autoFocus={autoFocus}
    />
  );
}

// ---------------------------------------------------------------------------
// Kampagne: Budget-Aufteilung auf mehrere Influencer + Matching-Vorschläge
// ---------------------------------------------------------------------------
function CampaignAssignments({ campaign }) {
  const { toast } = useUi();
  const { data } = useApi(`/app/campaigns/${campaign.id}/influencers`);
  const sugg = useApi(`/app/campaigns/${campaign.id}/suggestions`);
  const pool = useApi('/app/influencers?page_size=500');
  const [pick, setPick] = useState('');
  const items = data?.items || [];
  const active = items.filter((a) => a.status !== 'Abgesagt');
  const allocated = active.reduce((s, a) => s + Number(a.fee), 0);
  const budget = Number(campaign.budget) || 0;
  const rest = budget - allocated;
  const slots = Math.max(1, (campaign.target_influencers || 0) - active.length);
  const suggestedFee = campaign.target_influencers && rest > 0 ? Math.floor(rest / slots) : 0;

  const add = async (influencerId) => {
    try {
      await api.post(`/app/campaigns/${campaign.id}/influencers`, { influencer_id: influencerId, fee: suggestedFee, status: 'Vorgeschlagen' });
      invalidateAll();
      setPick('');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const update = async (a, patch) => {
    try {
      await api.patch(`/app/assignments/${a.id}`, patch);
      invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const remove = async (a) => {
    await api.del(`/app/assignments/${a.id}`).catch((e) => toast(e.message, 'error'));
    invalidateAll();
  };
  const assignedIds = new Set(items.map((a) => a.influencer_id));

  return (
    <div className="assign">
      <div className="assign-head">
        <h4>Influencer & Budget-Aufteilung</h4>
        <div className="assign-budget">
          <span><strong>{fmtMoney(allocated)}</strong> von {fmtMoney(budget)} verteilt</span>
          <span className={rest < 0 ? 'tone-red' : 'muted'}>{rest < 0 ? `${fmtMoney(-rest)} über Budget` : `${fmtMoney(rest)} frei`}</span>
        </div>
      </div>
      <div className="cat-bar"><span style={{ width: `${budget ? Math.min(100, (allocated / budget) * 100) : 0}%`, background: rest < 0 ? 'var(--red)' : 'var(--accent)' }} /></div>

      {!items.length ? <p className="muted small">Noch keine Influencer zugeordnet.</p> : (
        <div className="table-wrap">
          <table className="table table-compact">
            <thead><tr><th>Influencer</th><th className="num">Follower</th><th>Honorar (€)</th><th>Status</th><th /></tr></thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td><div className="strong">{a.name}</div><div className="cell-sub muted">{[a.handle && '@' + a.handle, a.platform, a.niche].filter(Boolean).join(' · ')}</div></td>
                  <td className="num">{fmtCompact(a.followers)}</td>
                  <td><FeeInput value={a.fee} onSave={(fee) => update(a, { fee })} /></td>
                  <td>
                    <select className="input input-sm" value={a.status} onChange={(e) => update(a, { status: e.target.value })}>
                      {APP_ASSIGNMENT_STATUSES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td><IconButton icon="x" label="Entfernen" onClick={() => remove(a)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="assign-add">
        <Select value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Influencer aus dem Pool hinzufügen…"
          options={(pool.data?.items || []).filter((i) => !assignedIds.has(i.id)).map((i) => ({ value: String(i.id), label: `${i.name}${i.niche ? ' · ' + i.niche : ''}${i.followers ? ' · ' + fmtCompact(i.followers) : ''}` }))} />
        <Button icon="plus" disabled={!pick} onClick={() => add(Number(pick))}>Hinzufügen</Button>
      </div>
      {suggestedFee > 0 && <p className="muted small">Neue Zuordnungen bekommen automatisch {fmtMoney(suggestedFee)} (freies Budget ÷ offene Plätze). Anpassbar.</p>}

      <div className="suggest">
        <div className="suggest-head"><Icon name="sparkle" size={15} /> Matching-Vorschläge <span className="muted small">(regelbasiert: Nische, Plattform, Status, Follower-Grenze – Platzhalter für das spätere KI-Matching)</span></div>
        {!sugg.data ? <Spinner /> : !sugg.data.items.length ? <p className="muted small">Keine passenden Influencer im Pool. Lege Influencer an oder passe die Zielgruppe an.</p> : (
          <ul className="suggest-list">
            {sugg.data.items.map((i) => (
              <li key={i.id}>
                <span className="score" title="Passgenauigkeit">{i.score}</span>
                <div className="list-main">
                  <div className="strong">{i.name}</div>
                  <div className="cell-sub muted">{[i.platform, i.niche, i.followers ? fmtCompact(i.followers) + ' Follower' : null, i.status].filter(Boolean).join(' · ')}</div>
                </div>
                <Button size="sm" icon="plus" onClick={() => add(i.id)}>Zuordnen</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FeeInput({ value, onSave }) {
  const [v, setV] = useState(String(value ?? ''));
  useEffect(() => setV(String(value ?? '')), [value]);
  const commit = () => {
    const n = Number(String(v).replace(',', '.'));
    if (Number.isFinite(n) && n >= 0 && n !== Number(value)) onSave(n);
  };
  return <input className="input input-sm fee-input" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />;
}

// ---------------------------------------------------------------------------
// Roadmap (Board)
// ---------------------------------------------------------------------------
const ROADMAP = {
  path: '/app/roadmap', label: 'Roadmap-Punkt', addLabel: 'Roadmap-Punkt anlegen',
  fields: [
    { key: 'title', label: 'Titel', required: true, span: 2, placeholder: 'z. B. Registrierung für Influencer' },
    { key: 'area', label: 'Bereich', type: 'select', options: APP_ROADMAP_AREAS },
    { key: 'status', label: 'Status', type: 'select', options: APP_ROADMAP_STATUSES, def: 'Idee', noEmpty: true },
    { key: 'priority', label: 'Priorität', type: 'select', options: TASK_PRIORITIES, def: 'Normal', noEmpty: true },
    { key: 'target_date', label: 'Zieldatum', type: 'date' },
    { key: 'assignee_id', label: 'Verantwortlich', type: 'user', defaultMe: true },
    { key: 'description', label: 'Beschreibung', type: 'textarea', span: 2 },
  ],
};

function RoadmapTab() {
  const [area, setArea] = useState('');
  const [modal, setModal] = useState(null);
  const { toast } = useUi();
  const { data, error, reload } = useApi('/app/roadmap' + qs({ area, page_size: 500 }));
  const move = async (r, status) => {
    try {
      await api.patch(`/app/roadmap/${r.id}`, { status });
      invalidateAll();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <div className="stack-lg">
      <div className="filters card">
        <div className="filter-row">
          <Select value={area} onChange={(e) => setArea(e.target.value)} placeholder="Alle Bereiche" options={APP_ROADMAP_AREAS} />
          <span className="grow" />
          <Button variant="primary" icon="plus" onClick={() => setModal({ item: null })}>Roadmap-Punkt anlegen</Button>
        </div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {!data ? <Spinner /> : (
        <div className="board">
          {APP_ROADMAP_STATUSES.map((status, idx) => {
            const col = data.items.filter((r) => r.status === status);
            return (
              <div key={status} className="board-col">
                <div className="board-col-head"><S value={status} dot={false} /> <span className="muted small">{col.length}</span></div>
                {col.map((r) => (
                  <div key={r.id} className="board-card" onClick={() => setModal({ item: r })}>
                    <div className="board-card-title">{r.title}</div>
                    <div className="board-card-meta">
                      {r.area && <span>{r.area}</span>}
                      {r.priority !== 'Normal' && <S value={r.priority} dot={false} />}
                    </div>
                    <div className="board-card-foot">
                      <span className={r.overdue ? 'tone-red' : 'muted'}>{r.target_date ? fmtDate(r.target_date) : ''}</span>
                      <span className="muted">{r.assignee_name || ''}</span>
                    </div>
                    <div className="board-move" onClick={(e) => e.stopPropagation()}>
                      {idx > 0 && <IconButton icon="chevronLeft" label={`Nach „${APP_ROADMAP_STATUSES[idx - 1]}“`} onClick={() => move(r, APP_ROADMAP_STATUSES[idx - 1])} />}
                      {idx < APP_ROADMAP_STATUSES.length - 1 && <IconButton icon="chevronRight" label={`Nach „${APP_ROADMAP_STATUSES[idx + 1]}“`} onClick={() => move(r, APP_ROADMAP_STATUSES[idx + 1])} />}
                    </div>
                  </div>
                ))}
                {!col.length && <div className="board-empty">–</div>}
              </div>
            );
          })}
        </div>
      )}
      <EntityModal config={ROADMAP} open={!!modal} item={modal?.item} onClose={() => setModal(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Updates / Changelog
// ---------------------------------------------------------------------------
const UPDATES = {
  path: '/app/updates', label: 'Update', addLabel: 'Update schreiben',
  fields: [
    { key: 'title', label: 'Titel', required: true, span: 2, placeholder: 'z. B. Beta für die ersten 20 Influencer gestartet' },
    { key: 'type', label: 'Art', type: 'select', options: APP_UPDATE_TYPES, def: 'Notiz', noEmpty: true },
    { key: 'published_at', label: 'Datum', type: 'date', required: true, def: () => todayStr() },
    { key: 'version', label: 'Version (optional)', placeholder: 'z. B. v0.3' },
    { key: 'body', label: 'Beschreibung', type: 'textarea', span: 2 },
  ],
};

function UpdatesTab() {
  const [type, setType] = useState('');
  const [modal, setModal] = useState(null);
  const { data, error, reload } = useApi('/app/updates' + qs({ type, page_size: 200 }));
  return (
    <div className="stack-lg">
      <div className="filters card">
        <div className="filter-row">
          <Select value={type} onChange={(e) => setType(e.target.value)} placeholder="Alle Arten" options={APP_UPDATE_TYPES} />
          <span className="grow" />
          <Button variant="primary" icon="plus" onClick={() => setModal({ item: null })}>Update schreiben</Button>
        </div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <Card padded>
        {!data ? <Spinner /> : !data.items.length ? <Empty icon="note" title="Noch keine Updates" text="Dokumentiere hier Releases, Meilensteine, Entscheidungen und Learnings." /> : (
          <ol className="timeline">
            {data.items.map((u) => (
              <li key={u.id} className="timeline-item">
                <span className="timeline-dot"><Icon name={u.type === 'Meilenstein' ? 'sparkle' : u.type === 'Bugfix' ? 'alert' : u.type === 'Release' ? 'check' : 'note'} size={14} /></span>
                <div className="timeline-body">
                  <div className="timeline-head">
                    <strong>{fmtDate(u.published_at)}</strong>
                    <S value={u.type} dot={false} />
                    {u.version && <Badge tone="gray">{u.version}</Badge>}
                    <span className="muted small">{u.author_name || '–'} · {fmtRelative(u.created_at)}</span>
                    <span className="timeline-actions"><IconButton icon="edit" label="Bearbeiten" onClick={() => setModal({ item: u })} /></span>
                  </div>
                  <div className="timeline-subject">{u.title}</div>
                  {u.body && <p className="timeline-text">{u.body}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <EntityModal config={UPDATES} open={!!modal} item={modal?.item} onClose={() => setModal(null)} />
    </div>
  );
}
