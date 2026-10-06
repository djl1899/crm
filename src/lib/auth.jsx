import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setUnauthorizedHandler } from './api.js';
import { useApi } from './useApi.js';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, needsSetup: false, error: null });

  const refresh = useCallback(async () => {
    try {
      const s = await api.get('/auth/status');
      setState({ loading: false, user: s.user, needsSetup: s.needsSetup, agencyName: s.agency_name || 'LLK Management', error: null });
    } catch (e) {
      setState({ loading: false, user: null, needsSetup: false, error: e });
    }
  }, []);

  useEffect(() => {
    refresh();
    setUnauthorizedHandler(() => setState((s) => ({ ...s, user: null })));
  }, [refresh]);

  // Gibt { twofa_required, challenge } zurück, wenn ein Code vom Handy nötig ist.
  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    if (res.twofa_required) return res;
    setState((s) => ({ ...s, user: res.user, needsSetup: false }));
    return {};
  };
  const loginTwoFactor = async (challenge, code, remember) => {
    const { user } = await api.post('/auth/login/2fa', { challenge, code, remember });
    setState((s) => ({ ...s, user, needsSetup: false }));
  };
  const setup = async (payload) => {
    const { user } = await api.post('/auth/setup', payload);
    setState((s) => ({ ...s, user, needsSetup: false }));
  };
  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    setState((s) => ({ ...s, user: null }));
    window.history.replaceState({}, '', '/');
  };
  const setUser = (user) => setState((s) => ({ ...s, user }));

  return <AuthCtx.Provider value={{ ...state, login, loginTwoFactor, setup, logout, refresh, setUser }}>{children}</AuthCtx.Provider>;
}

// Häufig benötigte Stammdaten (Benutzer & Tags)
const LookupCtx = createContext({ users: [], tags: [] });
export const useLookups = () => useContext(LookupCtx);
export function LookupProvider({ children }) {
  const users = useApi('/users');
  const tags = useApi('/tags');
  const value = {
    users: users.data?.users || [],
    activeUsers: (users.data?.users || []).filter((u) => u.is_active),
    tags: tags.data?.tags || [],
  };
  return <LookupCtx.Provider value={value}>{children}</LookupCtx.Provider>;
}
