import { useEffect, useState } from 'react';
import { api, qs } from '../lib/api.js';
import { useApi, invalidateAll } from '../lib/useApi.js';
import { useSearchParams, Link } from '../lib/router.jsx';
import {
  PageHeader, Card, Stat, Spinner, ErrorBox, Empty, Select, StatusBadge, Pagination, useUi,
  Button, IconButton, Modal, Field, Segmented, Badge, handleFormError,
} from '../components/ui.jsx';
import { CollaborationModal, UserSelect, CreatorPicker } from '../components/forms.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useForm } from '../lib/useApi.js';
import { fmtMoney, fmtDate, todayStr } from '../lib/format.js';
import { INVOICE_STATUSES, EXPENSE_CATEGORIES } from '../../shared/constants.js';

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export function FinancePage() {
  const { data, error, loading, reload } = useApi('/finance/summary');
  const [params, setParams] = useSearchParams();
  const [modal, setModal] = useState(null);
  const invoice = params.get('invoice_status') || '';
  const collabs = useApi('/collaborations' + qs({ invoice_status: invoice, page: params.get('page'), page_size: 25, sort: 'start' }));
  const { toast } = useUi();
  const exp = useApi('/finance/expenses-summary');
  const et = exp.data?.totals || { total: 0, month: 0, year: 0 };

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
      <div className="stat-row">
        <Stat icon="inbox" label="Ausgaben aktueller Monat" value={fmtMoney(et.month)} tone={Number(et.month) ? 'red' : undefined} />
        <Stat icon="inbox" label="Ausgaben aktuelles Jahr" value={fmtMoney(et.year)} tone={Number(et.year) ? 'red' : undefined} hint={`${fmtMoney(et.total)} gesamt`} />
        <Stat icon="trending" label="Ergebnis aktueller Monat" value={fmtMoney(t.month - et.month)} tone={t.month - et.month < 0 ? 'red' : 'green'} hint="Umsatz minus Ausgaben" />
        <Stat icon="trending" label="Ergebnis aktuelles Jahr" value={fmtMoney(t.year - et.year)} tone={t.year - et.year < 0 ? 'red' : 'green'} hint="Umsatz minus Ausgaben" />
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
      <ExpensesSection byCategory={exp.data?.by_category || []} />

      <CollaborationModal open={!!modal} onClose={() => setModal(null)} collaboration={modal} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ausgaben
// ---------------------------------------------------------------------------
function ExpensesSection({ byCategory }) {
  const { toast, confirm } = useUi();
  const [period, setPeriod] = useState('year');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  const { data } = useApi('/expenses' + qs({ period: period === 'all' ? '' : period, category, page, page_size: 25 }));
  const yearTotal = byCategory.reduce((a, c) => a + Number(c.sum), 0);

  const remove = async (e) => {
    const ok = await confirm({ title: 'Ausgabe löschen?', message: `„${e.title}“ (${fmtMoney(e.amount)}) wird gelöscht.`, confirmLabel: 'Löschen', danger: true });
    if (!ok) return;
    try {
      await api.del(`/expenses/${e.id}`);
      invalidateAll();
      toast('Ausgabe gelöscht.');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="grid-expenses">
      <Card
        title="Ausgaben"
        subtitle={data ? `Summe im Zeitraum: ${fmtMoney(data.sum)}` : ' '}
        actions={<Button variant="primary" size="sm" icon="plus" onClick={() => setModal({})}>Ausgabe erfassen</Button>}
        padded={false}
      >
        <div className="filter-row expense-filters">
          <Segmented
            value={period}
            onChange={(v) => { setPeriod(v); setPage(1); }}
            options={[{ value: 'month', label: 'Dieser Monat' }, { value: 'year', label: 'Dieses Jahr' }, { value: 'all', label: 'Alle' }]}
          />
          <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} placeholder="Alle Kategorien" options={EXPENSE_CATEGORIES} />
        </div>
        {!data ? <Spinner /> : !data.items.length ? (
          <Empty icon="inbox" title="Keine Ausgaben im Zeitraum" text="Erfasse z. B. Domain, Software-Abos oder Werbekosten." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Datum</th><th>Beschreibung</th><th>Kategorie</th><th>Bezahlt von</th><th className="num">Betrag</th><th /></tr></thead>
                <tbody>
                  {data.items.map((e) => (
                    <tr key={e.id} className="row-link" onClick={() => setModal({ item: e })}>
                      <td className="nowrap">{fmtDate(e.expense_date)}</td>
                      <td>
                        <div className="strong">{e.title}</div>
                        {(e.creator_name || e.notes) && <div className="cell-sub muted">{[e.creator_name, e.notes].filter(Boolean).join(' · ')}</div>}
                      </td>
                      <td><Badge tone="gray">{e.category}</Badge></td>
                      <td className="nowrap">{e.paid_by_name || <span className="muted">–</span>}</td>
                      <td className="num nowrap strong tone-red">−{fmtMoney(e.amount)}</td>
                      <td onClick={(ev) => ev.stopPropagation()}><IconButton icon="trash" label="Löschen" onClick={() => remove(e)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pages={data.pages} total={data.total} label="Ausgaben" onPage={setPage} />
          </>
        )}
      </Card>

      <Card title="Ausgaben nach Kategorie" subtitle="Aktuelles Jahr">
        {!byCategory.length ? <Empty icon="inbox" title="Noch keine Ausgaben" /> : (
          <ul className="cat-list">
            {byCategory.map((c) => (
              <li key={c.category}>
                <div className="cat-head">
                  <span>{c.category}</span>
                  <strong>{fmtMoney(c.sum)}</strong>
                </div>
                <div className="cat-bar"><span style={{ width: `${yearTotal ? (Number(c.sum) / yearTotal) * 100 : 0}%` }} /></div>
                <div className="muted small">{c.count} {c.count === 1 ? 'Posten' : 'Posten'}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ExpenseModal open={!!modal} item={modal?.item} onClose={() => setModal(null)} />
    </div>
  );
}

function ExpenseModal({ open, item, onClose }) {
  const { user } = useAuth();
  const { toast } = useUi();
  const [saving, setSaving] = useState(false);
  const f = useForm({});
  useEffect(() => {
    if (!open) return;
    f.setErrors({});
    f.setValues({
      expense_date: item?.expense_date || todayStr(),
      title: item?.title || '',
      category: item?.category || 'Sonstiges',
      amount: item?.amount ?? '',
      paid_by: item ? (item.paid_by ? String(item.paid_by) : '') : String(user.id),
      creator_id: item?.creator_id || null,
      creator_label: item?.creator_name || '',
      notes: item?.notes || '',
    });
  }, [open]); // eslint-disable-line
  const v = f.values;

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const { creator_label, ...payload } = v;
    try {
      if (item) await api.patch(`/expenses/${item.id}`, payload);
      else await api.post('/expenses', payload);
      invalidateAll();
      toast(item ? 'Ausgabe gespeichert.' : 'Ausgabe erfasst.');
      onClose();
    } catch (err) {
      handleFormError(err, f.setErrors, toast);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? 'Ausgabe bearbeiten' : 'Ausgabe erfassen'}
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" type="submit" form="expense-form" loading={saving}>Speichern</Button></>}
    >
      <form id="expense-form" className="form-grid" onSubmit={submit}>
        <Field label="Beschreibung" required error={f.errors.title} className="span-2">
          <input className="input" value={v.title || ''} onChange={f.set('title')} placeholder="z. B. Domain llk-management.de" required autoFocus />
        </Field>
        <Field label="Betrag (€)" required error={f.errors.amount}>
          <input className="input" type="number" min="0.01" step="0.01" value={v.amount ?? ''} onChange={f.set('amount')} placeholder="15,00" required />
        </Field>
        <Field label="Datum" required error={f.errors.expense_date}>
          <input className="input" type="date" value={v.expense_date || ''} onChange={f.set('expense_date')} required />
        </Field>
        <Field label="Kategorie" error={f.errors.category}>
          <Select value={v.category} onChange={f.set('category')} options={EXPENSE_CATEGORIES} />
        </Field>
        <Field label="Bezahlt von" error={f.errors.paid_by} hint="Wer hat das Geld ausgelegt?">
          <UserSelect value={v.paid_by} onChange={f.set('paid_by')} placeholder="– Firmenkonto –" includeInactive />
        </Field>
        <Field label="Zugehöriger Creator (optional)" error={f.errors.creator_id} className="span-2">
          <CreatorPicker value={v.creator_id} initialLabel={v.creator_label} onChange={(id, label) => f.setValues((x) => ({ ...x, creator_id: id, creator_label: label }))} />
        </Field>
        <Field label="Notizen" error={f.errors.notes} className="span-2">
          <textarea className="input" rows={2} value={v.notes || ''} onChange={f.set('notes')} placeholder="z. B. Jahresgebühr, Rechnungsnummer" />
        </Field>
      </form>
    </Modal>
  );
}
