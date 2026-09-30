import { useState } from 'react';
import { api } from '../lib/api.js';
import { useApi, invalidateAll } from '../lib/useApi.js';
import { useAuth } from '../lib/auth.jsx';
import { PageHeader, Card, Button, Field, TagChip, IconButton, Spinner, Badge, useUi, handleFormError } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { TAG_COLORS } from '../../shared/constants.js';

export function SettingsPage() {
  const { user } = useAuth();
  return (
    <div className="page">
      <PageHeader title="Einstellungen" />
      <div className="grid-2 align-start">
        <div className="stack-lg">
          <ProfileCard />
          <PasswordCard />
          <TwoFactorCard />
          {user.role === 'admin' && <DemoCard />}
        </div>
        <div className="stack-lg">
          <AgencyCard />
          <DigestCard />
          <TagsCard />
        </div>
      </div>
    </div>
  );
}

function ProfileCard() {
  const { user, setUser } = useAuth();
  const { toast } = useUi();
  const [v, setV] = useState({ name: user.name, email: user.email });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await api.patch('/auth/me', v);
      setUser(r.user);
      invalidateAll();
      toast('Profil gespeichert.');
      setErrors({});
    } catch (err) {
      handleFormError(err, setErrors, toast);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card title="Mein Profil">
      <form className="stack" onSubmit={save}>
        <Field label="Name" error={errors.name}><input className="input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="E-Mail" error={errors.email}><input className="input" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        <div className="form-actions"><Button variant="primary" type="submit" loading={saving}>Speichern</Button></div>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const { toast } = useUi();
  const [v, setV] = useState({ current_password: '', new_password: '', repeat: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    if (v.new_password !== v.repeat) return setErrors({ repeat: 'Die Passwörter stimmen nicht überein.' });
    setSaving(true);
    try {
      await api.post('/auth/password', { current_password: v.current_password, new_password: v.new_password });
      toast('Passwort geändert. Andere Sitzungen wurden abgemeldet.');
      setV({ current_password: '', new_password: '', repeat: '' });
      setErrors({});
    } catch (err) {
      handleFormError(err, setErrors, toast);
    } finally {
      setSaving(false);
    }
  };
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  return (
    <Card title="Passwort ändern">
      <form className="stack" onSubmit={save}>
        <Field label="Aktuelles Passwort" error={errors.current_password}><input className="input" type="password" autoComplete="current-password" value={v.current_password} onChange={set('current_password')} required /></Field>
        <Field label="Neues Passwort" error={errors.password} hint="Mindestens 8 Zeichen."><input className="input" type="password" autoComplete="new-password" value={v.new_password} onChange={set('new_password')} required minLength={8} /></Field>
        <Field label="Neues Passwort wiederholen" error={errors.repeat}><input className="input" type="password" autoComplete="new-password" value={v.repeat} onChange={set('repeat')} required /></Field>
        <div className="form-actions"><Button variant="primary" type="submit" loading={saving}>Passwort ändern</Button></div>
      </form>
    </Card>
  );
}

function TagsCard() {
  const { data, loading } = useApi('/tags');
  const { toast, confirm } = useUi();
  const [name, setName] = useState('');
  const [color, setColor] = useState('blue');
  const [editing, setEditing] = useState(null);

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.post('/tags', { name, color });
      setName('');
      invalidateAll();
      toast('Tag erstellt.');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const update = async () => {
    try {
      await api.patch(`/tags/${editing.id}`, { name: editing.name, color: editing.color });
      setEditing(null);
      invalidateAll();
      toast('Tag gespeichert.');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const remove = async (t) => {
    if (!(await confirm({ title: 'Tag löschen?', message: `„${t.name}“ wird bei ${t.creator_count} Creator(n) entfernt.`, confirmLabel: 'Löschen', danger: true }))) return;
    try {
      await api.del(`/tags/${t.id}`);
      invalidateAll();
      toast('Tag gelöscht.');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <Card title="Tags verwalten" subtitle="Tags können Creatorn im Profil zugeordnet und in der Creator-Liste gefiltert werden.">
      <form className="tag-create" onSubmit={create}>
        <input className="input" placeholder="Neuer Tag, z. B. Premium" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        <ColorPicker value={color} onChange={setColor} />
        <Button variant="primary" type="submit" icon="plus">Anlegen</Button>
      </form>
      {loading && !data ? <Spinner /> : (
        <ul className="tag-admin">
          {(data?.tags || []).map((t) => (
            <li key={t.id}>
              {editing?.id === t.id ? (
                <>
                  <input className="input input-sm" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
                  <ColorPicker value={editing.color} onChange={(c) => setEditing({ ...editing, color: c })} />
                  <Button size="sm" variant="primary" onClick={update}>OK</Button>
                  <Button size="sm" onClick={() => setEditing(null)}>Abbrechen</Button>
                </>
              ) : (
                <>
                  <TagChip tag={t} />
                  <span className="muted small grow">{t.creator_count} Creator</span>
                  <IconButton icon="edit" label="Bearbeiten" onClick={() => setEditing({ ...t })} />
                  <IconButton icon="trash" label="Löschen" onClick={() => remove(t)} />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ColorPicker({ value, onChange }) {
  return (
    <div className="color-picker">
      {TAG_COLORS.map((c) => (
        <button key={c} type="button" className={`swatch tag-${c} ${value === c ? 'on' : ''}`} onClick={() => onChange(c)} aria-label={c} />
      ))}
    </div>
  );
}

function DemoCard() {
  const { toast, confirm } = useUi();
  const [busy, setBusy] = useState(false);
  const load = async () => {
    if (!(await confirm({ title: 'Demo-Daten laden?', message: 'Es werden 13 fiktive Creator mit Kooperationen, Aufgaben, Outreach und Verträgen angelegt. Funktioniert nur, solange noch keine Creator existieren.', confirmLabel: 'Laden' }))) return;
    setBusy(true);
    try {
      await api.post('/admin/seed-demo');
      invalidateAll();
      toast('Demo-Daten geladen.');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Demo-Daten" subtitle="Nur für leere Datenbanken – zum Ausprobieren.">
      <Button onClick={load} loading={busy} icon="sparkle">Demo-Daten laden</Button>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Zwei-Faktor-Anmeldung
// ---------------------------------------------------------------------------
function TwoFactorCard() {
  const { toast } = useUi();
  const { user, setUser } = useAuth();
  const status = useApi('/auth/2fa/status');
  const [step, setStep] = useState('idle'); // idle | setup | codes | disable | regen
  const [setupData, setSetupData] = useState(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const enabled = status.data?.totp_enabled;

  const reset = () => { setStep('idle'); setCode(''); setPassword(''); setErr(null); setSetupData(null); };
  const run = async (fn) => {
    setBusy(true);
    setErr(null);
    try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const start = () => run(async () => {
    setSetupData(await api.post('/auth/2fa/setup'));
    setStep('setup');
  });
  const enable = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await api.post('/auth/2fa/enable', { code });
      setCodes(r.recovery_codes);
      setStep('codes');
      setCode('');
      setUser({ ...user, totp_enabled: true });
      invalidateAll();
      toast('Zwei-Faktor-Anmeldung aktiviert.');
    });
  };
  const disable = (e) => {
    e.preventDefault();
    run(async () => {
      await api.post('/auth/2fa/disable', { password });
      setUser({ ...user, totp_enabled: false });
      invalidateAll();
      reset();
      toast('Zwei-Faktor-Anmeldung deaktiviert.');
    });
  };
  const regen = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await api.post('/auth/2fa/recovery-codes', { password });
      setCodes(r.recovery_codes);
      setPassword('');
      setStep('codes');
      invalidateAll();
    });
  };
  const downloadCodes = () => {
    const text = `Creator CRM – Wiederherstellungscodes für ${user.email}\nJeder Code funktioniert genau einmal.\n\n${codes.join('\n')}\n`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'creator-crm-wiederherstellungscodes.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card
      title="Zwei-Faktor-Anmeldung"
      subtitle="Zusätzlich zum Passwort ein Code aus einer App auf deinem Handy."
      actions={status.data && (enabled ? <Badge tone="green" dot>Aktiv</Badge> : <Badge tone="gray" dot>Aus</Badge>)}
    >
      {!status.data ? <Spinner /> : (
        <div className="stack">
          {step === 'idle' && !enabled && (
            <>
              <p className="muted">Schützt dein Konto, selbst wenn jemand dein Passwort kennt. Du brauchst eine Authenticator-App, z. B. Google Authenticator, Microsoft Authenticator oder die Passwörter-App auf dem iPhone.</p>
              <div className="form-actions"><Button variant="primary" icon="shield" onClick={start} loading={busy}>Einrichten</Button></div>
            </>
          )}

          {step === 'setup' && setupData && (
            <form className="stack" onSubmit={enable}>
              <ol className="twofa-steps">
                <li>Authenticator-App öffnen und <strong>„Konto hinzufügen“ / „QR-Code scannen“</strong> wählen.</li>
                <li>Diesen QR-Code scannen:</li>
              </ol>
              <div className="qr-box" dangerouslySetInnerHTML={{ __html: setupData.qr_svg }} />
              <details className="small">
                <summary className="link">QR-Code lässt sich nicht scannen? Schlüssel manuell eingeben</summary>
                <div className="secret-box">{setupData.secret.match(/.{1,4}/g).join(' ')}</div>
                <p className="muted">Kontoname: {user.email} · Typ: zeitbasiert</p>
              </details>
              <ol className="twofa-steps" start={3}><li>Den 6-stelligen Code aus der App eingeben:</li></ol>
              <input className="input code-input" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" maxLength={7} autoFocus required />
              {err && <div className="alert alert-error"><Icon name="alert" size={16} /><span>{err}</span></div>}
              <div className="form-actions">
                <Button onClick={reset}>Abbrechen</Button>
                <Button variant="primary" type="submit" loading={busy}>Aktivieren</Button>
              </div>
            </form>
          )}

          {step === 'codes' && (
            <>
              <div className="alert alert-warn"><Icon name="alert" size={16} /><span><strong>Jetzt sichern!</strong> Diese Codes werden nur einmal angezeigt. Damit kommst du rein, falls dein Handy weg ist. Jeder Code funktioniert einmal.</span></div>
              <div className="recovery-grid">{codes.map((c) => <code key={c}>{c}</code>)}</div>
              <div className="form-actions">
                <Button icon="download" onClick={downloadCodes}>Als Datei speichern</Button>
                <Button onClick={() => { navigator.clipboard?.writeText(codes.join('\n')); toast('Kopiert.'); }}>Kopieren</Button>
                <Button variant="primary" onClick={() => { setCodes([]); reset(); }}>Gespeichert, fertig</Button>
              </div>
            </>
          )}

          {step === 'idle' && enabled && (
            <>
              <p className="muted">
                Aktiv seit {new Date(status.data.totp_enabled_at).toLocaleDateString('de-DE')}. Noch <strong>{status.data.recovery_left}</strong> unbenutzte Wiederherstellungscodes.
              </p>
              <div className="form-actions">
                <Button onClick={() => setStep('regen')}>Neue Wiederherstellungscodes</Button>
                <Button variant="ghost-danger" onClick={() => setStep('disable')}>Deaktivieren</Button>
              </div>
            </>
          )}

          {(step === 'disable' || step === 'regen') && (
            <form className="stack" onSubmit={step === 'disable' ? disable : regen}>
              <p className="muted">{step === 'disable' ? 'Zum Deaktivieren bitte dein Passwort eingeben.' : 'Zum Erzeugen neuer Codes bitte dein Passwort eingeben. Die alten Codes werden ungültig.'}</p>
              <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Passwort" autoFocus required />
              {err && <div className="alert alert-error"><Icon name="alert" size={16} /><span>{err}</span></div>}
              <div className="form-actions">
                <Button onClick={reset}>Abbrechen</Button>
                <Button variant={step === 'disable' ? 'danger' : 'primary'} type="submit" loading={busy}>{step === 'disable' ? 'Deaktivieren' : 'Neue Codes erzeugen'}</Button>
              </div>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Agentur & Provision (Admin)
// ---------------------------------------------------------------------------
function AgencyCard() {
  const { user } = useAuth();
  const { toast } = useUi();
  const { data } = useApi('/settings');
  const [v, setV] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const isAdmin = user.role === 'admin';
  const vals = v || data?.settings;
  if (!vals) return <Card title="Agentur & Provision"><Spinner /></Card>;
  const set = (k) => (e) => setV({ ...vals, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put('/settings', vals);
      setErrors({});
      setV(null);
      invalidateAll();
      toast('Einstellungen gespeichert.');
    } catch (err) {
      handleFormError(err, setErrors, toast);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card title="Agentur & Provision" subtitle="Standard-Provision für Kooperationen und Angaben für das Mediakit.">
      <form className="stack" onSubmit={save}>
        <Field label="Standard-Agenturprovision (%)" error={errors.default_commission_rate} hint="Gilt für alle Creator ohne eigenen Satz. Pro Creator und pro Kooperation überschreibbar.">
          <input className="input" type="number" min="0" max="100" step="0.5" value={vals.default_commission_rate} onChange={set('default_commission_rate')} disabled={!isAdmin} />
        </Field>
        <Field label="Agenturname" error={errors.agency_name}>
          <input className="input" value={vals.agency_name || ''} onChange={set('agency_name')} disabled={!isAdmin} />
        </Field>
        <Field label="Kontakt-E-Mail (fürs Mediakit)" error={errors.agency_email}>
          <input className="input" type="email" value={vals.agency_email || ''} onChange={set('agency_email')} disabled={!isAdmin} placeholder="z. B. booking@…" />
        </Field>
        <Field label="Website" error={errors.agency_website}>
          <input className="input" value={vals.agency_website || ''} onChange={set('agency_website')} disabled={!isAdmin} placeholder="https://…" />
        </Field>
        {isAdmin ? <div className="form-actions"><Button variant="primary" type="submit" loading={saving}>Speichern</Button></div>
          : <p className="muted small">Nur Administratoren können diese Werte ändern.</p>}
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Tägliche Zusammenfassung per Mail
// ---------------------------------------------------------------------------
function DigestCard() {
  const { user, setUser } = useAuth();
  const { toast } = useUi();
  const status = useApi('/mail/status');
  const [busy, setBusy] = useState(false);
  const toggle = async (e) => {
    const on = e.target.checked;
    setUser({ ...user, digest_enabled: on }); // sofort anzeigen
    try {
      const r = await api.patch('/auth/me', { digest_enabled: on });
      setUser({ ...user, ...r.user });
      toast(on ? 'Tägliche Mail aktiviert.' : 'Tägliche Mail deaktiviert.');
    } catch (err) {
      setUser({ ...user, digest_enabled: !on });
      toast(err.message, 'error');
    }
  };
  const test = async () => {
    setBusy(true);
    try {
      const r = await api.post('/mail/test-digest');
      toast(`Test-Mail an ${r.to} gesendet.`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const configured = status.data?.configured;
  return (
    <Card title="Tägliche Zusammenfassung" subtitle="Jeden Morgen gegen 7 Uhr: fällige Follow-ups, deine Aufgaben, Drehs, Abgaben und Deadlines.">
      <div className="stack">
        {status.data && !configured && (
          <div className="alert alert-warn"><Icon name="alert" size={16} /><span>Der Mailversand ist noch nicht eingerichtet. Ein Admin muss in Netlify die Umgebungsvariablen <code>SMTP_HOST</code>, <code>SMTP_USER</code> und <code>SMTP_PASS</code> setzen (siehe Anleitung).</span></div>
        )}
        <label className="checkbox">
          <input type="checkbox" checked={!!user.digest_enabled} onChange={toggle} />
          <span>Tägliche Mail an <strong>{user.email}</strong> senden</span>
        </label>
        <p className="muted small">An Tagen, an denen nichts fällig ist, kommt keine Mail.</p>
        <div className="form-actions">
          <Button icon="mail" onClick={test} loading={busy} disabled={!configured}>Test-Mail jetzt senden</Button>
        </div>
        {configured && <p className="muted small">Absender: {status.data.from}</p>}
      </div>
    </Card>
  );
}
