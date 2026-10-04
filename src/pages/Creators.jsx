import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApi, useDebounced, invalidateAll } from '../lib/useApi.js';
import { useSearchParams, useNavigate, Link } from '../lib/router.jsx';
import { useLookups } from '../lib/auth.jsx';
import { qs } from '../lib/api.js';
import { PageHeader, Button, Select, Avatar, StatusBadge, TagChip, Pagination, Spinner, ErrorBox, Empty, Badge, Modal, useUi } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { ImportModal } from '../components/ImportModal.jsx';
import { fmtCompact, fmtNumber, fmtRelative, fmtDateTime } from '../lib/format.js';
import { CREATOR_STATUSES, OUTREACH_STATUSES, CONTRACT_STATUSES } from '../../shared/constants.js';

const FILTER_KEYS = [
  'q', 'status', 'archived', 'outreach_status', 'platform', 'followers_platform', 'min_followers', 'max_followers',
  'region', 'country', 'niche', 'manager_id', 'contacted', 'active_collab', 'has_contract', 'contract_status', 'tags',
];
const ADVANCED = ['platform', 'followers_platform', 'min_followers', 'max_followers', 'region', 'country', 'niche', 'active_collab', 'has_contract', 'contract_status', 'tags', 'outreach_status', 'archived'];

const SORTS = [
  { value: 'last_activity', label: 'Letzte Aktivität' },
  { value: 'name', label: 'Name' },
  { value: 'followers', label: 'Follower (max.)' },
  { value: 'instagram_followers', label: 'Instagram-Follower' },
  { value: 'tiktok_followers', label: 'TikTok-Follower' },
  { value: 'status', label: 'Status' },
  { value: 'created', label: 'Erstellungsdatum' },
];

export function CreatorsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { users, tags } = useLookups();
  const [search, setSearch] = useState(params.get('q') || '');
  const debounced = useDebounced(search, 300);
  const [showAdvanced, setShowAdvanced] = useState(() => ADVANCED.some((k) => params.get(k)));
  const options = useApi('/creators/filter-options');
  const [noteCreator, setNoteCreator] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if ((params.get('q') || '') !== debounced) setParams({ q: debounced, page: null });
  }, [debounced]); // eslint-disable-line

  const query = {};
  for (const k of [...FILTER_KEYS, 'sort', 'dir', 'page']) if (params.get(k)) query[k] = params.get(k);
  const { data, error, loading, reload } = useApi('/creators' + qs({ ...query, page_size: 25 }));

  const setFilter = (k) => (e) => setParams({ [k]: e && e.target ? e.target.value : e, page: null });
  const activeCount = FILTER_KEYS.filter((k) => k !== 'q' && params.get(k)).length;
  const reset = () => {
    const clear = {};
    for (const k of [...FILTER_KEYS, 'page']) clear[k] = null;
    setSearch('');
    setParams(clear);
  };

  const sort = params.get('sort') || 'last_activity';
  const dir = params.get('dir') || (sort === 'name' ? 'asc' : 'desc');
  const toggleSort = (key) => {
    if (sort === key) setParams({ dir: dir === 'asc' ? 'desc' : 'asc' });
    else setParams({ sort: key, dir: key === 'name' ? 'asc' : 'desc' });
  };
  const SortTh = ({ k, children, className = '' }) => (
    <th className={`sortable ${className}`} onClick={() => toggleSort(k)} aria-sort={sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      {children}
      <Icon name={sort === k ? (dir === 'asc' ? 'chevronUp' : 'chevronDown') : 'sort'} size={13} className={sort === k ? '' : 'faint'} />
    </th>
  );

  const selectedTags = (params.get('tags') || '').split(',').filter(Boolean).map(Number);
  const opt = options.data || { regions: [], countries: [], niches: [] };

  return (
    <div className="page">
      <PageHeader
        title="Creator"
        subtitle={data ? `${fmtNumber(data.total)} ${data.total === 1 ? 'Creator' : 'Creator'} gefunden` : ' '}
        actions={<>
          <Button icon="upload" onClick={() => setImportOpen(true)}>Importieren</Button>
          <Button variant="primary" icon="plus" onClick={() => navigate('/creators/new')}>Creator hinzufügen</Button>
        </>}
      />

      <div className="filters card">
        <div className="filter-row">
          <div className="search-input">
            <Icon name="search" size={16} />
            <input
              className="input"
              placeholder="Name, @username, E-Mail, Ort, Region, Nische…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Creator suchen"
            />
          </div>
          <Select value={params.get('status')} onChange={setFilter('status')} placeholder="Alle Status" options={CREATOR_STATUSES} aria-label="Status" />
          <Select value={params.get('contacted')} onChange={setFilter('contacted')} placeholder="Angeschrieben: alle"
            options={[{ value: 'no', label: 'Nicht angeschrieben' }, { value: 'yes', label: 'Angeschrieben' }]} aria-label="Angeschrieben" />
          <Select value={params.get('manager_id')} onChange={setFilter('manager_id')} placeholder="Alle Manager"
            options={[{ value: 'none', label: '– ohne Manager –' }, ...users.map((u) => ({ value: String(u.id), label: u.name }))]} aria-label="Manager" />
          <Button icon="filter" variant={showAdvanced ? 'soft' : 'secondary'} onClick={() => setShowAdvanced((s) => !s)}>
            Filter{activeCount ? ` (${activeCount})` : ''}
          </Button>
          {(activeCount > 0 || search) && <Button variant="ghost" onClick={reset}>Zurücksetzen</Button>}
        </div>

        {showAdvanced && (
          <div className="filter-advanced">
            <label className="filter-item"><span>Plattform</span>
              <Select value={params.get('platform')} onChange={setFilter('platform')} placeholder="Alle"
                options={[{ value: 'instagram', label: 'Instagram' }, { value: 'tiktok', label: 'TikTok' }, { value: 'both', label: 'Instagram & TikTok' }]} />
            </label>
            <label className="filter-item"><span>Follower auf</span>
              <Select value={params.get('followers_platform')} onChange={setFilter('followers_platform')} placeholder="Beliebiger Plattform"
                options={[{ value: 'instagram', label: 'Instagram' }, { value: 'tiktok', label: 'TikTok' }]} />
            </label>
            <label className="filter-item"><span>Follower min.</span>
              <NumberFilter value={params.get('min_followers')} onCommit={setFilter('min_followers')} placeholder="z. B. 100000" />
            </label>
            <label className="filter-item"><span>Follower max.</span>
              <NumberFilter value={params.get('max_followers')} onCommit={setFilter('max_followers')} placeholder="beliebig" />
            </label>
            <label className="filter-item"><span>Land</span>
              <Select value={params.get('country')} onChange={setFilter('country')} placeholder="Alle" options={opt.countries} />
            </label>
            <label className="filter-item"><span>Region</span>
              <Select value={params.get('region')} onChange={setFilter('region')} placeholder="Alle" options={opt.regions} />
            </label>
            <label className="filter-item"><span>Nische</span>
              <Select value={params.get('niche')} onChange={setFilter('niche')} placeholder="Alle" options={opt.niches} />
            </label>
            <label className="filter-item"><span>Outreach-Status</span>
              <Select value={params.get('outreach_status')} onChange={setFilter('outreach_status')} placeholder="Alle" options={OUTREACH_STATUSES} />
            </label>
            <label className="filter-item"><span>Aktive Kooperation</span>
              <Select value={params.get('active_collab')} onChange={setFilter('active_collab')} placeholder="Egal"
                options={[{ value: 'yes', label: 'Ja' }, { value: 'no', label: 'Nein' }]} />
            </label>
            <label className="filter-item"><span>Vertrag vorhanden</span>
              <Select value={params.get('has_contract')} onChange={setFilter('has_contract')} placeholder="Egal"
                options={[{ value: 'yes', label: 'Ja' }, { value: 'no', label: 'Nein' }]} />
            </label>
            <label className="filter-item"><span>Vertragsstatus</span>
              <Select value={params.get('contract_status')} onChange={setFilter('contract_status')} placeholder="Alle" options={CONTRACT_STATUSES} />
            </label>
            <label className="filter-item"><span>Archiv</span>
              <Select value={params.get('archived')} onChange={setFilter('archived')} placeholder="Archivierte ausblenden"
                options={[{ value: 'include', label: 'Archivierte einbeziehen' }, { value: 'only', label: 'Nur archivierte' }]} />
            </label>
            {tags.length > 0 && (
              <div className="filter-item filter-tags">
                <span>Tags (alle ausgewählten)</span>
                <div className="tag-filter">
                  {tags.map((t) => {
                    const on = selectedTags.includes(t.id);
                    return (
                      <button key={t.id} type="button" className={`tag-toggle ${on ? 'on' : ''}`}
                        onClick={() => setParams({ tags: (on ? selectedTags.filter((x) => x !== t.id) : [...selectedTags, t.id]).join(','), page: null })}>
                        <TagChip tag={t} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <ErrorBox error={error} onRetry={reload} />
      {!data && loading ? (
        <Spinner />
      ) : data && !data.items.length ? (
        <div className="card">
          <Empty
            icon="users"
            title="Keine Creator gefunden"
            text={activeCount || search ? 'Passe Suche oder Filter an.' : 'Lege deinen ersten Creator an.'}
            action={activeCount || search ? <Button onClick={reset}>Filter zurücksetzen</Button> : <Button variant="primary" icon="plus" onClick={() => navigate('/creators/new')}>Creator hinzufügen</Button>}
          />
        </div>
      ) : data ? (
        <div className={`card table-card ${loading ? 'is-loading' : ''}`}>
          <div className="mobile-sort">
            <Select value={sort} onChange={(e) => setParams({ sort: e.target.value, dir: null })} options={SORTS} aria-label="Sortierung" />
          </div>
          <div className="table-wrap desktop-only">
            <table className="table">
              <thead>
                <tr>
                  <SortTh k="name">Creator</SortTh>
                  <SortTh k="instagram_followers">Instagram</SortTh>
                  <SortTh k="tiktok_followers">TikTok</SortTh>
                  <SortTh k="status">Status</SortTh>
                  <th>Outreach</th>
                  <th>Notizen</th>
                  <th>Nische</th>
                  <th>Region</th>
                  <th>Manager</th>
                  <SortTh k="last_activity" className="nowrap">Letzte Aktivität</SortTh>
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id} className="row-link" onClick={() => navigate(`/creators/${c.id}`)}>
                    <td>
                      <div className="creator-cell">
                        <Avatar name={c.display_name} url={c.avatar_url} size={36} />
                        <div>
                          <Link to={`/creators/${c.id}`} className="strong" onClick={(e) => e.stopPropagation()}>{c.display_name}</Link>
                          <div className="cell-sub">
                            {c.tags.slice(0, 3).map((t) => <TagChip key={t.id} tag={t} />)}
                            {c.tags.length > 3 && <span className="muted small">+{c.tags.length - 3}</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td><SocialCell username={c.instagram_username} followers={c.instagram_followers} /></td>
                    <td><SocialCell username={c.tiktok_username} followers={c.tiktok_followers} /></td>
                    <td><StatusBadge value={c.status} /></td>
                    <td>
                      <StatusBadge value={c.outreach_status} dot={false} />
                    </td>
                    <td className="notes-cell" onClick={(e) => { e.stopPropagation(); setNoteCreator(c); }} title={c.notes ? 'Klicken zum Bearbeiten' : 'Notiz hinzufügen'}>
                      {c.notes ? <div className="notes-preview">{c.notes}</div> : <span className="notes-add"><Icon name="plus" size={13} /> Notiz</span>}
                    </td>
                    <td className="clip">{c.niche || <span className="muted">–</span>}</td>
                    <td className="clip">{c.region || c.city || <span className="muted">–</span>}{c.country && c.country !== 'Deutschland' ? <div className="cell-sub muted">{c.country}</div> : null}</td>
                    <td className="clip">{c.manager_name || <span className="muted">–</span>}</td>
                    <td className="nowrap muted" title={fmtDateTime(c.last_activity_at)}>{fmtRelative(c.last_activity_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="creator-cards mobile-only">
            {data.items.map((c) => (
              <li key={c.id}>
                <Link to={`/creators/${c.id}`} className="creator-card">
                  <Avatar name={c.display_name} url={c.avatar_url} size={44} />
                  <div className="creator-card-main">
                    <div className="creator-card-top">
                      <strong>{c.display_name}</strong>
                      <StatusBadge value={c.status} />
                    </div>
                    <div className="cell-sub">
                      {c.instagram_username && <span><Icon name="instagram" size={13} /> {fmtCompact(c.instagram_followers)}</span>}
                      {c.tiktok_username && <span><Icon name="tiktok" size={13} /> {fmtCompact(c.tiktok_followers)}</span>}
                      {c.niche && <span>{c.niche}</span>}
                    </div>
                    <div className="cell-sub muted">
                      {[c.region || c.city, c.outreach_status, c.manager_name].filter(Boolean).join(' · ')}
                    </div>
                    {c.notes && <div className="notes-preview notes-preview-card">{c.notes}</div>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={data.page} pages={data.pages} total={data.total} label="Creator" onPage={(p) => setParams({ page: p > 1 ? p : null })} />
        </div>
      ) : null}
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <NotesModal creator={noteCreator} onClose={() => setNoteCreator(null)} />
    </div>
  );
}

function SocialCell({ username, followers }) {
  if (!username && followers === null) return <span className="muted">–</span>;
  return (
    <div>
      <div className="strong-num">{fmtCompact(followers)}</div>
      {username && <div className="cell-sub muted">@{username}</div>}
    </div>
  );
}

function NumberFilter({ value, onCommit, placeholder }) {
  const [v, setV] = useState(value || '');
  useEffect(() => setV(value || ''), [value]);
  const commit = () => {
    const clean = String(v).replace(/[.\s]/g, '');
    if (clean !== (value || '')) onCommit(clean);
  };
  return (
    <input
      className="input"
      inputMode="numeric"
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}


function NotesModal({ creator, onClose }) {
  const { toast } = useUi();
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (creator) setNotes(creator.notes || ''); }, [creator]);
  if (!creator) return null;
  const dirty = notes !== (creator.notes || '');
  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/creators/${creator.id}`, { notes });
      invalidateAll();
      toast('Notizen gespeichert.');
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      title={`Notizen – ${creator.display_name}`}
      onClose={onClose}
      footer={<>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button variant="primary" onClick={save} loading={saving} disabled={!dirty}>Speichern</Button>
      </>}
    >
      <textarea className="input notes-area" rows={10} autoFocus value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notizen zum Creator…" />
      <p className="muted small" style={{ marginTop: 8 }}>Nur für das Team sichtbar · dieselben Notizen wie im Creator-Profil</p>
    </Modal>
  );
}
