import { useEffect, useState } from 'react';
import { api, qs } from '../lib/api.js';
import { useApi, useDebounced } from '../lib/useApi.js';
import { useSearchParams } from '../lib/router.jsx';
import { PageHeader, Button, Select, Pagination, Spinner, ErrorBox, Empty, Segmented, useUi } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { CollaborationModal } from '../components/forms.jsx';
import { CollabTable } from './CreatorProfile.jsx';
import { COLLAB_STATUSES, INVOICE_STATUSES } from '../../shared/constants.js';

export function CollaborationsPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') || '');
  const debounced = useDebounced(search);
  const [modal, setModal] = useState(null);
  const { toast } = useUi();

  useEffect(() => {
    if ((params.get('q') || '') !== debounced) setParams({ q: debounced, page: null });
  }, [debounced]); // eslint-disable-line

  // Deep-Link aus globaler Suche / Dashboard: ?open=ID
  const openId = params.get('open');
  useEffect(() => {
    if (!openId) return;
    api.get(`/collaborations/${openId}`).then((r) => setModal({ item: r.collaboration })).catch((e) => toast(e.message, 'error'));
  }, [openId]); // eslint-disable-line

  const query = {};
  for (const k of ['q', 'status', 'status_group', 'invoice_status', 'timeframe', 'deadline', 'sort', 'page']) if (params.get(k)) query[k] = params.get(k);
  const { data, error, loading, reload } = useApi('/collaborations' + qs({ ...query, page_size: 50 }));
  const setFilter = (k) => (e) => setParams({ [k]: e?.target ? e.target.value : e, page: null });
  const close = () => {
    setModal(null);
    if (openId) setParams({ open: null });
  };

  return (
    <div className="page">
      <PageHeader
        title="Kooperationen"
        subtitle="Alle Kooperationen über alle Creator"
        actions={<Button variant="primary" icon="plus" onClick={() => setModal({ item: null })}>Neue Kooperation</Button>}
      />
      <div className="filters card">
        <div className="filter-row">
          <Segmented
            value={params.get('timeframe') || ''}
            onChange={(v) => setParams({ timeframe: v, page: null })}
            options={[{ value: '', label: 'Alle' }, { value: 'current', label: 'Aktuell' }, { value: 'future', label: 'Zukünftig' }, { value: 'past', label: 'Vergangen' }]}
          />
          <div className="search-input">
            <Icon name="search" size={16} />
            <input className="input" placeholder="Brand, Kampagne oder Creator…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={params.get('status')} onChange={setFilter('status')} placeholder="Alle Status" options={COLLAB_STATUSES} />
          <Select value={params.get('invoice_status')} onChange={setFilter('invoice_status')} placeholder="Alle Rechnungsstatus" options={INVOICE_STATUSES} />
          <Select value={params.get('sort')} onChange={setFilter('sort')} placeholder="Sortierung: Startdatum"
            options={[{ value: 'deadline', label: 'Deadline' }, { value: 'fee', label: 'Vergütung' }, { value: 'brand', label: 'Brand' }, { value: 'created', label: 'Neueste' }]} />
          {(params.get('status_group') || params.get('deadline')) && (
            <Button variant="ghost" onClick={() => setParams({ status_group: null, deadline: null })}>
              {params.get('status_group') ? 'Nur aktive' : 'Kommende Deadlines'} <Icon name="x" size={14} />
            </Button>
          )}
        </div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {!data && loading ? <Spinner /> : data && !data.items.length ? (
        <div className="card"><Empty icon="briefcase" title="Keine Kooperationen gefunden" /></div>
      ) : data ? (
        <div className={`card table-card ${loading ? 'is-loading' : ''}`}>
          <CollabTable items={data.items} showCreator onOpen={(c) => setModal({ item: c })} />
          <Pagination page={data.page} pages={data.pages} total={data.total} label="Kooperationen" onPage={(p) => setParams({ page: p > 1 ? p : null })} />
        </div>
      ) : null}
      <CollaborationModal open={!!modal} onClose={close} collaboration={modal?.item} />
    </div>
  );
}
