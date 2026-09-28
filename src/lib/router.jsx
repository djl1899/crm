// Minimaler Client-Router (History API)
import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';

const RouterCtx = createContext(null);

export function Router({ children }) {
  const [loc, setLoc] = useState(() => ({ pathname: window.location.pathname, search: window.location.search }));
  useEffect(() => {
    const onPop = () => setLoc({ pathname: window.location.pathname, search: window.location.search });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((to, { replace = false, keepScroll = false } = {}) => {
    const url = new URL(to, window.location.origin);
    if (url.pathname + url.search === window.location.pathname + window.location.search) return;
    window.history[replace ? 'replaceState' : 'pushState']({}, '', url.pathname + url.search);
    setLoc({ pathname: url.pathname, search: url.search });
    if (!keepScroll && !replace) window.scrollTo(0, 0);
  }, []);
  const value = useMemo(() => ({ ...loc, navigate }), [loc, navigate]);
  return <RouterCtx.Provider value={value}>{children}</RouterCtx.Provider>;
}

export const useLocation = () => useContext(RouterCtx);
export const useNavigate = () => useContext(RouterCtx).navigate;

export function matchPath(pattern, pathname) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => (keys.push(k), '/([^/]+)')) + '/?$');
  const m = pathname.match(re);
  if (!m) return null;
  const params = {};
  keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
  return params;
}

/** URL-Suchparameter lesen/setzen (Filter bleiben beim Zurück-Navigieren erhalten) */
export function useSearchParams() {
  const { search, pathname, navigate } = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const setParams = useCallback(
    (updates, { replace = true } = {}) => {
      const next = new URLSearchParams(search);
      for (const [k, v] of Object.entries(updates)) {
        if (v === undefined || v === null || v === '' || v === false) next.delete(k);
        else next.set(k, String(v));
      }
      const s = next.toString();
      navigate(pathname + (s ? '?' + s : ''), { replace, keepScroll: true });
    },
    [search, pathname, navigate]
  );
  return [params, setParams];
}

export function Link({ to, children, className, onClick, ...rest }) {
  const navigate = useNavigate();
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
