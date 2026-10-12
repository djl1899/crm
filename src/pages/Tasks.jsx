import { useEffect, useState } from 'react';
import { api, qs } from '../lib/api.js';
import { useApi, useDebounced } from '../lib/useApi.js';
import { useSearchParams } from '../lib/router.jsx';
import { useLookups, useAuth } from '../lib/auth.jsx';
import { PageHeader, Button, Select, Pagination, Spinner, ErrorBox, Empty, Segmented, useUi, Card } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { TaskModal, CreatorPicker } from '../components/forms.jsx';
import { TaskList } from './CreatorProfile.jsx';
import { TASK_PRIORITIES } from '../../shared/constants.js';

// Alte Links (?view=…) aus Dashboard & Co. weiter unterstützen
const LEGACY_VIEWS = { open: { status: 'open' }, today: { due: 'today' }, week: { due: 'week' }, overdue: { due: 'overdue' }, mine: { assignee_id: 'me' } };
const STATUS_FILTER = [
  { value: '', label: 'Alle' },
  { value: 'Offen', label: 'Offen' },
  { value: 'In Bearbeitung', label: 'In Bearbeitung' },
  { value: 'Erledigt', label: 'Erledigt' },
];
const DUE_OPTIONS = [
  { value: 'today', label: 'Heute fällig' },
  { value: 'week', label: 'Diese Woche fällig' },
  { value: 'overdue', label: 'Überfällig' },
  { value: 'upcoming', label: 'Später fällig' },
  { value: 'none', label: 'Ohne Fälligkeit' },
];

export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const { users } = useLookups();
  const { toast } = useUi();
  const [search, setSearch] = useState(params.get('q') || '');
  const debounced = useDebounced(search);
  const [modal, setModal] = useState(null);
  // Alte Ansicht-Links einmalig in die neuen Filter übersetzen
  useEffect(() => {
    const legacy = LEGACY_VIEWS[params.get('view')];
    if (legacy) setParams({ view: null, ...legacy });
  }, []); // eslint-disable-line

  useEffect(() => {
    if ((params.get('q') || '') !== debounced) setParams({ q: debounced, page: null });
  }, [debounced]); // eslint-disable-line

  const openId = params.get('open');
  useEffect(() => {
    if (!openId) return;
    api.get(`/tasks/${openId}`)
      .then((r) => setModal({ item: r.task }))
      .catch((e) => toast(e.message, 'error'));
  }, [openId]); // eslint-disable-line

  const query = {};
  for (const k of ['q', 'status', 'due', 'assignee_id', 'priority', 'creator_id', 'page']) if (params.get(k)) query[k] = params.get(k);
  const { data, error, loading, reload } = useApi('/tasks' + qs({ ...query, page_size: 50 }));
  const counts = data?.status_counts;
  const statusValue = params.get('status') === 'open' ? 'open' : params.get('status') || '';
  const setFilter = (key) => (e) => setParams({ [key]: e?.target ? e.target.value : e, page: null });
  const close = () => {
    setModal(null);
    if (openId) setParams({ open: null });
  };

  return (
    <div className="page">
      <PageHeader
        title="Aufgaben"
        actions={<Button variant="primary" icon="plus" onClick={() => setModal({ item: null })}>Neue Aufgabe</Button>}
      />
      <div className="filters card">
        <div className="filter-row">
          <Segmented
            value={statusValue}
            onChange={(v) => setParams({ status: v || null, page: null })}
            options={[
              ...STATUS_FILTER.map((o) => ({ ...o, count: counts ? counts[o.value || 'Alle'] : undefined })),
              ...(statusValue === 'open' ? [{ value: 'open', label: 'Offen + In Bearbeitung' }] : []),
            ]}
          />
        </div>
        <div className="filter-row">
          <div className="search-input">
            <Icon name="search" size={16} />
            <input className="input" placeholder="Aufgabe oder Creator suchen…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={params.get('due')} onChange={setFilter('due')} placeholder="Jede Fälligkeit" options={DUE_OPTIONS} />
          <Select value={params.get('assignee_id')} onChange={setFilter('assignee_id')} placeholder="Alle Verantwortlichen"
            options={[{ value: 'me', label: 'Meine Aufgaben' }, { value: 'none', label: '– nicht zugewiesen –' }, ...users.map((u) => ({ value: String(u.id), label: u.name }))]} />
          <Select value={params.get('priority')} onChange={setFilter('priority')} placeholder="Alle Prioritäten" options={TASK_PRIORITIES} />
          <div className="filter-creator">
            <CreatorPicker key={params.get('creator_id') || 'none'} value={params.get('creator_id')} initialLabel={params.get('creator_name') || ''}
              onChange={(id, label) => setParams({ creator_id: id, creator_name: id ? label : null, page: null })} />
          </div>
          {params.get('creator_id') && <Button variant="ghost" onClick={() => setParams({ creator_id: null, creator_name: null })}>Creator-Filter entfernen</Button>}
        </div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {!data && loading ? <Spinner /> : data && !data.items.length ? (
        <div className="card"><Empty icon="check" title="Keine Aufgaben in dieser Ansicht" text={params.get('status') ? `Keine Aufgaben mit Status „${params.get('status') === 'open' ? 'offen' : params.get('status')}“ – Filter oben anpassen.` : 'Lege mit „Neue Aufgabe“ die erste an.'} /></div>
      ) : data ? (
        <Card padded={false} className={loading ? 'is-loading' : ''}>
          <TaskList items={data.items} showCreator onOpen={(t) => setModal({ item: t })} />
          <Pagination page={data.page} pages={data.pages} total={data.total} label="Aufgaben" onPage={(p) => setParams({ page: p > 1 ? p : null })} />
        </Card>
      ) : null}
      <TaskModal open={!!modal} onClose={close} task={modal?.item} />
    </div>
  );
}
