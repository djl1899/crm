import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApi, useForm, invalidateAll } from '../lib/useApi.js';
import { useAuth } from '../lib/auth.jsx';
import { PageHeader, Button, Card, Modal, Field, Select, Spinner, ErrorBox, Avatar, Badge, useUi, handleFormError } from '../components/ui.jsx';
import { fmtDate, fmtRelative } from '../lib/format.js';
import { ROLES } from '../../shared/constants.js';

export function UsersPage() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const { data, error, loading, reload } = useApi('/users');
  const [modal, setModal] = useState(null);
  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;

  return (
    <div className="page">
      <PageHeader
        title="Benutzer"
        subtitle={isAdmin ? 'Alle Benutzer können alle Creator sehen und bearbeiten. Nur Administratoren verwalten Benutzer.' : 'Nur Administratoren können Benutzer verwalten.'}
        actions={isAdmin && <Button variant="primary" icon="plus" onClick={() => setModal({})}>Benutzer hinzufügen</Button>}
      />
      <Card padded={false}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>E-Mail</th><th>Rolle</th><th>Status</th><th className="num">Creator</th><th>Letzter Login</th><th>Erstellt</th>{isAdmin && <th />}</tr></thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id} className={u.is_active ? '' : 'row-muted'}>
                  <td><div className="creator-cell"><Avatar name={u.name} size={30} /><span className="strong">{u.name}</span>{u.id === user.id && <Badge tone="blue">Du</Badge>}</div></td>
                  <td>{u.email}</td>
                  <td>{u.role === 'admin' ? <Badge tone="violet">Administrator</Badge> : <Badge tone="gray">Manager</Badge>}</td>
                  <td>{u.is_active ? <Badge tone="green" dot>Aktiv</Badge> : <Badge tone="muted" dot>Inaktiv</Badge>}</td>
                  <td className="num">{u.creator_count}</td>
                  <td className="nowrap muted">{u.last_login_at ? fmtRelative(u.last_login_at) : 'noch nie'}</td>
                  <td className="nowrap muted">{fmtDate(u.created_at)}</td>
                  {isAdmin && <td><Button size="sm" onClick={() => setModal({ item: u })}>Bearbeiten</Button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {isAdmin && <UserModal open={!!modal} item={modal?.item} onClose={() => setModal(null)} />}
    </div>
  );
}

function UserModal({ open, item, onClose }) {
  const { toast } = useUi();
  const { user, setUser } = useAuth();
  const [saving, setSaving] = useState(false);
  const f = useForm({});
  useEffect(() => {
    if (!open) return;
    f.setErrors({});
    f.setValues({ name: item?.name || '', email: item?.email || '', role: item?.role || 'manager', is_active: item ? item.is_active : true, password: '' });
  }, [open]); // eslint-disable-line
  const v = f.values;
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...v };
      if (item && !payload.password) delete payload.password;
      if (item) {
        const r = await api.patch(`/users/${item.id}`, payload);
        if (item.id === user.id) setUser({ ...user, ...r.user });
      } else await api.post('/users', payload);
      invalidateAll();
      toast(item ? 'Benutzer gespeichert.' : 'Benutzer angelegt.');
      onClose();
    } catch (err) {
      handleFormError(err, f.setErrors, toast);
    } finally {
      setSaving(false);
    }
  };
  const self = item?.id === user.id;
  return (
    <Modal open={open} onClose={onClose} title={item ? 'Benutzer bearbeiten' : 'Benutzer hinzufügen'}
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" type="submit" form="user-form" loading={saving}>Speichern</Button></>}>
      <form id="user-form" className="form-grid" onSubmit={submit}>
        <Field label="Name" required error={f.errors.name}><input className="input" value={v.name || ''} onChange={f.set('name')} required autoFocus /></Field>
        <Field label="E-Mail" required error={f.errors.email}><input className="input" type="email" value={v.email || ''} onChange={f.set('email')} required /></Field>
        <Field label="Rolle" error={f.errors.role}>
          <Select value={v.role} onChange={f.set('role')} options={ROLES.map((r) => ({ value: r.key, label: r.label }))} disabled={self} />
        </Field>
        <Field label="Status" error={f.errors.is_active}>
          <Select value={v.is_active ? 'true' : 'false'} onChange={(e) => f.setValues((x) => ({ ...x, is_active: e.target.value === 'true' }))}
            options={[{ value: 'true', label: 'Aktiv' }, { value: 'false', label: 'Inaktiv' }]} disabled={self} />
        </Field>
        <Field label={item ? 'Neues Passwort (optional)' : 'Passwort'} required={!item} error={f.errors.password} className="span-2"
          hint={item ? 'Leer lassen, um das Passwort nicht zu ändern. Setzen meldet den Benutzer überall ab.' : 'Mindestens 8 Zeichen. Teile es dem Benutzer sicher mit.'}>
          <input className="input" type="password" autoComplete="new-password" value={v.password || ''} onChange={f.set('password')} minLength={8} required={!item} />
        </Field>
      </form>
    </Modal>
  );
}
