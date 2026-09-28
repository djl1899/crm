import { useState } from 'react';
import { api } from '../lib/api.js';
import { useApi, invalidateAll } from '../lib/useApi.js';
import { useAuth } from '../lib/auth.jsx';
import { PageHeader, Card, Button, Field, TagChip, IconButton, Spinner, useUi, handleFormError } from '../components/ui.jsx';
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
          {user.role === 'admin' && <DemoCard />}
        </div>
        <TagsCard />
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
