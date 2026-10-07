// Team: eigene Kontaktlisten (Ansprechpartner bei Firmen, Agenturen, Presse …)
import { useEffect, useState } from 'react';
import { api, qs } from '../lib/api.js';
import { useApi, useForm, useDebounced, invalidateAll } from '../lib/useApi.js';
import { Link, useNavigate } from '../lib/router.jsx';
import { PageHeader, Button, Card, Modal, Field, Select, Spinner, ErrorBox, Empty, Badge, Menu, useUi, handleFormError } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { fmtDate, todayStr } from '../lib/format.js';
import { CONTACT_STATUSES, TAG_COLORS } from '../../shared/constants.js';

const STATUS_TONE = { Neu: 'gray', Kontaktiert: 'blue', 'Im Gespräch': 'amber', Kunde: 'green', 'Kein Interesse': 'muted' };

export function ListsPage({ params }) {
  const navigate = useNavigate();
  const lists = useApi('/lists');
  const [listModal, setListModal] = useState(null);
  const activeId = Number(params.id) || lists.data?.lists[0]?.id || null;

  if (lists.loading && !lists.data) return <Spinner />;
  if (lists.error && !lists.data) return <ErrorBox error={lists.error} onRetry={lists.reload} />;
  const items = lists.data.lists;

  return (
    <div className="page">
      <PageHeader title="Listen" subtitle="Eigene Kontaktlisten – z. B. Ansprechpartner bei Marken, Agenturen oder Locations."
        actions={<Button variant="primary" icon="plus" onClick={() => setListModal({})}>Neue Liste</Button>} />
      {!items.length ? (
        <Card><Empty icon="note" title="Noch keine Listen" text="Leg z. B. „Food-Marken Mannheim“ an und sammle dort Ansprechpartner mit Kontaktdaten und Status."
          action={<Button variant="primary" icon="plus" onClick={() => setListModal({})}>Erste Liste anlegen</Button>} /></Card>
      ) : (
        <div className="lists-layout">
          <nav className="card lists-nav" aria-label="Listen">
            {items.map((l) => (
              <Link key={l.id} to={`/listen/${l.id}`} className={`lists-nav-item ${l.id === activeId ? 'active' : ''}`}>
                <span className={`dot dot-${l.color}`} />
                <span className="grow clamp-1">{l.name}</span>
                <span className="muted small">{l.contact_count}</span>
              </Link>
            ))}
          </nav>
          {activeId && <ListDetail key={activeId} id={activeId} onEdit={(l) => setListModal(l)} onDeleted={() => navigate('/listen')} />}
        </div>
      )}
      <ListModal list={listModal} onClose={() => setListModal(null)} onSaved={(l) => navigate(`/listen/${l.id}`)} />
    </div>
  );
}

function ListDetail({ id, onEdit, onDeleted }) {
  const { toast, confirm } = useUi();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const q = useDebounced(search, 250);
  const { data, error, loading, reload } = useApi(`/lists/${id}${qs({ q, status })}`);
  const [contact, setContact] = useState(null);
  const [importing, setImporting] = useState(false);
  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const { list, contacts } = data;

  const removeList = async () => {
    if (!(await confirm({ title: `Liste „${list.name}“ löschen?`, message: `Die Liste und alle ${list.contact_count} Kontakte darin werden dauerhaft entfernt.`, confirmLabel: 'Liste löschen', danger: true }))) return;
    try {
      await api.del(`/lists/${id}`);
      invalidateAll();
      onDeleted();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const setContactStatus = async (c, s) => {
    try {
      await api.patch(`/list-contacts/${c.id}`, { status: s, ...(s === 'Kontaktiert' ? { last_contacted_on: todayStr() } : {}) });
      invalidateAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="stack-lg lists-main">
      <Card padded={false}
        title={<span className="row"><span className={`dot dot-${list.color}`} />{list.name}</span>}
        subtitle={list.description || `${list.contact_count} Kontakte`}
        actions={<div className="row">
          <Button size="sm" variant="primary" icon="plus" onClick={() => setContact({})}>Kontakt</Button>
          <Menu trigger={<button className="icon-btn icon-btn-bordered" aria-label="Weitere Aktionen"><Icon name="more" size={16} /></button>} items={[
            { label: 'Liste bearbeiten', icon: 'edit', onClick: () => onEdit(list) },
            { label: 'CSV importieren', icon: 'upload', onClick: () => setImporting(true) },
            { label: 'Als CSV exportieren', icon: 'download', onClick: () => { window.location.href = `/api/lists/${id}/export.csv`; } },
            { label: 'Liste löschen', icon: 'trash', danger: true, onClick: removeList },
          ]} />
        </div>}>
        <div className="toolbar card-pad lists-toolbar">
          <div className="search-input grow">
            <Icon name="search" size={16} />
            <input className="input" placeholder="Firma, Name, Ort, E-Mail…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Alle Status" options={CONTACT_STATUSES} />
        </div>
        {!contacts.length ? (
          <Empty icon="users" title={search || status ? 'Keine Treffer' : 'Noch keine Kontakte'} text={search || status ? 'Filter anpassen.' : 'Kontakte einzeln hinzufügen oder per CSV importieren.'} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Firma</th><th>Ansprechpartner</th><th>Kontakt</th><th>Ort</th><th>Status</th><th>Notizen</th><th>Zuletzt</th></tr></thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <button className="link strong text-left" onClick={() => setContact(c)} title="Bearbeiten">{c.company || c.name || '–'}</button>
                      <div className="small muted">
                        {c.website && <a className="link" href={/^https?:/.test(c.website) ? c.website : `https://${c.website}`} target="_blank" rel="noopener noreferrer">Website</a>}
                        {c.website && c.instagram && ' · '}
                        {c.instagram && <a className="link" href={`https://instagram.com/${c.instagram.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer">@{c.instagram.replace(/^@/, '')}</a>}
                      </div>
                    </td>
                    <td><div>{c.name || '–'}</div>{c.position && <div className="small muted">{c.position}</div>}</td>
                    <td className="small">
                      {c.email && <div><a className="link" href={`mailto:${c.email}`}>{c.email}</a></div>}
                      {c.phone && <div><a className="link" href={`tel:${c.phone}`}>{c.phone}</a></div>}
                      {!c.email && !c.phone && <span className="muted">–</span>}
                    </td>
                    <td>{c.city || '–'}</td>
                    <td>
                      <select className={`status-select badge badge-${STATUS_TONE[c.status]}`} value={c.status} onChange={(e) => setContactStatus(c, e.target.value)} aria-label="Status">
                        {CONTACT_STATUSES.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="list-notes">{c.notes ? <div className="pre-wrap small">{c.notes}</div> : <button className="link small" onClick={() => setContact(c)}>+ Notiz</button>}</td>
                    <td className="nowrap muted small">{c.last_contacted_on ? fmtDate(c.last_contacted_on) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <ContactModal listId={id} contact={contact} onClose={() => setContact(null)} />
      <ImportModal listId={id} open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}

function ListModal({ list, onClose, onSaved }) {
  const { toast } = useUi();
  const f = useForm({});
  const [saving, setSaving] = useState(false);
  const isEdit = !!list?.id;
  useEffect(() => {
    if (!list) return;
    f.setErrors({});
    f.setValues({ name: list.name || '', description: list.description || '', color: list.color || 'blue' });
  }, [list]); // eslint-disable-line
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = isEdit ? await api.patch(`/lists/${list.id}`, f.values) : await api.post('/lists', f.values);
      invalidateAll();
      toast('Gespeichert.');
      onClose();
      onSaved?.(r.list);
    } catch (err) {
      handleFormError(err, f.setErrors, toast);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open={!!list} onClose={onClose} title={isEdit ? 'Liste bearbeiten' : 'Neue Liste'}
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" type="submit" form="list-form" loading={saving}>Speichern</Button></>}>
      <form id="list-form" className="stack" onSubmit={save}>
        <Field label="Name" required error={f.errors.name}><input className="input" value={f.values.name || ''} onChange={f.set('name')} placeholder="z. B. Food-Marken Mannheim" autoFocus /></Field>
        <Field label="Beschreibung" error={f.errors.description}><textarea className="input" rows={2} value={f.values.description || ''} onChange={f.set('description')} /></Field>
        <Field label="Farbe">
          <div className="color-pick">
            {TAG_COLORS.map((c) => (
              <button key={c} type="button" className={`color-swatch dot-${c} ${f.values.color === c ? 'active' : ''}`} onClick={() => f.setValues((v) => ({ ...v, color: c }))} aria-label={c} />
            ))}
          </div>
        </Field>
      </form>
    </Modal>
  );
}

function ContactModal({ listId, contact, onClose }) {
  const { toast, confirm } = useUi();
  const f = useForm({});
  const [saving, setSaving] = useState(false);
  const isEdit = !!contact?.id;
  useEffect(() => {
    if (!contact) return;
    f.setErrors({});
    const keys = ['company', 'name', 'position', 'email', 'phone', 'website', 'instagram', 'city', 'notes'];
    f.setValues({ ...Object.fromEntries(keys.map((k) => [k, contact[k] || ''])), status: contact.status || 'Neu', last_contacted_on: contact.last_contacted_on ? String(contact.last_contacted_on).slice(0, 10) : '' });
  }, [contact]); // eslint-disable-line
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (isEdit) await api.patch(`/list-contacts/${contact.id}`, f.values);
      else await api.post(`/lists/${listId}/contacts`, f.values);
      invalidateAll();
      toast('Gespeichert.');
      onClose();
    } catch (err) {
      handleFormError(err, f.setErrors, toast);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Kontakt entfernen?', message: `${contact.name || contact.company} wird aus der Liste gelöscht.`, confirmLabel: 'Entfernen', danger: true }))) return;
    try {
      await api.del(`/list-contacts/${contact.id}`);
      invalidateAll();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const F = (k, label, props = {}) => (
    <Field label={label} error={f.errors[k]} className={props.span ? 'span-2' : ''}>
      <input className="input" type={props.type || 'text'} value={f.values[k] || ''} onChange={f.set(k)} placeholder={props.placeholder} />
    </Field>
  );
  return (
    <Modal open={!!contact} onClose={onClose} title={isEdit ? 'Kontakt bearbeiten' : 'Neuer Kontakt'} size="lg"
      footer={<>
        {isEdit && <Button variant="ghost-danger" icon="trash" onClick={remove} className="mr-auto">Entfernen</Button>}
        <Button onClick={onClose}>Abbrechen</Button>
        <Button variant="primary" type="submit" form="contact-form" loading={saving}>Speichern</Button>
      </>}>
      <form id="contact-form" className="form-grid" onSubmit={save}>
        {F('company', 'Firma')}
        {F('name', 'Ansprechpartner')}
        {F('position', 'Position', { placeholder: 'z. B. Marketing, Inhaber' })}
        {F('city', 'Ort')}
        {F('email', 'E-Mail', { type: 'email' })}
        {F('phone', 'Telefon', { type: 'tel' })}
        {F('website', 'Website', { placeholder: 'www.…' })}
        {F('instagram', 'Instagram', { placeholder: '@…' })}
        <Field label="Status" error={f.errors.status}><Select value={f.values.status} onChange={f.set('status')} options={CONTACT_STATUSES} /></Field>
        {F('last_contacted_on', 'Zuletzt kontaktiert', { type: 'date' })}
        <Field label="Notizen" error={f.errors.notes} className="span-2"><textarea className="input" rows={3} value={f.values.notes || ''} onChange={f.set('notes')} /></Field>
      </form>
    </Modal>
  );
}

function ImportModal({ listId, open, onClose }) {
  const { toast } = useUi();
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setFile(null); setResult(null); } }, [open]);
  const run = async (e) => {
    e.preventDefault();
    if (!file) return;
    setSaving(true);
    try {
      const buf = await file.arrayBuffer();
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('windows-1252').decode(buf); }
      const r = await api.post(`/lists/${listId}/import`, { csv: text });
      setResult(r);
      invalidateAll();
      toast(`${r.imported} Kontakte importiert.`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Kontakte aus CSV importieren"
      footer={<><Button onClick={onClose}>{result ? 'Fertig' : 'Abbrechen'}</Button>{!result && <Button variant="primary" type="submit" form="import-form" loading={saving} disabled={!file}>Importieren</Button>}</>}>
      <form id="import-form" className="stack" onSubmit={run}>
        <p className="small muted">Erste Zeile = Spaltennamen. Erkannt werden: <strong>Firma, Ansprechpartner, Position, E-Mail, Telefon, Website, Instagram, Ort, Status, Notizen</strong>. Trennzeichen ; oder , – Excel- und Google-Sheets-Exporte funktionieren.</p>
        <label className={`dropzone ${file ? 'has-file' : ''}`}>
          <input type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files[0] || null); setResult(null); }} />
          <Icon name={file ? 'file' : 'upload'} size={20} />
          {file ? <span><strong>{file.name}</strong></span> : <span>CSV-Datei auswählen</span>}
        </label>
        {result && (
          <div className="stack">
            <Badge tone="green">{result.imported} importiert</Badge>
            {result.errors.length > 0 && <ul className="small tone-red">{result.errors.map((x) => <li key={x}>{x}</li>)}</ul>}
          </div>
        )}
      </form>
    </Modal>
  );
}
