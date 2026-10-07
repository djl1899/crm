import { useEffect, useRef, useState } from 'react';
import { api, qs } from '../lib/api.js';
import { useApi, useForm, invalidateAll, useDebounced } from '../lib/useApi.js';
import { useLookups, useAuth } from '../lib/auth.jsx';
import { toLocalInput, fmtBytes, fmtDateTime } from '../lib/format.js';
import { renderTemplate } from '../lib/templates.js';
import { Modal, Button, Field, Select, TagChip, useUi, handleFormError } from './ui.jsx';
import { Icon } from './Icon.jsx';
import {
  OUTREACH_CHANNELS, OUTREACH_STATUSES, OUTREACH_RESULT_SUGGESTIONS, COLLAB_STATUSES, INVOICE_STATUSES,
  TASK_STATUSES, TASK_PRIORITIES, DOCUMENT_CATEGORIES, CREATOR_VISIBLE_DEFAULT, MAX_UPLOAD_BYTES, ALLOWED_UPLOAD_TYPES, PAYOUT_STATUSES,
} from '../../shared/constants.js';

const fmtMoneyLocal = (n) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number.isFinite(n) ? n : 0);

const ACCEPT = Object.values(ALLOWED_UPLOAD_TYPES).flat().map((e) => '.' + e).join(',');

// Löschen-Button für Bearbeiten-Modals
function DeleteButton({ label, path, message, onDone }) {
  const { confirm, toast } = useUi();
  const [busy, setBusy] = useState(false);
  const del = async () => {
    const ok = await confirm({ title: `${label} löschen?`, message, warning: 'Dieser Vorgang kann nicht rückgängig gemacht werden.', confirmLabel: 'Löschen', danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await api.del(path);
      invalidateAll();
      toast(`${label} gelöscht.`);
      onDone();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return <Button variant="ghost-danger" icon="trash" onClick={del} loading={busy} className="mr-auto">Löschen</Button>;
}

// ---------- Auswahlfelder ----------
export function UserSelect({ value, onChange, placeholder = '– niemand –', includeInactive = false, ...rest }) {
  const { users } = useLookups();
  const list = users.filter((u) => includeInactive || u.is_active || u.id === Number(value));
  return (
    <Select
      value={value ?? ''}
      onChange={onChange}
      placeholder={placeholder}
      options={list.map((u) => ({ value: String(u.id), label: u.name + (u.is_active ? '' : ' (inaktiv)') }))}
      {...rest}
    />
  );
}

/** Durchsuchbare Creator-Auswahl (skaliert auch bei tausenden Creatorn) */
export function CreatorPicker({ value, onChange, initialLabel = '', autoFocus }) {
  const [term, setTerm] = useState(initialLabel);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const debounced = useDebounced(term, 200);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.get('/creators/options' + qs({ q: debounced })).then((r) => !cancelled && setItems(r.items.slice(0, 50))).catch(() => {});
    return () => { cancelled = true; };
  }, [debounced, open]);

  useEffect(() => {
    const onDoc = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="combo" ref={ref}>
      <input
        className="input"
        value={term}
        autoFocus={autoFocus}
        placeholder="Creator suchen…"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
          if (value) onChange(null, '');
        }}
      />
      {open && (
        <div className="combo-list">
          {!items.length && <div className="combo-empty">Keine Creator gefunden</div>}
          {items.map((c) => (
            <button
              type="button"
              key={c.id}
              className={`combo-item ${Number(value) === c.id ? 'selected' : ''}`}
              onClick={() => {
                onChange(c.id, c.display_name);
                setTerm(c.display_name);
                setOpen(false);
              }}
            >
              {c.display_name}
              {c.status === 'Archiviert' && <span className="muted"> (archiviert)</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CollaborationSelect({ creatorId, value, onChange, placeholder = '– keine –' }) {
  const { data } = useApi(creatorId ? '/collaborations' + qs({ creator_id: creatorId, page_size: 200 }) : null);
  const items = data?.items || [];
  return (
    <Select
      value={value ?? ''}
      onChange={onChange}
      disabled={!creatorId}
      placeholder={creatorId ? placeholder : 'Zuerst Creator wählen'}
      options={items.map((c) => ({ value: String(c.id), label: `${c.brand}${c.campaign_name ? ' – ' + c.campaign_name : ''} (${c.status})` }))}
    />
  );
}

export function TagPicker({ value = [], onChange }) {
  const { tags } = useLookups();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const selected = tags.filter((t) => value.includes(t.id));
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="tagpicker" ref={ref}>
      <div className="tagpicker-box" onClick={() => setOpen(true)}>
        {selected.map((t) => (
          <TagChip key={t.id} tag={t} onRemove={(e) => { e.stopPropagation(); toggle(t.id); }} />
        ))}
        <button type="button" className="tagpicker-add">
          <Icon name="plus" size={13} /> Tag
        </button>
      </div>
      {open && (
        <div className="combo-list">
          {!tags.length && <div className="combo-empty">Noch keine Tags – in den Einstellungen anlegen.</div>}
          {tags.map((t) => (
            <button type="button" key={t.id} className="combo-item combo-check" onClick={() => toggle(t.id)}>
              <span className={`check ${value.includes(t.id) ? 'on' : ''}`}>{value.includes(t.id) && <Icon name="check" size={12} />}</span>
              <TagChip tag={t} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Outreach: Kontakt erfassen / bearbeiten ----------
export function OutreachModal({ open, onClose, creator, activity }) {
  const { user } = useAuth();
  const { toast } = useUi();
  const [saving, setSaving] = useState(false);
  const f = useForm({});
  useEffect(() => {
    if (!open) return;
    f.setErrors({});
    f.setValues({
      creator_id: activity?.creator_id || creator?.id || null,
      creator_label: activity?.creator_name || creator?.display_name || '',
      occurred_at: toLocalInput(activity?.occurred_at),
      channel: activity?.channel || 'Instagram DM',
      user_id: String(activity?.user_id || user.id),
      subject: activity?.subject || '',
      message: activity?.message || '',
      result: activity?.result || '',
      follow_up_date: activity?.follow_up_date || '',
      outreach_status: '',
    });
  }, [open]); // eslint-disable-line

  const templates = useApi(open && !activity ? '/templates' : null);
  const [tplId, setTplId] = useState('');
  const [igHandle, setIgHandle] = useState(null);
  useEffect(() => { if (open) { setTplId(''); setIgHandle(null); } }, [open]);
  const applyTemplate = async (id) => {
    setTplId(id);
    const tpl = (templates.data?.items || []).find((t) => String(t.id) === String(id));
    if (!tpl) return;
    const cid = f.values.creator_id;
    let ctx = { me: user };
    if (cid) {
      try {
        const prof = await api.get(`/creators/${cid}`);
        ctx = { creator: prof.creator, socials: prof.socials, me: user };
        setIgHandle(prof.socials?.instagram?.username || null);
      } catch { /* ignorieren */ }
    }
    f.setValues((x) => ({
      ...x,
      subject: tpl.subject ? renderTemplate(tpl.subject, ctx) : x.subject || tpl.name,
      message: renderTemplate(tpl.body, ctx),
      channel: tpl.channel || x.channel,
    }));
  };
  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(f.values.message || '');
      toast('Nachricht kopiert – jetzt einfügen und senden.');
    } catch {
      toast('Kopieren nicht möglich – bitte Text markieren und kopieren.', 'error');
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const { creator_label, ...vals } = f.values;
    const payload = { ...vals, occurred_at: new Date(vals.occurred_at).toISOString() };
    try {
      if (activity) {
        delete payload.creator_id;
        delete payload.outreach_status;
        await api.patch(`/outreach/${activity.id}`, payload);
        toast('Kontakt aktualisiert.');
      } else {
        await api.post('/outreach', payload);
        toast('Kontakt erfasst.');
      }
      invalidateAll();
      onClose();
    } catch (err) {
      handleFormError(err, f.setErrors, toast);
    } finally {
      setSaving(false);
    }
  };

  const v = f.values;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={activity ? 'Kontakt bearbeiten' : 'Kontakt erfassen'}
      footer={
        <>
          {activity && <DeleteButton label="Kontakt" path={`/outreach/${activity.id}`} message="Der Eintrag wird aus dem Kontaktverlauf entfernt." onDone={onClose} />}
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" type="submit" form="outreach-form" loading={saving}>Speichern</Button>
        </>
      }
    >
      <form id="outreach-form" className="form-grid" onSubmit={submit}>
        {!activity && (templates.data?.items || []).length > 0 && (
          <Field label="Vorlage verwenden" className="span-2" hint={!v.creator_id ? 'Tipp: zuerst den Creator wählen, dann werden {Vorname} usw. ausgefüllt.' : undefined}>
            <Select value={tplId} onChange={(e) => applyTemplate(e.target.value)} placeholder="– keine Vorlage –"
              options={(templates.data?.items || []).map((t) => ({ value: String(t.id), label: t.name + (t.channel ? ` (${t.channel})` : '') }))} />
          </Field>
        )}
        {!creator && !activity && (
          <Field label="Creator" required error={f.errors.creator_id} className="span-2">
            <CreatorPicker value={v.creator_id} autoFocus onChange={(id, label) => f.setValues((x) => ({ ...x, creator_id: id, creator_label: label }))} />
          </Field>
        )}
        <Field label="Datum & Uhrzeit" required error={f.errors.occurred_at}>
          <input type="datetime-local" className="input" value={v.occurred_at || ''} onChange={f.set('occurred_at')} required />
        </Field>
        <Field label="Kontaktkanal" required error={f.errors.channel}>
          <Select value={v.channel} onChange={f.set('channel')} options={OUTREACH_CHANNELS} />
        </Field>
        <Field label="Benutzer / Manager" error={f.errors.user_id}>
          <UserSelect value={v.user_id} onChange={f.set('user_id')} placeholder={undefined} includeInactive />
        </Field>
        <Field label="Ergebnis" error={f.errors.result}>
          <input className="input" list="outreach-results" value={v.result || ''} onChange={f.set('result')} placeholder="z. B. Erstkontakt" />
          <datalist id="outreach-results">{OUTREACH_RESULT_SUGGESTIONS.map((r) => <option key={r} value={r} />)}</datalist>
        </Field>
        <Field label="Betreff" error={f.errors.subject} className="span-2">
          <input className="input" value={v.subject || ''} onChange={f.set('subject')} placeholder="z. B. Kampagne X angefragt" />
        </Field>
        <Field label="Nachricht / Notiz" error={f.errors.message} className="span-2">
          <textarea className="input" rows={tplId ? 8 : 4} value={v.message || ''} onChange={f.set('message')} />
          {v.message && (
            <div className="msg-actions">
              <Button size="sm" icon="note" onClick={copyMessage}>Nachricht kopieren</Button>
              {igHandle && v.channel === 'Instagram DM' && (
                <a className="btn btn-secondary btn-sm" href={`https://ig.me/m/${igHandle}`} target="_blank" rel="noopener noreferrer">
                  <Icon name="instagram" size={15} /> <span>DM an @{igHandle} öffnen</span>
                </a>
              )}
            </div>
          )}
        </Field>
        <Field label="Nächster Follow-up-Termin" error={f.errors.follow_up_date} hint="Optional – erscheint dann im Dashboard.">
          <input type="date" className="input" value={v.follow_up_date || ''} onChange={f.set('follow_up_date')} />
        </Field>
        {!activity && (
          <Field label="Outreach-Status setzen" hint="Leer lassen = automatisch">
            <Select value={v.outreach_status} onChange={f.set('outreach_status')} placeholder="– automatisch –" options={OUTREACH_STATUSES} />
          </Field>
        )}
      </form>
    </Modal>
  );
}

// ---------- Kooperation ----------
const COLLAB_EXTRA_FIELDS = ['contact_name', 'contact_email', 'usage_rights', 'exclusivity', 'briefing_date', 'approval_date', 'publish_date', 'published_on', 'invoice_due_date', 'payout_date'];

// Nachrichten mit dem Creator direkt am Deal
export function CollabMessages({ id }) {
  const { toast } = useUi();
  const { data, reload } = useApi(`/collaborations/${id}/messages`);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      await api.post(`/collaborations/${id}/messages`, { body });
      setBody('');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSending(false);
    }
  };
  const items = data?.items || [];
  return (
    <div className="collab-messages">
      <div className="form-section">Nachrichten mit dem Creator</div>
      <div className="thread">
        {!items.length && <p className="small muted">Noch keine Nachrichten. Der Creator sieht alles hier in seinem Bereich an diesem Deal.</p>}
        {items.map((m) => (
          <div key={m.id} className={`msg ${m.from_creator ? '' : 'mine'}`}>
            <div className="msg-meta">{m.author || '–'}{m.from_creator ? ' (Creator)' : ''} · {fmtDateTime(m.created_at)}</div>
            <div className="msg-body pre-wrap">{m.body}</div>
          </div>
        ))}
      </div>
      <div className="msg-form">
        <textarea className="input" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Nachricht an den Creator…"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }} />
        <Button variant="primary" icon="send" onClick={send} loading={sending} disabled={!body.trim()}>Senden</Button>
      </div>
    </div>
  );
}

export function CollaborationModal({ open, onClose, creator, collaboration, onSaved }) {
  const { toast } = useUi();
  const [saving, setSaving] = useState(false);
  const f = useForm({});
  useEffect(() => {
    if (!open) return;
    const c = collaboration || {};
    f.setErrors({});
    f.setValues({
      creator_id: c.creator_id || creator?.id || null,
      creator_label: c.creator_name || creator?.display_name || '',
      brand: c.brand || '', campaign_name: c.campaign_name || '', start_date: c.start_date || '', end_date: c.end_date || '',
      status: c.status || 'Anfrage', platform: c.platform || '', description: c.description || '', deliverables: c.deliverables || '',
      deadline: c.deadline || '', fee: c.fee ?? '', invoice_status: c.invoice_status || 'Nicht erstellt', notes: c.notes || '',
      commission_rate: c.commission_rate ?? '', payout_status: c.payout_status || 'Offen',
      ...Object.fromEntries(COLLAB_EXTRA_FIELDS.map((k) => [k, c[k] ? String(c[k]).slice(0, k.endsWith('_date') || k === 'published_on' ? 10 : undefined) : ''])),
    });
  }, [open]); // eslint-disable-line

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const { creator_label, ...payload } = f.values;
    try {
      if (collaboration) await api.patch(`/collaborations/${collaboration.id}`, payload);
      else await api.post('/collaborations', payload);
      toast(collaboration ? 'Kooperation gespeichert.' : 'Kooperation erstellt.');
      invalidateAll();
      onSaved?.();
      onClose();
    } catch (err) {
      handleFormError(err, f.setErrors, toast);
    } finally {
      setSaving(false);
    }
  };
  const v = f.values;
  const settings = useApi(open ? '/settings' : null);
  const globalRate = settings.data?.settings.default_commission_rate ?? 20;
  const fallbackRate = Number(
    (collaboration ? collaboration.creator_commission_rate : creator?.commission_rate) ?? globalRate
  );
  const fee = Number(v.fee) || 0;
  const rate = v.commission_rate === '' || v.commission_rate === null || v.commission_rate === undefined ? Number(fallbackRate) : Number(v.commission_rate);
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={collaboration ? `Kooperation #${collaboration.id} bearbeiten` : 'Neue Kooperation'}
      footer={
        <>
          {collaboration && <DeleteButton label="Kooperation" path={`/collaborations/${collaboration.id}`} message="Zugehörige Aufgaben und Dateien bleiben erhalten, verlieren aber die Verknüpfung." onDone={onClose} />}
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" type="submit" form="collab-form" loading={saving}>Speichern</Button>
        </>
      }
    >
      <form id="collab-form" className="form-grid" onSubmit={submit}>
        {!creator && (
          <Field label="Creator" required error={f.errors.creator_id} className="span-2">
            <CreatorPicker value={v.creator_id} initialLabel={v.creator_label} onChange={(id, label) => f.setValues((x) => ({ ...x, creator_id: id, creator_label: label }))} />
          </Field>
        )}
        <Field label="Brand" required error={f.errors.brand}>
          <input className="input" value={v.brand || ''} onChange={f.set('brand')} required autoFocus />
        </Field>
        <Field label="Kampagnenname" error={f.errors.campaign_name}>
          <input className="input" value={v.campaign_name || ''} onChange={f.set('campaign_name')} />
        </Field>
        <Field label="Status" error={f.errors.status}>
          <Select value={v.status} onChange={f.set('status')} options={COLLAB_STATUSES} />
        </Field>
        <Field label="Plattform" error={f.errors.platform}>
          <input className="input" list="collab-platforms" value={v.platform || ''} onChange={f.set('platform')} placeholder="Instagram, TikTok…" />
          <datalist id="collab-platforms">{['Instagram', 'TikTok', 'Instagram + TikTok', 'Sonstiges'].map((p) => <option key={p} value={p} />)}</datalist>
        </Field>
        <Field label="Startdatum" error={f.errors.start_date}>
          <input type="date" className="input" value={v.start_date || ''} onChange={f.set('start_date')} />
        </Field>
        <Field label="Enddatum" error={f.errors.end_date}>
          <input type="date" className="input" value={v.end_date || ''} onChange={f.set('end_date')} min={v.start_date || undefined} />
        </Field>
        <Field label="Deadline" error={f.errors.deadline}>
          <input type="date" className="input" value={v.deadline || ''} onChange={f.set('deadline')} />
        </Field>
        <Field label="Vergütung (€)" error={f.errors.fee}>
          <input type="number" min="0" step="0.01" className="input" value={v.fee ?? ''} onChange={f.set('fee')} placeholder="0" />
        </Field>
        <Field label="Rechnungsstatus (Brand)" error={f.errors.invoice_status}>
          <Select value={v.invoice_status} onChange={f.set('invoice_status')} options={INVOICE_STATUSES} />
        </Field>
        <Field label="Agenturprovision (%)" error={f.errors.commission_rate}
          hint={`Leer = Standard (${fallbackRate} %). Provision ${fmtMoneyLocal(fee * rate / 100)} · an Creator ${fmtMoneyLocal(fee - fee * rate / 100)}`}>
          <input type="number" min="0" max="100" step="0.5" className="input" value={v.commission_rate ?? ''} onChange={f.set('commission_rate')} placeholder={`${fallbackRate}`} />
        </Field>
        <Field label="Auszahlung an Creator" error={f.errors.payout_status}>
          <Select value={v.payout_status} onChange={f.set('payout_status')} options={PAYOUT_STATUSES} />
        </Field>
        <Field label="Vereinbarte Inhalte (Deliverables)" error={f.errors.deliverables} className="span-2">
          <textarea className="input" rows={2} value={v.deliverables || ''} onChange={f.set('deliverables')} placeholder="z. B. 2 Reels, 3 Stories" />
        </Field>
        <Field label="Kampagnenbeschreibung" error={f.errors.description} className="span-2" hint="Sieht der Creator im Creator-Bereich.">
          <textarea className="input" rows={3} value={v.description || ''} onChange={f.set('description')} />
        </Field>
        <div className="form-section span-2">Ansprechpartner & Rechte</div>
        <Field label="Ansprechpartner (Marke)" error={f.errors.contact_name}>
          <input className="input" value={v.contact_name || ''} onChange={f.set('contact_name')} />
        </Field>
        <Field label="E-Mail Ansprechpartner" error={f.errors.contact_email}>
          <input type="email" className="input" value={v.contact_email || ''} onChange={f.set('contact_email')} />
        </Field>
        <Field label="Nutzungsrechte" error={f.errors.usage_rights}>
          <textarea className="input" rows={2} value={v.usage_rights || ''} onChange={f.set('usage_rights')} placeholder="z. B. 6 Monate organisch, keine Paid Ads" />
        </Field>
        <Field label="Exklusivität" error={f.errors.exclusivity}>
          <textarea className="input" rows={2} value={v.exclusivity || ''} onChange={f.set('exclusivity')} placeholder="z. B. 4 Wochen keine Getränkemarke" />
        </Field>
        <div className="form-section span-2">Termine (erscheinen im Kalender des Creators)</div>
        {[['briefing_date', 'Briefing-Termin'], ['approval_date', 'Freigabe bis'], ['publish_date', 'Veröffentlichung geplant'], ['published_on', 'Veröffentlicht am'],
          ['invoice_due_date', 'Zahlung fällig am'], ['payout_date', 'An Creator ausgezahlt am']].map(([k, label]) => (
          <Field key={k} label={label} error={f.errors[k]}>
            <input type="date" className="input" value={v[k] || ''} onChange={f.set(k)} />
          </Field>
        ))}
        {collaboration?.content_submitted_at && (
          <div className="span-2 submitted-box">
            <div className="strong small">Vom Creator eingereicht · {fmtDateTime(collaboration.content_submitted_at)}</div>
            {(collaboration.content_links || '').split('\n').filter(Boolean).map((l) => (
              <a key={l} href={l} target="_blank" rel="noopener noreferrer" className="link small break">{l}</a>
            ))}
            {collaboration.content_note && <div className="small muted pre-wrap">{collaboration.content_note}</div>}
          </div>
        )}
        <Field label="Interne Notizen" hint="Nur fürs Team – Creator sehen das nicht." error={f.errors.notes} className="span-2">
          <textarea className="input" rows={2} value={v.notes || ''} onChange={f.set('notes')} />
        </Field>
      </form>
      {collaboration && <CollabMessages id={collaboration.id} />}
    </Modal>
  );
}

// ---------- Aufgabe ----------
export function TaskModal({ open, onClose, task, defaults = {} }) {
  const { user } = useAuth();
  const { toast } = useUi();
  const [saving, setSaving] = useState(false);
  const f = useForm({});
  useEffect(() => {
    if (!open) return;
    const t = task || {};
    f.setErrors({});
    f.setValues({
      title: t.title || '', description: t.description || '',
      creator_id: t.creator_id || defaults.creator?.id || null,
      creator_label: t.creator_name || defaults.creator?.display_name || '',
      collaboration_id: t.collaboration_id ? String(t.collaboration_id) : defaults.collaborationId ? String(defaults.collaborationId) : '',
      assignee_id: t.id ? (t.assignee_id ? String(t.assignee_id) : '') : String(user.id),
      priority: t.priority || 'Normal', status: t.status || 'Offen', due_date: t.due_date || '', notes: t.notes || '',
    });
  }, [open]); // eslint-disable-line

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const { creator_label, ...payload } = f.values;
    try {
      if (task) await api.patch(`/tasks/${task.id}`, payload);
      else await api.post('/tasks', payload);
      toast(task ? 'Aufgabe gespeichert.' : 'Aufgabe erstellt.');
      invalidateAll();
      onClose();
    } catch (err) {
      handleFormError(err, f.setErrors, toast);
    } finally {
      setSaving(false);
    }
  };
  const v = f.values;
  const fixedCreator = !!defaults.creator && !task;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}
      footer={
        <>
          {task && <DeleteButton label="Aufgabe" path={`/tasks/${task.id}`} message={`„${task.title}“ wird gelöscht.`} onDone={onClose} />}
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" type="submit" form="task-form" loading={saving}>Speichern</Button>
        </>
      }
    >
      <form id="task-form" className="form-grid" onSubmit={submit}>
        <Field label="Titel" required error={f.errors.title} className="span-2">
          <input className="input" value={v.title || ''} onChange={f.set('title')} required autoFocus />
        </Field>
        {!fixedCreator && (
          <Field label="Creator" error={f.errors.creator_id}>
            <CreatorPicker value={v.creator_id} initialLabel={v.creator_label} onChange={(id, label) => f.setValues((x) => ({ ...x, creator_id: id, creator_label: label, collaboration_id: '' }))} />
          </Field>
        )}
        <Field label="Kooperation" error={f.errors.collaboration_id} className={fixedCreator ? 'span-2' : ''}>
          <CollaborationSelect creatorId={v.creator_id} value={v.collaboration_id} onChange={f.set('collaboration_id')} />
        </Field>
        <Field label="Verantwortlicher" error={f.errors.assignee_id}>
          <UserSelect value={v.assignee_id} onChange={f.set('assignee_id')} />
        </Field>
        <Field label="Fälligkeitsdatum" error={f.errors.due_date}>
          <input type="date" className="input" value={v.due_date || ''} onChange={f.set('due_date')} />
        </Field>
        <Field label="Priorität" error={f.errors.priority}>
          <Select value={v.priority} onChange={f.set('priority')} options={TASK_PRIORITIES} />
        </Field>
        <Field label="Status" error={f.errors.status}>
          <Select value={v.status} onChange={f.set('status')} options={TASK_STATUSES} />
        </Field>
        <Field label="Beschreibung" error={f.errors.description} className="span-2">
          <textarea className="input" rows={3} value={v.description || ''} onChange={f.set('description')} />
        </Field>
        <Field label="Notizen" error={f.errors.notes} className="span-2">
          <textarea className="input" rows={2} value={v.notes || ''} onChange={f.set('notes')} />
        </Field>
        {task && (
          <p className="muted small span-2">
            Erstellt {task.created_by_name ? `von ${task.created_by_name} ` : ''}am {new Date(task.created_at).toLocaleDateString('de-DE')}
            {task.completed_at && ` · erledigt am ${new Date(task.completed_at).toLocaleDateString('de-DE')}`}
          </p>
        )}
      </form>
    </Modal>
  );
}

// ---------- Datei-Upload ----------
export function UploadModal({ open, onClose, creator, defaultCategory = 'Sonstige Dokumente', collaborationId }) {
  const { toast } = useUi();
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState(null);
  const f = useForm({});
  useEffect(() => {
    if (!open) return;
    setFile(null);
    f.setErrors({});
    f.setValues({
      creator_id: creator?.id || null, creator_label: creator?.display_name || '',
      category: defaultCategory, collaboration_id: collaborationId ? String(collaborationId) : '',
      visible_to_creator: CREATOR_VISIBLE_DEFAULT.includes(defaultCategory),
    });
  }, [open]); // eslint-disable-line

  const submit = async (e) => {
    e.preventDefault();
    if (!file) return f.setErrors({ file: 'Bitte eine Datei auswählen.' });
    if (file.size > MAX_UPLOAD_BYTES) return f.setErrors({ file: `Die Datei ist zu groß (max. ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).` });
    if (!f.values.creator_id) return f.setErrors({ creator_id: 'Bitte einen Creator wählen.' });
    const fd = new FormData();
    fd.append('file', file);
    fd.append('creator_id', f.values.creator_id);
    fd.append('category', f.values.category);
    if (f.values.collaboration_id) fd.append('collaboration_id', f.values.collaboration_id);
    fd.append('visible_to_creator', f.values.visible_to_creator ? 'true' : 'false');
    setSaving(true);
    try {
      await api.upload('/documents', fd);
      toast('Datei hochgeladen.');
      invalidateAll();
      onClose();
    } catch (err) {
      handleFormError(err, f.setErrors, toast);
    } finally {
      setSaving(false);
    }
  };
  const v = f.values;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Datei hochladen"
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" type="submit" form="upload-form" loading={saving} icon="upload">Hochladen</Button>
        </>
      }
    >
      <form id="upload-form" className="form-grid" onSubmit={submit}>
        {!creator && (
          <Field label="Creator" required error={f.errors.creator_id} className="span-2">
            <CreatorPicker value={v.creator_id} onChange={(id, label) => f.setValues((x) => ({ ...x, creator_id: id, creator_label: label, collaboration_id: '' }))} />
          </Field>
        )}
        <Field label="Kategorie" required error={f.errors.category}>
          <Select value={v.category} onChange={(e) => f.setValues((x) => ({ ...x, category: e.target.value, visible_to_creator: CREATOR_VISIBLE_DEFAULT.includes(e.target.value) }))} options={DOCUMENT_CATEGORIES} />
        </Field>
        <Field label="Kooperation (optional)" error={f.errors.collaboration_id}>
          <CollaborationSelect creatorId={v.creator_id} value={v.collaboration_id} onChange={f.set('collaboration_id')} />
        </Field>
        <Field label="Datei" required error={f.errors.file} className="span-2" hint={`PDF, Bilder, Office-Dokumente, TXT/CSV, ZIP · max. ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`}>
          <label className={`dropzone ${file ? 'has-file' : ''}`}>
            <input type="file" accept={ACCEPT} onChange={(e) => { setFile(e.target.files[0] || null); f.setErrors({}); }} />
            <Icon name={file ? 'file' : 'upload'} size={22} />
            {file ? (
              <span><strong>{file.name}</strong> · {fmtBytes(file.size)}</span>
            ) : (
              <span>Datei auswählen oder hierher ziehen</span>
            )}
          </label>
        </Field>
        <label className="checkbox span-2">
          <input type="checkbox" checked={!!v.visible_to_creator} onChange={(e) => f.setValues((x) => ({ ...x, visible_to_creator: e.target.checked }))} />
          <span>Im Creator-Bereich sichtbar <span className="muted">– der Creator kann die Datei ansehen und herunterladen</span></span>
        </label>
      </form>
    </Modal>
  );
}
