import { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';

// Globale Invalidierung: nach jeder Änderung laden alle sichtbaren Daten neu.
let version = 0;
const listeners = new Set();
export function invalidateAll() {
  version++;
  listeners.forEach((l) => l(version));
}

/** Lädt Daten von der API. path = null → nichts laden. */
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: !!path });
  const [v, setV] = useState(version);

  useEffect(() => {
    const l = (x) => setV(x);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);

  useEffect(() => {
    if (!path) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    api.get(path).then(
      (data) => !cancelled && setState({ data, error: null, loading: false }),
      (error) => !cancelled && setState((s) => ({ data: s.data, error, loading: false }))
    );
    return () => {
      cancelled = true;
    };
  }, [path, v]);

  const reload = useCallback(() => setV((x) => x + 1), []);
  return { ...state, reload };
}

/** Kleiner Helfer für Formularzustand */
export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const set = (key) => (e) => {
    const val = e && e.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    setValues((vals) => ({ ...vals, [key]: val }));
    setErrors((errs) => (errs[key] ? { ...errs, [key]: undefined } : errs));
  };
  return { values, setValues, errors, setErrors, set };
}

export function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
