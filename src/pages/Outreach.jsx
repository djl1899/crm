import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { api, qs } from '../lib/api.js';
import { useApi, useDebounced, invalidateAll } from '../lib/useApi.js';
import { useSearchParams, Link, useNavigate } from '../lib/router.jsx';
import { useLookups } from '../lib/auth.jsx';
import { PageHeader, Button, Select, Pagination, Spinner, ErrorBox, Empty, Segmented, Tabs, Card, Badge, IconButton, Modal, Field, useUi, handleFormError } from '../components/ui.jsx';
import { useAuth } from '../lib/auth.jsx';
import { renderTemplate } from '../lib/templates.js';
import { Icon } from '../components/Icon.jsx';
import { OutreachModal } from '../components/forms.jsx';
import { fmtDate, fmtDue, fmtDateTime } from '../lib/format.js';
import { OUTREACH_CHANNELS, TEMPLATE_PLACEHOLDERS } from '../../shared/constants.js';

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
          { key: 'templates', label: 'Vorlagen' },
        ]}
      />
      <div className="tab-panel">
        {tab === 'followups' && <FollowUps params={params} setParams={setParams} onEdit={(o) => setModal({ item: o })} />}
        {tab === 'history' && <History params={params} setParams={setParams} onEdit={(o) => setModal({ item: o })} />}
        {tab === 'templates' && <Templates />}
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

// ---------------------------------------------------------------------------
// Nachrichten-Vorlagen
// ---------------------------------------------------------------------------
const SAMPLE = {
  creator: { display_name: 'Anna Müller', first_name: 'Anna', niche: 'Fashion', city: 'Berlin' },
  socials: { instagram: { username: 'anna.style', followers: 48200 }, tiktok: { username: 'annamueller', followers: 12000 } },
};

function Templates() {
  const { data, loading } = useApi('/templates');
  const [modal, setModal] = useState(null);
  return (
    <div className="stack-lg">
      <div className="toolbar">
        <span className="muted">Vorlagen mit Platzhaltern wie {'{Vorname}'} – im Fenster „Kontakt erfassen“ auswählen, kopieren, senden.</span>
        <Button variant="primary" icon="plus" onClick={() => setModal({ item: null })}>Neue Vorlage</Button>
      </div>
      <Card padded={false}>
        {loading && !data ? <Spinner /> : !data?.items.length ? (
          <Empty icon="note" title="Noch keine Vorlagen" text="Lege z. B. „Erstkontakt“, „Nachfassen“ und „Angebot“ an."
            action={<Button variant="primary" icon="plus" onClick={() => setModal({ item: null })}>Neue Vorlage</Button>} />
        ) : (
          <ul className="tpl-list">
            {data.items.map((t) => (
              <li key={t.id} className="tpl-item" onClick={() => setModal({ item: t })}>
                <div className="with-icon"><strong>{t.name}</strong>{t.channel && <Badge tone="gray">{t.channel}</Badge>}</div>
                <div className="tpl-preview">{t.body}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <TemplateModal open={!!modal} item={modal?.item} onClose={() => setModal(null)} />
    </div>
  );
}

function TemplateModal({ open, item, onClose }) {
  const { toast, confirm } = useUi();
  const { user } = useAuth();
  const [v, setV] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [focus, setFocus] = useState('body');
  const refs = { subject: useRef(null), body: useRef(null) };
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setV({ name: item?.name || '', channel: item?.channel || '', subject: item?.subject || '', body: item?.body || '' });
  }, [open]); // eslint-disable-line
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  // Platzhalter an der Cursor-Position einfügen
  const insert = (ph) => {
    const el = refs[focus].current;
    const cur = v[focus] || '';
    const start = el ? el.selectionStart ?? cur.length : cur.length;
    const end = el ? el.selectionEnd ?? cur.length : cur.length;
    const next = cur.slice(0, start) + ph + cur.slice(end);
    flushSync(() => setV((x) => ({ ...x, [focus]: next })));
    if (el) {
      el.focus();
      el.setSelectionRange(start + ph.length, start + ph.length);
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (item) await api.patch(`/templates/${item.id}`, v);
      else await api.post('/templates', v);
      invalidateAll();
      toast('Vorlage gespeichert.');
      onClose();
    } catch (err) {
      handleFormError(err, setErrors, toast);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Vorlage löschen?', message: `„${item.name}“ wird gelöscht.`, confirmLabel: 'Löschen', danger: true }))) return;
    await api.del(`/templates/${item.id}`).catch((err) => toast(err.message, 'error'));
    invalidateAll();
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} size="lg" title={item ? 'Vorlage bearbeiten' : 'Neue Vorlage'}
      footer={<>
        {item && <Button variant="ghost-danger" icon="trash" onClick={remove} className="mr-auto">Löschen</Button>}
        <Button onClick={onClose}>Abbrechen</Button>
        <Button variant="primary" type="submit" form="tpl-form" loading={saving}>Speichern</Button>
      </>}>
      <form id="tpl-form" className="form-grid" onSubmit={submit}>
        <Field label="Name der Vorlage" required error={errors.name}>
          <input className="input" value={v.name || ''} onChange={set('name')} placeholder="z. B. Erstkontakt Instagram" required autoFocus />
        </Field>
        <Field label="Kanal" error={errors.channel}>
          <Select value={v.channel} onChange={set('channel')} placeholder="– beliebig –" options={OUTREACH_CHANNELS} />
        </Field>
        <Field label="Betreff (für E-Mails)" error={errors.subject} className="span-2">
          <input ref={refs.subject} className="input" value={v.subject || ''} onChange={set('subject')} onFocus={() => setFocus('subject')} />
        </Field>
        <Field label="Text" required error={errors.body} className="span-2">
          <textarea ref={refs.body} className="input" rows={8} value={v.body || ''} onChange={set('body')} onFocus={() => setFocus('body')} required
            placeholder={'Hey {Vorname}, wir sind LLK Management und lieben deinen {Nische}-Content …'} />
        </Field>
        <div className="span-2">
          <div className="field-label" style={{ marginBottom: 6 }}>Platzhalter einfügen (Klick)</div>
          <div className="placeholder-chips">
            {TEMPLATE_PLACEHOLDERS.map(([ph, label]) => (
              <button type="button" key={ph} className="placeholder-chip" title={label} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(ph)}>{ph}</button>
            ))}
          </div>
        </div>
        {v.body && (
          <div className="span-2">
            <div className="field-label" style={{ marginBottom: 6 }}>Vorschau (Beispiel-Creator)</div>
            <div className="suggest" style={{ whiteSpace: 'pre-wrap' }}>{renderTemplate(v.body, { ...SAMPLE, me: user })}</div>
          </div>
        )}
      </form>
    </Modal>
  );
}
