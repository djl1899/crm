import { useEffect, useState } from 'react';
import { api, qs } from '../lib/api.js';
import { useApi, useDebounced } from '../lib/useApi.js';
import { useSearchParams } from '../lib/router.jsx';
import { useLookups, useAuth } from '../lib/auth.jsx';
import { PageHeader, Button, Select, Pagination, Spinner, ErrorBox, Empty, Segmented, useUi, Card } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { TaskModal, CreatorPicker } from '../components/forms.jsx';
import { TaskList } from './CreatorProfile.jsx';
import { TASK_STATUSES, TASK_PRIORITIES } from '../../shared/constants.js';

const VIEWS = {
  open: { status: 'open' },
  today: { status: 'open', due: 'today' },
  week: { status: 'open', due: 'week' },
  overdue: { due: 'overdue' },
  mine: { status: 'open', assignee_id: 'me' },
  all: {},
};

export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const { users } = useLookups();
  const { toast } = useUi();
  const [search, setSearch] = useState(params.get('q') || '');
  const debounced = useDebounced(search);
  const [modal, setModal] = useState(null);
  const view = params.get('view') || 'open';

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

  const base = VIEWS[view] || VIEWS.open;
  const query = { ...base };
  for (const k of ['q', 'assignee_id', 'priority', 'creator_id', 'page']) if (params.get(k)) query[k] = params.get(k);
  if (params.get('status')) query.status = params.get('status');
  const { data, error, loading, reload } = useApi('/tasks' + qs({ ...query, page_size: 50 }));
  const counts = useApi('/dashboard');
  const k = counts.data?.kpi;
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
            value={view}
            onChange={(v) => setParams({ view: v === 'open' ? null : v, status: null, page: null })}
            options={[
              { value: 'open', label: 'Offen', count: k?.tasks_open },
              { value: 'today', label: 'Heute', count: k?.tasks_today },
              { value: 'week', label: 'Diese Woche' },
              { value: 'overdue', label: 'Überfällig', count: k?.tasks_overdue },
              { value: 'mine', label: 'Meine' },
              { value: 'all', label: 'Alle' },
            ]}
          />
        </div>
        <div className="filter-row">
          <div className="search-input">
            <Icon name="search" size={16} />
            <input className="input" placeholder="Aufgabe oder Creator suchen…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={params.get('assignee_id')} onChange={setFilter('assignee_id')} placeholder="Alle Verantwortlichen"
            options={[{ value: 'none', label: '– nicht zugewiesen –' }, ...users.map((u) => ({ value: String(u.id), label: u.name }))]} />
          <Select value={params.get('status')} onChange={setFilter('status')} placeholder="Status (Ansicht)" options={TASK_STATUSES} />
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
        <div className="card"><Empty icon="check" title="Keine Aufgaben in dieser Ansicht" /></div>
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
