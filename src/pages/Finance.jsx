import { useState } from 'react';
import { api, qs } from '../lib/api.js';
import { useApi, invalidateAll } from '../lib/useApi.js';
import { useSearchParams, Link } from '../lib/router.jsx';
import { PageHeader, Card, Stat, Spinner, ErrorBox, Empty, Select, StatusBadge, Pagination, useUi } from '../components/ui.jsx';
import { CollaborationModal } from '../components/forms.jsx';
import { fmtMoney, fmtDate } from '../lib/format.js';
import { INVOICE_STATUSES } from '../../shared/constants.js';

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export function FinancePage() {
  const { data, error, loading, reload } = useApi('/finance/summary');
  const [params, setParams] = useSearchParams();
  const [modal, setModal] = useState(null);
  const invoice = params.get('invoice_status') || '';
  const collabs = useApi('/collaborations' + qs({ invoice_status: invoice, page: params.get('page'), page_size: 25, sort: 'start' }));
  const { toast } = useUi();

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const t = data.totals;

  // letzte 12 Monate auffüllen
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ key, label: MONTHS[d.getMonth()], value: Number(data.by_month.find((m) => m.month === key)?.revenue || 0) });
  }
  const max = Math.max(1, ...months.map((m) => m.value));

  const setInvoice = async (c, status) => {
    try {
      await api.patch(`/collaborations/${c.id}`, { invoice_status: status });
      invalidateAll();
      toast('Rechnungsstatus aktualisiert.');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader title="Finanzen" subtitle="Umsatz aus bestätigten Kooperationen (Status Geplant bis Abgeschlossen)" />
      <div className="stat-row">
        <Stat icon="euro" label="Gesamtumsatz" value={fmtMoney(t.total)} />
        <Stat icon="calendar" label="Aktueller Monat" value={fmtMoney(t.month)} />
        <Stat icon="trending" label="Aktuelles Jahr" value={fmtMoney(t.year)} />
        <Stat icon="check" label="Bezahlt" value={fmtMoney(t.paid)} tone="green" hint={`${fmtMoney(t.open)} offen · ${fmtMoney(t.overdue)} überfällig`} />
      </div>

      <div className="grid-2">
        <Card title="Umsatz der letzten 12 Monate">
          <div className="bars" role="img" aria-label="Umsatz pro Monat">
            {months.map((m) => (
              <div key={m.key} className="bar-col" title={`${m.label}: ${fmtMoney(m.value)}`}>
                <div className="bar-value">{m.value ? fmtMoney(m.value).replace(/\s?€/, '') : ''}</div>
                <div className="bar" style={{ height: `${(m.value / max) * 100}%` }} />
                <div className="bar-label">{m.label}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Umsatz pro Creator" padded={false}>
          {!data.by_creator.length ? <Empty icon="euro" title="Noch kein Umsatz" /> : (
            <div className="table-wrap table-scroll">
              <table className="table">
                <thead><tr><th>Creator</th><th className="num">Umsatz</th><th className="num">Bezahlt</th><th className="num">Offen</th></tr></thead>
                <tbody>
                  {data.by_creator.map((c) => (
                    <tr key={c.id}>
                      <td><Link to={`/creators/${c.id}?tab=finance`} className="strong">{c.display_name}</Link><div className="cell-sub muted">{c.collab_count} Kooperation(en)</div></td>
                      <td className="num nowrap strong">{fmtMoney(c.revenue)}</td>
                      <td className="num nowrap">{fmtMoney(c.paid)}</td>
                      <td className="num nowrap">{fmtMoney(c.open)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card title="Rechnungsstatus je Kooperation" actions={
        <Select value={invoice} onChange={(e) => setParams({ invoice_status: e.target.value, page: null })} placeholder="Alle Rechnungsstatus" options={INVOICE_STATUSES} />
      } padded={false}>
        {!collabs.data ? <Spinner /> : !collabs.data.items.length ? <Empty icon="euro" title="Keine Kooperationen" /> : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Kooperation</th><th>Creator</th><th>Start</th><th>Status</th><th className="num">Vergütung</th><th>Rechnungsstatus</th></tr></thead>
                <tbody>
                  {collabs.data.items.map((c) => (
                    <tr key={c.id} className={c.counts_as_revenue ? '' : 'row-muted'}>
                      <td><button className="link strong" onClick={() => setModal(c)}>{c.brand}{c.campaign_name ? ` – ${c.campaign_name}` : ''}</button></td>
                      <td><Link to={`/creators/${c.creator_id}?tab=finance`}>{c.creator_name}</Link></td>
                      <td className="nowrap">{fmtDate(c.start_date)}</td>
                      <td><StatusBadge value={c.status} /></td>
                      <td className="num nowrap">{fmtMoney(c.fee)}</td>
                      <td>
                        <select className="input input-sm" value={c.invoice_status} onChange={(e) => setInvoice(c, e.target.value)}>
                          {INVOICE_STATUSES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={collabs.data.page} pages={collabs.data.pages} total={collabs.data.total} label="Kooperationen" onPage={(p) => setParams({ page: p > 1 ? p : null })} />
          </>
        )}
      </Card>
      <CollaborationModal open={!!modal} onClose={() => setModal(null)} collaboration={modal} />
    </div>
  );
}
