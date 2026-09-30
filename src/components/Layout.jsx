import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';
import { Avatar, StatusBadge, Button, Menu } from './ui.jsx';
import { Link, useLocation, useNavigate } from '../lib/router.jsx';
import { useAuth } from '../lib/auth.jsx';
import { api, qs } from '../lib/api.js';
import { useDebounced } from '../lib/useApi.js';

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/creators', label: 'Creator', icon: 'users' },
  { to: '/collaborations', label: 'Kooperationen', icon: 'briefcase' },
  { to: '/tasks', label: 'Aufgaben', icon: 'tasks' },
  { to: '/outreach', label: 'Outreach', icon: 'send' },
  { to: '/contracts', label: 'Verträge & Dokumente', icon: 'file' },
  { to: '/finance', label: 'Finanzen', icon: 'euro' },
  { to: '/media', label: 'Media Produktion', icon: 'camera' },
  { section: 'Produkt' },
  { to: '/app', label: 'App', icon: 'phoneApp' },
  { section: 'Verwaltung' },
  { to: '/users', label: 'Benutzer', icon: 'shield' },
  { to: '/settings', label: 'Einstellungen', icon: 'settings' },
];

export function Layout({ children }) {
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => setMobileOpen(false), [pathname]);

  const isActive = (to) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(to + '/'));

  return (
    <div className="app">
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">C</span>
          <span className="brand-name">Creator CRM</span>
          <button className="icon-btn sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Menü schließen">
            <Icon name="x" />
          </button>
        </div>
        <nav className="nav">
          {NAV.map((n, i) =>
            n.section ? (
              <div key={i} className="nav-section">{n.section}</div>
            ) : (
              <Link key={n.to} to={n.to} className={`nav-item ${isActive(n.to) ? 'active' : ''}`}>
                <Icon name={n.icon} size={18} />
                <span>{n.label}</span>
              </Link>
            )
          )}
        </nav>
        <div className="sidebar-footer">
          <Avatar name={user.name} size={32} />
          <div className="sidebar-user">
            <div className="sidebar-user-name">{user.name}</div>
            <div className="sidebar-user-role">{user.role === 'admin' ? 'Administrator' : 'Manager'}</div>
          </div>
          <button className="icon-btn" onClick={logout} title="Abmelden" aria-label="Abmelden">
            <Icon name="logout" size={17} />
          </button>
        </div>
      </aside>
      {mobileOpen && <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-toggle" onClick={() => setMobileOpen(true)} aria-label="Menü öffnen">
            <Icon name="menu" />
          </button>
          <GlobalSearch />
          <div className="topbar-actions">
            <Button variant="primary" icon="plus" onClick={() => navigate('/creators/new')} className="hide-xs">
              Creator hinzufügen
            </Button>
            <Menu
              trigger={<button className="user-chip" aria-label="Benutzermenü"><Avatar name={user.name} size={30} /></button>}
              items={[
                { label: 'Einstellungen', icon: 'settings', onClick: () => navigate('/settings') },
                { label: 'Abmelden', icon: 'logout', onClick: logout },
              ]}
            />
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

function GlobalSearch() {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState(null);
  const [active, setActive] = useState(0);
  const debounced = useDebounced(term, 200);
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName))) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onDoc = (e) => !wrapRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    if (debounced.trim().length < 2) {
      setResults(null);
      return;
    }
    let cancelled = false;
    api.get('/search' + qs({ q: debounced.trim() })).then((r) => !cancelled && (setResults(r), setActive(0))).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const items = results
    ? [
        ...results.creators.map((c) => ({
          key: 'c' + c.id, group: 'Creator', to: `/creators/${c.id}`, title: c.display_name,
          sub: [c.instagram_username && '@' + c.instagram_username, c.tiktok_username && 'TikTok @' + c.tiktok_username, c.city].filter(Boolean).join(' · '),
          badge: c.status,
        })),
        ...results.collaborations.map((co) => ({
          key: 'k' + co.id, group: 'Kooperationen', to: `/collaborations?open=${co.id}`, title: `${co.brand}${co.campaign_name ? ' – ' + co.campaign_name : ''}`,
          sub: co.creator_name, badge: co.status,
        })),
        ...results.tasks.map((t) => ({
          key: 't' + t.id, group: 'Aufgaben', to: `/tasks?open=${t.id}`, title: t.title, sub: t.creator_name || 'Ohne Creator', badge: t.status,
        })),
      ]
    : [];

  const go = (item) => {
    setOpen(false);
    setTerm('');
    navigate(item.to);
  };

  const onKeyDown = (e) => {
    if (!items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); go(items[active]); }
    if (e.key === 'Escape') setOpen(false);
  };

  let lastGroup = null;
  return (
    <div className="global-search" ref={wrapRef}>
      <Icon name="search" size={16} className="global-search-icon" />
      <input
        ref={inputRef}
        className="global-search-input"
        placeholder="Suche nach Creator, @username, Brand, Aufgabe…"
        value={term}
        onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        aria-label="Globale Suche"
      />
      <kbd className="kbd hide-sm">/</kbd>
      {open && term.trim().length >= 2 && results && (
        <div className="search-results">
          {!items.length && <div className="search-empty">Keine Treffer für „{term}“</div>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? <div className="search-group">{it.group}</div> : null;
            lastGroup = it.group;
            return (
              <div key={it.key}>
                {header}
                <button className={`search-item ${i === active ? 'active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => go(it)}>
                  <div className="search-item-main">
                    <div className="search-item-title">{it.title}</div>
                    {it.sub && <div className="search-item-sub">{it.sub}</div>}
                  </div>
                  <StatusBadge value={it.badge} dot={false} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
