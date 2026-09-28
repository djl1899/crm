import { useEffect, useState } from 'react';
import { qs, api } from '../lib/api.js';
import { useApi, useDebounced, invalidateAll } from '../lib/useApi.js';
import { useSearchParams, Link } from '../lib/router.jsx';
import { PageHeader, Button, Select, Pagination, Spinner, ErrorBox, Empty, Tabs, Card, StatusBadge, Badge, useUi } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { UploadModal } from '../components/forms.jsx';
import { DocumentList } from './CreatorProfile.jsx';
import { fmtDate, fmtDue } from '../lib/format.js';
import { CONTRACT_STATUSES, DOCUMENT_CATEGORIES } from '../../shared/constants.js';

export function ContractsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'contracts';
  const [upload, setUpload] = useState(false);
  return (
    <div className="page">
      <PageHeader
        title="Verträge & Dokumente"
        actions={<Button variant="primary" icon="upload" onClick={() => setUpload(true)}>Datei hochladen</Button>}
      />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t === 'contracts' ? null : t, page: null, q: null })}
        tabs={[{ key: 'contracts', label: 'Verträge' }, { key: 'documents', label: 'Dokumente' }]} />
      <div className="tab-panel">
        {tab === 'contracts' ? <Contracts params={params} setParams={setParams} /> : <Documents params={params} setParams={setParams} />}
      </div>
      <UploadModal open={upload} onClose={() => setUpload(false)} defaultCategory={tab === 'contracts' ? 'Verträge' : 'Sonstige Dokumente'} />
    </div>
  );
}

function SearchBox({ params, setParams, placeholder }) {
  const [search, setSearch] = useState(params.get('q') || '');
  const debounced = useDebounced(search);
  useEffect(() => {
    if ((params.get('q') || '') !== debounced) setParams({ q: debounced, page: null });
  }, [debounced]); // eslint-disable-line
  return (
    <div className="search-input">
      <Icon name="search" size={16} />
      <input className="input" placeholder={placeholder} value={search} onChange={(e) => setSearch(e.target.value)} />
    </div>
  );
}

function Contracts({ params, setParams }) {
  const query = {};
  for (const k of ['q', 'status', 'expiring', 'page']) if (params.get(k)) query[k] = params.get(k);
  const { data, loading, error, reload } = useApi('/contracts' + qs({ ...query, page_size: 50 }));
  return (
    <div className="stack-lg">
      <div className="filters card">
        <div className="filter-row">
          <SearchBox params={params} setParams={setParams} placeholder="Creator suchen…" />
          <Select value={params.get('status')} onChange={(e) => setParams({ status: e.target.value, page: null })} placeholder="Alle Vertragsstatus" options={CONTRACT_STATUSES} />
          <label className="checkbox">
            <input type="checkbox" checked={params.get('expiring') === '1'} onChange={(e) => setParams({ expiring: e.target.checked ? '1' : null, page: null })} />
            Läuft in 30 Tagen aus
          </label>
        </div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <Card padded={false}>
        {loading && !data ? <Spinner /> : !data?.items.length ? <Empty icon="file" title="Keine Einträge" /> : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Creator</th><th>Vertragsstatus</th><th>Beginn</th><th>Ende</th><th>Exklusivität</th><th>Kündigungsfrist</th><th>Dateien</th><th>Manager</th></tr></thead>
                <tbody>
                  {data.items.map((c) => (
                    <tr key={c.creator_id}>
                      <td><Link to={`/creators/${c.creator_id}?tab=contract`} className="strong">{c.creator_name}</Link></td>
                      <td><StatusBadge value={c.status} /></td>
                      <td className="nowrap">{fmtDate(c.start_date)}</td>
                      <td className="nowrap">
                        {fmtDate(c.end_date)}
                        {c.expiring_soon && <div><Badge tone="amber">läuft {fmtDue(c.end_date)} aus</Badge></div>}
                      </td>
                      <td className="clip">{c.exclusivity || <span className="muted">–</span>}</td>
                      <td className="clip">{c.notice_period || <span className="muted">–</span>}</td>
                      <td>{c.contract_files ? <Link to={`/creators/${c.creator_id}?tab=contract`} className="link">{c.contract_files} Datei(en)</Link> : <span className="muted">–</span>}</td>
                      <td className="clip">{c.manager_name || <span className="muted">–</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pages={data.pages} total={data.total} label="Creator" onPage={(p) => setParams({ page: p > 1 ? p : null })} />
          </>
        )}
      </Card>
    </div>
  );
}

function Documents({ params, setParams }) {
  const { toast, confirm } = useUi();
  const query = {};
  for (const k of ['q', 'category', 'page']) if (params.get(k)) query[k] = params.get(k);
  const { data, loading, error, reload } = useApi('/documents' + qs({ ...query, page_size: 50 }));
  const remove = async (d) => {
    if (!(await confirm({ title: 'Datei löschen?', message: `„${d.filename}“ wird dauerhaft gelöscht.`, confirmLabel: 'Löschen', danger: true }))) return;
    try {
      await api.del(`/documents/${d.id}`);
      invalidateAll();
      toast('Datei gelöscht.');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <div className="stack-lg">
      <div className="filters card">
        <div className="filter-row">
          <SearchBox params={params} setParams={setParams} placeholder="Dateiname, Creator, Brand…" />
          <Select value={params.get('category')} onChange={(e) => setParams({ category: e.target.value, page: null })} placeholder="Alle Kategorien" options={DOCUMENT_CATEGORIES} />
        </div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <Card padded={false}>
        <DocumentList items={data?.items} loading={loading && !data} onDelete={remove} showCreator />
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} label="Dateien" onPage={(p) => setParams({ page: p > 1 ? p : null })} />}
      </Card>
    </div>
  );
}
