import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { Button, Field } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';

export function LoginPage() {
  const auth = useAuth();
  const [values, setValues] = useState({ name: '', email: '', password: '', password2: '', demo: true });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [twofa, setTwofa] = useState(null); // { challenge }
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(true);
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setup = auth.needsSetup;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (setup && values.password !== values.password2) return setError('Die Passwörter stimmen nicht überein.');
    setBusy(true);
    try {
      if (setup) await auth.setup({ name: values.name, email: values.email, password: values.password, demo: values.demo });
      else {
        const res = await auth.login(values.email, values.password);
        if (res.twofa_required) setTwofa({ challenge: res.challenge });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await auth.loginTwoFactor(twofa.challenge, code, remember);
    } catch (err) {
      setError(err.message);
      if (err.status === 401 && /Anmeldung ist abgelaufen/.test(err.message)) setTwofa(null);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  if (twofa) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">
            <span className="brand-mark">{(auth.agencyName || 'L').slice(0, 1)}</span>
            <span className="brand-name">{auth.agencyName || 'LLK Management'}</span>
          </div>
          <h1>Bestätigungscode</h1>
          <p className="muted">Öffne deine Authenticator-App und gib den 6-stelligen Code ein.</p>
          <form onSubmit={submitCode} className="stack">
            <Field label="Code">
              <input
                className="input code-input"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                maxLength={14}
                autoFocus
                required
              />
            </Field>
            <label className="checkbox">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span>Diesem Gerät 30 Tage vertrauen</span>
            </label>
            {error && (
              <div className="alert alert-error">
                <Icon name="alert" size={16} />
                <span>{error}</span>
              </div>
            )}
            <Button variant="primary" type="submit" loading={busy} className="btn-block">Bestätigen</Button>
            <p className="muted small">Handy nicht zur Hand? Gib stattdessen einen deiner Wiederherstellungscodes ein (Format XXXXX-XXXXX).</p>
            <button type="button" className="link small" onClick={() => { setTwofa(null); setError(null); setCode(''); }}>← Zurück zur Anmeldung</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">{(auth.agencyName || 'L').slice(0, 1)}</span>
          <span className="brand-name">{auth.agencyName || 'LLK Management'}</span>
        </div>
        <h1>{setup ? 'Ersteinrichtung' : 'Anmelden'}</h1>
        <p className="muted">
          {setup
            ? 'Lege das erste Konto an. Es erhält Administrator-Rechte und kann weitere Benutzer hinzufügen.'
            : 'Für das Team und für Creator mit eigenem Zugang.'}
        </p>
        <form onSubmit={submit} className="stack">
          {setup && (
            <Field label="Name" required>
              <input className="input" value={values.name} onChange={set('name')} required autoFocus autoComplete="name" />
            </Field>
          )}
          <Field label="E-Mail" required>
            <input className="input" type="email" value={values.email} onChange={set('email')} required autoFocus={!setup} autoComplete="email" />
          </Field>
          <Field label="Passwort" required hint={setup ? 'Mindestens 8 Zeichen.' : undefined}>
            <input className="input" type="password" value={values.password} onChange={set('password')} required minLength={setup ? 8 : undefined} autoComplete={setup ? 'new-password' : 'current-password'} />
          </Field>
          {setup && (
            <>
              <Field label="Passwort wiederholen" required>
                <input className="input" type="password" value={values.password2} onChange={set('password2')} required autoComplete="new-password" />
              </Field>
              <label className="checkbox">
                <input type="checkbox" checked={values.demo} onChange={set('demo')} />
                <span>Demo-Daten laden (13 fiktive Creator mit Kooperationen, Aufgaben & Outreach)</span>
              </label>
            </>
          )}
          {error && (
            <div className="alert alert-error">
              <Icon name="alert" size={16} />
              <span>{error}</span>
            </div>
          )}
          <Button variant="primary" type="submit" loading={busy} className="btn-block">
            {setup ? 'Konto anlegen & starten' : 'Anmelden'}
          </Button>
        </form>
      </div>
    </div>
  );
}
