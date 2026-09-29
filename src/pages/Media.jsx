import { useEffect, useState } from 'react';
import { api, qs } from '../lib/api.js';
import { useApi, useForm, useDebounced, invalidateAll } from '../lib/useApi.js';
import { useSearchParams, Link } from '../lib/router.jsx';
import { useAuth, useLookups } from '../lib/auth.jsx';
import {
  PageHeader, Card, Stat, Button, Modal, Field, Select, Segmented, Spinner, ErrorBox, Empty, Pagination, Badge,
  useUi, handleFormError,
} from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { UserSelect, CreatorPicker } from '../components/forms.jsx';
import { fmtMoney, fmtDate, fmtDue, fmtDateTime, toLocalInput } from '../lib/format.js';
import { MEDIA_STATUSES, MEDIA_TYPES, INVOICE_STATUSES } from '../../shared/constants.js';

const TONES = {
  Anfrage: 'gray', 'Angebot gesendet': 'blue', Gebucht: 'violet', 'Dreh geplant': 'amber', Gedreht: 'teal',
  Schnitt: 'violet', Feedback: 'orange', Geliefert: 'green', Abgeschlossen: 'green', Abgebrochen: 'red',
};
const MediaStatus = ({ value }) => <Badge tone={TONES[value] || 'gray'} dot>{value}</Badge>;

const fmtShoot = (iso) => {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) + ', ' +
    d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
};
const shootDay = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function MediaPage() {
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
    api.get(`/media/${openId}`).then((r) => setModal({ item: r.project })).catch((e) => toast(e.message, 'error'));
  }, [openId]); // eslint-disable-line

  const overview = useApi('/media/overview');
  const list = useApi('/media' + qs({ view, q: params.get('q'), status: params.get('status'), assignee_id: params.get('assignee_id'), page: params.get('page') }));
  const k = overview.data?.kpi;
  const close = () => {
    setModal(null);
    if (openId) setParams({ open: null });
  };

  return (
    <div className="page">
      <PageHeader
        title="Media Produktion"
        subtitle="Foto- & Videoprojekte: Kunden, Drehtermine und Abgaben"
        actions={<Button variant="primary" icon="plus" onClick={() => setModal({ item: null })}>Neues Projekt</Button>}
      />

      <ErrorBox error={overview.error} onRetry={overview.reload} />
      <div className="stat-row">
        <Stat icon="camera" label="Offene Projekte" value={k ? k.open_projects : '–'} hint={k ? `${k.inquiries} Anfragen / Angebote` : null} />
        <Stat icon="calendar" label="Drehs nächste 7 Tage" value={k ? k.shoots_week : '–'} />
        <Stat icon="clock" label="Abgaben fällig (7 Tage)" value={k ? k.deliveries_due : '–'} tone={k?.deliveries_overdue ? 'red' : undefined}
          hint={k?.deliveries_overdue ? `${k.deliveries_overdue} überfällig` : null} />
        <Stat icon="euro" label="Noch nicht bezahlt" value={k ? fmtMoney(k.open_amount) : '–'} hint={k ? `${fmtMoney(k.revenue_year)} Auftragswert dieses Jahr` : null} />
      </div>

      <div className="grid-2">
        <Card title="Nächste Drehs" padded={false}>
          {!overview.data ? <Spinner /> : !overview.data.shoots.length ? (
            <Empty icon="camera" title="Keine Drehs geplant" />
          ) : (
            <ul className="list">
              {overview.data.shoots.map((m) => {
                const due = fmtDue(shootDay(m.shoot_at));
                return (
                  <li key={m.id}>
                    <button className="list-row" onClick={() => setModal({ item: m })}>
                      <span className={`due-pill ${due === 'heute' ? 'today' : ''}`}>{due}</span>
                      <div className="list-main">
                        <div className="list-title">{m.client_name} – {m.title}</div>
                        <div className="list-sub">{fmtShoot(m.shoot_at)}{m.shoot_location ? ` · ${m.shoot_location}` : ''}{m.assignee_name ? ` · ${m.assignee_name}` : ''}</div>
                      </div>
                      <MediaStatus value={m.status} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card title="Anstehende Abgaben" subtitle="Wann will der Kunde die Dateien?" padded={false}>
          {!overview.data ? <Spinner /> : !overview.data.deliveries.length ? (
            <Empty icon="check" title="Keine offenen Abgaben" />
          ) : (
            <ul className="list">
              {overview.data.deliveries.map((m) => {
                const due = fmtDue(m.delivery_date);
                return (
                  <li key={m.id}>
                    <button className="list-row" onClick={() => setModal({ item: m })}>
                      <span className={`due-pill ${m.delivery_overdue ? 'overdue' : due === 'heute' ? 'today' : ''}`}>{due}</span>
                      <div className="list-main">
                        <div className="list-title">{m.client_name} – {m.title}</div>
                        <div className="list-sub">Abgabe {fmtDate(m.delivery_date)}{m.deliverables ? ` · ${m.deliverables}` : ''}</div>
                      </div>
                      <MediaStatus value={m.status} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="filters card">
        <div className="filter-row">
          <Segmented
            value={view}
            onChange={(v) => setParams({ view: v === 'open' ? null : v, page: null })}
            options={[{ value: 'open', label: 'Offen' }, { value: 'closed', label: 'Abgeschlossen' }, { value: 'all', label: 'Alle' }]}
          />
          <div className="search-input">
            <Icon name="search" size={16} />
            <input className="input" placeholder="Kunde, Projekt, Ansprechpartner, Ort…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={params.get('status')} onChange={(e) => setParams({ status: e.target.value, page: null })} placeholder="Alle Status" options={MEDIA_STATUSES} />
          <Select value={params.get('assignee_id')} onChange={(e) => setParams({ assignee_id: e.target.value, page: null })} placeholder="Alle Verantwortlichen"
            options={users.map((u) => ({ value: String(u.id), label: u.name }))} />
        </div>
      </div>

      <ErrorBox error={list.error} onRetry={list.reload} />
      {!list.data ? <Spinner /> : !list.data.items.length ? (
        <div className="card">
          <Empty icon="camera" title="Keine Projekte" text="Lege dein erstes Foto- oder Videoprojekt an."
            action={<Button variant="primary" icon="plus" onClick={() => setModal({ item: null })}>Neues Projekt</Button>} />
        </div>
      ) : (
        <div className={`card table-card ${list.loading ? 'is-loading' : ''}`}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Kunde / Projekt</th><th>Art</th><th>Dreh</th><th>Abgabe</th><th>Status</th><th>Verantwortlich</th><th className="num">Preis</th><th>Rechnung</th></tr>
              </thead>
              <tbody>
                {list.data.items.map((m) => (
                  <tr key={m.id} className="row-link" onClick={() => setModal({ item: m })}>
                    <td>
                      <div className="strong">{m.client_name}</div>
                      <div className="cell-sub muted">{m.title}{m.creator_name ? ` · ${m.creator_name}` : ''}</div>
                    </td>
                    <td className="clip">{m.project_type || <span className="muted">–</span>}</td>
                    <td className="nowrap">{m.shoot_at ? fmtShoot(m.shoot_at) : <span className="muted">offen</span>}{m.shoot_location && <div className="cell-sub muted">{m.shoot_location}</div>}</td>
                    <td className="nowrap">
                      {m.delivery_date ? <span className={m.delivery_overdue ? 'tone-red strong' : ''}>{fmtDate(m.delivery_date)}</span> : <span className="muted">–</span>}
                      {m.delivery_date && m.is_open && m.status !== 'Geliefert' && <div className={`cell-sub ${m.delivery_overdue ? 'tone-red' : 'muted'}`}>{fmtDue(m.delivery_date)}</div>}
                    </td>
                    <td><MediaStatus value={m.status} /></td>
                    <td className="clip">{m.assignee_name || <span className="muted">–</span>}</td>
                    <td className="num nowrap">{fmtMoney(m.price)}</td>
                    <td><Badge tone={m.invoice_status === 'Bezahlt' ? 'green' : m.invoice_status === 'Überfällig' ? 'red' : 'gray'}>{m.invoice_status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} label="Projekte" onPage={(p) => setParams({ page: p > 1 ? p : null })} />
        </div>
      )}

      <MediaModal open={!!modal} item={modal?.item} onClose={close} />
    </div>
  );
}

function MediaModal({ open, item, onClose }) {
  const { user } = useAuth();
  const { toast, confirm } = useUi();
  const [saving, setSaving] = useState(false);
  const f = useForm({});
  useEffect(() => {
    if (!open) return;
    const m = item || {};
    f.setErrors({});
    f.setValues({
      client_name: m.client_name || '', title: m.title || '', project_type: m.project_type || '', status: m.status || 'Anfrage',
      shoot_at: m.shoot_at ? toLocalInput(m.shoot_at) : '', shoot_location: m.shoot_location || '', delivery_date: m.delivery_date || '',
      deliverables: m.deliverables || '', price: m.price ?? '', invoice_status: m.invoice_status || 'Nicht erstellt',
      contact_name: m.contact_name || '', contact_email: m.contact_email || '', contact_phone: m.contact_phone || '',
      assignee_id: m.id ? (m.assignee_id ? String(m.assignee_id) : '') : String(user.id),
      creator_id: m.creator_id || null, creator_label: m.creator_name || '', notes: m.notes || '',
    });
  }, [open]); // eslint-disable-line
  const v = f.values;

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const { creator_label, ...payload } = v;
    payload.shoot_at = v.shoot_at ? new Date(v.shoot_at).toISOString() : null;
    try {
      if (item) await api.patch(`/media/${item.id}`, payload);
      else await api.post('/media', payload);
      invalidateAll();
      toast(item ? 'Projekt gespeichert.' : 'Projekt angelegt.');
      onClose();
    } catch (err) {
      handleFormError(err, f.setErrors, toast);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({ title: 'Projekt löschen?', message: `„${item.title}“ für ${item.client_name} wird gelöscht.`, warning: 'Dieser Vorgang kann nicht rückgängig gemacht werden.', confirmLabel: 'Löschen', danger: true });
    if (!ok) return;
    try {
      await api.del(`/media/${item.id}`);
      invalidateAll();
      toast('Projekt gelöscht.');
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={item ? `${item.client_name} – ${item.title}` : 'Neues Media-Projekt'}
      footer={
        <>
          {item && <Button variant="ghost-danger" icon="trash" onClick={remove} className="mr-auto">Löschen</Button>}
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" type="submit" form="media-form" loading={saving}>Speichern</Button>
        </>
      }
    >
      <form id="media-form" className="form-grid" onSubmit={submit}>
        <Field label="Kunde" required error={f.errors.client_name}>
          <input className="input" value={v.client_name || ''} onChange={f.set('client_name')} placeholder="z. B. Café Nordlicht" required autoFocus={!item} />
        </Field>
        <Field label="Projekt" required error={f.errors.title}>
          <input className="input" value={v.title || ''} onChange={f.set('title')} placeholder="z. B. Herbst-Reels" required />
        </Field>
        <Field label="Art" error={f.errors.project_type}>
          <input className="input" list="media-types" value={v.project_type || ''} onChange={f.set('project_type')} placeholder="z. B. Reel / TikTok" />
          <datalist id="media-types">{MEDIA_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
        </Field>
        <Field label="Status" error={f.errors.status}>
          <Select value={v.status} onChange={f.set('status')} options={MEDIA_STATUSES} />
        </Field>

        <div className="form-section span-2">Dreh & Abgabe</div>
        <Field label="Nächster Drehtermin" error={f.errors.shoot_at}>
          <input className="input" type="datetime-local" value={v.shoot_at || ''} onChange={f.set('shoot_at')} />
        </Field>
        <Field label="Drehort" error={f.errors.shoot_location}>
          <input className="input" value={v.shoot_location || ''} onChange={f.set('shoot_location')} placeholder="Adresse oder Location" />
        </Field>
        <Field label="Abgabe an Kunden bis" error={f.errors.delivery_date} hint="Wann will der Kunde die Videos/Fotos?">
          <input className="input" type="date" value={v.delivery_date || ''} onChange={f.set('delivery_date')} />
        </Field>
        <Field label="Verantwortlich" error={f.errors.assignee_id}>
          <UserSelect value={v.assignee_id} onChange={f.set('assignee_id')} includeInactive />
        </Field>
        <Field label="Leistungen / Deliverables" error={f.errors.deliverables} className="span-2">
          <textarea className="input" rows={2} value={v.deliverables || ''} onChange={f.set('deliverables')} placeholder="z. B. 3 Reels (9:16), 20 bearbeitete Fotos, Rohmaterial" />
        </Field>

        <div className="form-section span-2">Kontakt beim Kunden</div>
        <Field label="Ansprechpartner" error={f.errors.contact_name}>
          <input className="input" value={v.contact_name || ''} onChange={f.set('contact_name')} />
        </Field>
        <Field label="Telefon" error={f.errors.contact_phone}>
          <input className="input" type="tel" value={v.contact_phone || ''} onChange={f.set('contact_phone')} />
        </Field>
        <Field label="E-Mail" error={f.errors.contact_email}>
          <input className="input" type="email" value={v.contact_email || ''} onChange={f.set('contact_email')} />
        </Field>
        <Field label="Zugehöriger Creator (optional)" error={f.errors.creator_id}>
          <CreatorPicker value={v.creator_id} initialLabel={v.creator_label} onChange={(id, label) => f.setValues((x) => ({ ...x, creator_id: id, creator_label: label }))} />
        </Field>

        <div className="form-section span-2">Abrechnung</div>
        <Field label="Preis (€)" error={f.errors.price}>
          <input className="input" type="number" min="0" step="0.01" value={v.price ?? ''} onChange={f.set('price')} placeholder="0" />
        </Field>
        <Field label="Rechnungsstatus" error={f.errors.invoice_status}>
          <Select value={v.invoice_status} onChange={f.set('invoice_status')} options={INVOICE_STATUSES} />
        </Field>
        <Field label="Notizen" error={f.errors.notes} className="span-2">
          <textarea className="input" rows={3} value={v.notes || ''} onChange={f.set('notes')} placeholder="Shotlist, Wünsche des Kunden, Equipment…" />
        </Field>
        {item?.creator_id && (
          <p className="small span-2"><Link to={`/creators/${item.creator_id}`} className="link" onClick={onClose}>Zum Creator-Profil von {item.creator_name}</Link></p>
        )}
        {item && <p className="muted small span-2">Angelegt am {fmtDateTime(item.created_at)}</p>}
      </form>
    </Modal>
  );
}
