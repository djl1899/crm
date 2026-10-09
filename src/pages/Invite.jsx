import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useNavigate } from '../lib/router.jsx';
import { Button, Field, Spinner } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';

/** Einladung zum Creator-Bereich annehmen: Passwort festlegen und direkt einloggen */
export function InvitePage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [info, setInfo] = useState(null);
  const [pw, setPw] = useState({ a: '', b: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/auth/invite?token=${encodeURIComponent(token)}`).then(setInfo, () => setInfo({ valid: false }));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (pw.a.length < 8) return setError('Das Passwort muss mindestens 8 Zeichen lang sein.');
    if (pw.a !== pw.b) return setError('Die Passwörter stimmen nicht überein.');
    setBusy(true);
    try {
      const { user } = await api.post('/auth/invite', { token, password: pw.a });
      auth.setUser(user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const brand = (
    <div className="auth-brand">
      <img src="/llk-logo.png" alt={auth.agencyName || 'LLK Management'} className="brand-logo brand-logo-lg" />
    </div>
  );

  return (
    <div className="auth-page">
      <div className="auth-card">
        {brand}
        {!info ? <Spinner /> : !info.valid ? (
          <>
            <h1>Link nicht mehr gültig</h1>
            <p className="muted">Dieser Einladungslink ist abgelaufen oder wurde schon benutzt. Bitte dein Management um einen neuen Link.</p>
            <Button className="btn-block" onClick={() => navigate('/', { replace: true })}>Zur Anmeldung</Button>
          </>
        ) : (
          <>
            <h1>Willkommen, {String(info.name).split(' ')[0]}!</h1>
            <p className="muted">Leg ein Passwort für deinen Creator-Bereich fest. Du meldest dich danach mit <strong>{info.email}</strong> an.</p>
            <form className="stack" onSubmit={submit}>
              <Field label="Neues Passwort" hint="Mindestens 8 Zeichen.">
                <input className="input" type="password" autoComplete="new-password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} autoFocus required />
              </Field>
              <Field label="Passwort wiederholen">
                <input className="input" type="password" autoComplete="new-password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} required />
              </Field>
              {error && <div className="alert alert-error"><Icon name="alert" size={16} /><span>{error}</span></div>}
              <Button variant="primary" type="submit" loading={busy} className="btn-block">Passwort speichern & loslegen</Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
