import { useEffect, useState } from 'react';
import { api, qs } from '../lib/api.js';
import { useApi, useDebounced, invalidateAll } from '../lib/useApi.js';
import { useSearchParams, Link, useNavigate } from '../lib/router.jsx';
import { useLookups } from '../lib/auth.jsx';
import { PageHeader, Button, Select, Pagination, Spinner, ErrorBox, Empty, Segmented, Tabs, Card, Badge, IconButton, useUi } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { OutreachModal } from '../components/forms.jsx';
import { fmtDate, fmtDue, fmtDateTime } from '../lib/format.js';
import { OUTREACH_CHANNELS } from '../../shared/constants.js';

export function OutreachPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'followups';
  const [modal, setModal] = useState(null);
  const dash = useApi('/dashboard');
  const k = dash.data?.kpi;
  const navigate = useNavigate();

  return (
    <div className="page">
      <PageHeader
        title="Outreach"
        subtitle="Kontaktverlauf und Follow-ups aller Creator"
        actions={
          <>
            <Button icon="users" onClick={() => navigate('/creators?contacted=no')}>
              Noch nicht angeschrieben{k ? ` (${k.creators_not_contacted})` : ''}
            </Button>
            <Button variant="primary" icon="send" onClick={() => setModal({})}>Kontakt erfassen</Button>
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={(t) => setParams({ tab: t, range: null, page: null })}
        tabs={[
          { key: 'followups', label: 'Follow-ups', count: k ? k.followups_today + k.followups_overdue : undefined },
          { key: 'history', label: 'Kontaktverlauf' },
        ]}
      />
      <div className="tab-panel">
        {tab === 'followups' ? <FollowUps params={params} setParams={setParams} onEdit={(o) => setModal({ item: o })} /> : <History params={params} setParams={setParams} onEdit={(o) => setModal({ item: o })} />}
      </div>
      <OutreachModal open={!!modal} onClose={() => setModal(null)} activity={modal?.item} />
    </div>
  );
}

function FollowUps({ params, setParams, onEdit }) {
  const range = params.get('range') || 'due';
  const { data, loading, error, reload } = useApi(`/followups${qs({ range })}`);
  const { toast } = useUi();
  const done = async (o) => {
    try {
      await api.patch(`/outreach/${o.id}`, { follow_up_done: true });
      invalidateAll();
      toast('Follow-up erledigt.');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <div className="stack-lg">
      <Segmented
        value={range}
        onChange={(v) => setParams({ range: v })}
        options={[
          { value: 'due', label: 'Fällig (heute + überfällig)' },
          { value: 'today', label: 'Heute' },
          { value: 'overdue', label: 'Überfällig' },
          { value: 'week', label: 'Nächste 7 Tage' },
          { value: 'open', label: 'Alle offenen' },
        ]}
      />
      <ErrorBox error={error} onRetry={reload} />
      <Card padded={false}>
        {loading && !data ? <Spinner /> : !data?.items.length ? (
          <Empty icon="check" title="Keine Follow-ups in diesem Zeitraum" />
        ) : (
          <ul className="list">
            {data.items.map((o) => {
              const due = fmtDue(o.follow_up_date);
              return (
                <li key={o.id} className="list-row static">
                  <span className={`due-pill ${due.startsWith('vor') || due === 'gestern' ? 'overdue' : due === 'heute' ? 'today' : ''}`}>{due}</span>
                  <div className="list-main">
                    <Link to={`/creators/${o.creator_id}?tab=outreach`} className="list-title link-plain">{o.creator_name}</Link>
                    <div className="list-sub">
                      Follow-up {fmtDate(o.follow_up_date)} · letzter Kontakt {fmtDateTime(o.occurred_at)} via {o.channel}
                      {o.subject ? ` · ${o.subject}` : ''} · {o.user_name || '–'}
                    </div>
                  </div>
                  <Badge tone="gray">{o.outreach_status}</Badge>
                  <Button size="sm" icon="check" onClick={() => done(o)}>Erledigt</Button>
                  <IconButton icon="edit" label="Bearbeiten" onClick={() => onEdit(o)} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <p className="muted small">Tipp: Wenn du einen neuen Kontakt zu einem Creator erfasst, werden dessen offene Follow-ups automatisch als erledigt markiert.</p>
    </div>
  );
}

function History({ params, setParams, onEdit }) {
  const { users } = useLookups();
  const [search, setSearch] = useState(params.get('q') || '');
  const debounced = useDebounced(search);
  useEffect(() => {
    if ((params.get('q') || '') !== debounced) setParams({ q: debounced, page: null });
  }, [debounced]); // eslint-disable-line
  const query = {};
  for (const k of ['q', 'channel', 'user_id', 'page']) if (params.get(k)) query[k] = params.get(k);
  const { data, loading, error, reload } = useApi('/outreach' + qs({ ...query, page_size: 50 }));
  const setFilter = (k) => (e) => setParams({ [k]: e.target.value, page: null });
  return (
    <div className="stack-lg">
      <div className="filters card">
        <div className="filter-row">
          <div className="search-input">
            <Icon name="search" size={16} />
            <input className="input" placeholder="Creator, Betreff, Nachricht…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={params.get('channel')} onChange={setFilter('channel')} placeholder="Alle Kanäle" options={OUTREACH_CHANNELS} />
          <Select value={params.get('user_id')} onChange={setFilter('user_id')} placeholder="Alle Benutzer" options={users.map((u) => ({ value: String(u.id), label: u.name }))} />
        </div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <Card padded={false}>
        {loading && !data ? <Spinner /> : !data?.items.length ? (
          <Empty icon="send" title="Keine Kontakte gefunden" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Datum</th><th>Creator</th><th>Kanal</th><th>Betreff / Nachricht</th><th>Ergebnis</th><th>Benutzer</th><th>Follow-up</th><th /></tr></thead>
                <tbody>
                  {data.items.map((o) => (
                    <tr key={o.id}>
                      <td className="nowrap">{fmtDateTime(o.occurred_at)}</td>
                      <td><Link to={`/creators/${o.creator_id}?tab=outreach`} className="strong">{o.creator_name}</Link></td>
                      <td className="nowrap">{o.channel}</td>
                      <td className="clip-wide">
                        {o.subject && <div className="strong">{o.subject}</div>}
                        {o.message && <div className="cell-sub muted">{o.message}</div>}
                      </td>
                      <td>{o.result || <span className="muted">–</span>}</td>
                      <td className="nowrap">{o.user_name || '–'}</td>
                      <td className="nowrap">{o.follow_up_date ? <span className={o.follow_up_done ? 'muted strike' : ''}>{fmtDate(o.follow_up_date)}</span> : <span className="muted">–</span>}</td>
                      <td><IconButton icon="edit" label="Bearbeiten" onClick={() => onEdit(o)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pages={data.pages} total={data.total} label="Kontakte" onPage={(p) => setParams({ page: p > 1 ? p : null })} />
          </>
        )}
      </Card>
    </div>
  );
}
