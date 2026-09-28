import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { Icon } from './Icon.jsx';
import { initials } from '../lib/format.js';
import { Link } from '../lib/router.jsx';

// ---------- Buttons ----------
export function Button({ variant = 'secondary', size = 'md', icon, loading, children, className = '', type = 'button', ...rest }) {
  return (
    <button type={type} className={`btn btn-${variant} btn-${size} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spinner spinner-sm" /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 16} /> : null}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({ icon, label, className = '', size = 16, ...rest }) {
  return (
    <button type="button" className={`icon-btn ${className}`} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  );
}

// ---------- Badges ----------
const TONES = {
  // Creator
  Lead: 'gray', 'Kontakt aufgenommen': 'blue', 'Im Gespräch': 'violet', Verhandlung: 'amber', Aktiv: 'green',
  Pausiert: 'orange', Abgelehnt: 'red', Archiviert: 'muted',
  // Outreach
  'Noch nicht kontaktiert': 'gray', Kontaktiert: 'blue', 'Antwort erhalten': 'teal', 'Kein Interesse': 'red',
  'Follow-up erforderlich': 'amber', Abgeschlossen: 'green',
  // Kooperationen
  Anfrage: 'gray', Geplant: 'blue', 'Content ausstehend': 'violet', Abnahme: 'teal', Abgebrochen: 'red',
  // Rechnungen
  'Nicht erstellt': 'gray', Offen: 'blue', Eingereicht: 'violet', Bezahlt: 'green', Überfällig: 'red',
  // Aufgaben
  'In Bearbeitung': 'violet', 'Wartet auf Creator': 'amber', Erledigt: 'green',
  Niedrig: 'gray', Normal: 'blue', Hoch: 'amber', Dringend: 'red',
  // Verträge
  'Kein Vertrag': 'gray', 'In Vorbereitung': 'blue', 'Zur Unterschrift': 'amber', Ausgelaufen: 'muted', Gekündigt: 'red',
};

export function Badge({ tone = 'gray', children, dot = false, className = '' }) {
  return (
    <span className={`badge badge-${tone} ${className}`}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
}
export function StatusBadge({ value, dot = true }) {
  if (!value) return <span className="muted">–</span>;
  return <Badge tone={TONES[value] || 'gray'} dot={dot}>{value}</Badge>;
}
export function TagChip({ tag, onRemove }) {
  return (
    <span className={`tag tag-${tag.color || 'gray'}`}>
      {tag.name}
      {onRemove && (
        <button type="button" className="tag-x" onClick={onRemove} aria-label={`${tag.name} entfernen`}>
          <Icon name="x" size={12} />
        </button>
      )}
    </span>
  );
}

// ---------- Avatar ----------
const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6', '#10b981', '#f97316'];
export function Avatar({ name, url, size = 36 }) {
  const [failed, setFailed] = useState(false);
  const color = AVATAR_COLORS[[...String(name || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  if (url && !failed) {
    return <img src={url} alt="" className="avatar" style={{ width: size, height: size }} onError={() => setFailed(true)} />;
  }
  return (
    <span className="avatar avatar-fallback" style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}>
      {initials(name)}
    </span>
  );
}

// ---------- Layout-Bausteine ----------
export function Card({ title, actions, children, className = '', padded = true, subtitle }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-header">
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {subtitle && <p className="card-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <div className="page-header">
      <div>
        {back && (
          <Link to={back.to} className="back-link">
            <Icon name="chevronLeft" size={16} /> {back.label}
          </Link>
        )}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone, to, icon }) {
  const inner = (
    <>
      <div className="stat-label">
        {icon && <Icon name={icon} size={15} />}
        {label}
      </div>
      <div className={`stat-value ${tone ? 'tone-' + tone : ''}`}>{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </>
  );
  return to ? <Link to={to} className="stat stat-link">{inner}</Link> : <div className="stat">{inner}</div>;
}

export function Empty({ icon = 'inbox', title, text, action }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={22} /></div>
      <div className="empty-title">{title}</div>
      {text && <div className="empty-text">{text}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Spinner({ label }) {
  return (
    <div className="loader">
      <span className="spinner" />
      {label && <span>{label}</span>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert alert-error">
      <Icon name="alert" size={16} />
      <span>{error.message || String(error)}</span>
      {onRetry && <button className="link-btn" onClick={onRetry}>Erneut versuchen</button>}
    </div>
  );
}

export function Pagination({ page, pages, total, onPage, label = 'Einträge' }) {
  if (!total) return null;
  return (
    <div className="pagination">
      <span className="muted">{total.toLocaleString('de-DE')} {label}</span>
      {pages > 1 && (
        <div className="pagination-controls">
          <IconButton icon="chevronLeft" label="Vorherige Seite" disabled={page <= 1} onClick={() => onPage(page - 1)} />
          <span>Seite {page} von {pages}</span>
          <IconButton icon="chevronRight" label="Nächste Seite" disabled={page >= pages} onClick={() => onPage(page + 1)} />
        </div>
      )}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          className={`tab ${value === t.key ? 'active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
          {t.count !== undefined && t.count !== null && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} type="button" className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && <span className="seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------- Formulare ----------
export function Field({ label, error, hint, children, required, className = '' }) {
  return (
    <label className={`field ${error ? 'has-error' : ''} ${className}`}>
      {label && (
        <span className="field-label">
          {label}
          {required && <span className="req">*</span>}
        </span>
      )}
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Select({ options, placeholder, value, onChange, ...rest }) {
  return (
    <select className="input" value={value ?? ''} onChange={onChange} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) =>
        typeof o === 'string' ? (
          <option key={o} value={o}>{o}</option>
        ) : (
          <option key={o.value} value={o.value}>{o.label}</option>
        )
      )}
    </select>
  );
}

// ---------- Modal ----------
export function Modal({ open, title, onClose, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <IconButton icon="x" label="Schließen" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}

// ---------- Toasts & Bestätigungen ----------
const UiCtx = createContext(null);
export const useUi = () => useContext(UiCtx);

export function UiProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const idRef = useRef(0);

  const toast = useCallback((message, tone = 'success') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);

  const confirm = useCallback(
    (opts) => new Promise((resolve) => setConfirmState({ ...opts, resolve })),
    []
  );
  const close = (result) => {
    confirmState?.resolve(result);
    setConfirmState(null);
  };

  return (
    <UiCtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <Icon name={t.tone === 'error' ? 'alert' : 'check'} size={16} />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
      <Modal
        open={!!confirmState}
        title={confirmState?.title || 'Bist du sicher?'}
        onClose={() => close(false)}
        size="sm"
        footer={
          <>
            <Button onClick={() => close(false)}>Abbrechen</Button>
            <Button variant={confirmState?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
              {confirmState?.confirmLabel || 'Bestätigen'}
            </Button>
          </>
        }
      >
        <p className="confirm-text">{confirmState?.message}</p>
        {confirmState?.warning && (
          <div className="alert alert-error"><Icon name="alert" size={16} /><strong>{confirmState.warning}</strong></div>
        )}
      </Modal>
    </UiCtx.Provider>
  );
}

// ---------- Dropdown-Menü ----------
export function Menu({ trigger, items, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <span onClick={() => setOpen((o) => !o)}>{trigger}</span>
      {open && (
        <div className={`menu menu-${align}`}>
          {items.filter(Boolean).map((it, i) => (
            <button
              key={i}
              className={`menu-item ${it.danger ? 'danger' : ''}`}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              {it.icon && <Icon name={it.icon} size={15} />}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Wandelt API-Fehler in Feldfehler um und zeigt eine Meldung */
export function handleFormError(err, setErrors, toast) {
  if (err?.details && Object.keys(err.details).length) setErrors(err.details);
  toast(err?.message || 'Speichern fehlgeschlagen.', 'error');
}
