// Map: Creator und Firmen auf der Deutschlandkarte – filterbar nach Typ, Kategorie, Status und Liste
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useApi, invalidateAll } from '../lib/useApi.js';
import { useSearchParams, useNavigate, Link } from '../lib/router.jsx';
import { Button, Spinner, ErrorBox, useUi, Select } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { SlippyMap } from '../components/SlippyMap.jsx';
import { fmtCompact } from '../lib/format.js';
import { categoryColor } from '../../shared/geo.js';
import { CREATOR_STATUSES } from '../../shared/constants.js';

const REGIONS = {
  de: { label: 'Deutschland', bounds: [{ lat: 47.3, lng: 5.9 }, { lat: 55.0, lng: 15.0 }] },
  rn: { label: 'Rhein-Neckar', bounds: [{ lat: 49.28, lng: 8.38 }, { lat: 49.62, lng: 8.78 }] },
  ka: { label: 'Karlsruhe', bounds: [{ lat: 48.92, lng: 8.30 }, { lat: 49.12, lng: 8.72 }] },
};
const TYPES = [
  { value: 'all', label: 'Alle' },
  { value: 'creator', label: 'Creator' },
  { value: 'firm', label: 'Firmen' },
];
const initials = (s) => String(s || '?').split(/\s+/).map((x) => x[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
const primaryColor = (it) => (it.categories.length ? categoryColor(it.categories[0]) : '#5c5f6a');

// ------------------------------------------------------------------
// Fehlende Orte einmalig über OpenStreetMap (Nominatim) suchen – höchstens 1 Anfrage pro Sekunde
function useGeocodeMissing(missing, onDone) {
  const [state, setState] = useState({ running: false, done: 0, total: 0 });
  useEffect(() => {
    if (!missing?.length) return;
    let tried = [];
    try { tried = JSON.parse(sessionStorage.getItem('map-geo-tried') || '[]'); } catch { /* egal */ }
    const todo = missing.filter((m) => !tried.includes(m.key)).slice(0, 20);
    if (!todo.length) return;
    let cancelled = false;
    (async () => {
      setState({ running: true, done: 0, total: todo.length });
      const results = [];
      for (let i = 0; i < todo.length && !cancelled; i++) {
        const m = todo[i];
        try {
          const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=de&countrycodes=${encodeURIComponent(m.country || 'de')}&q=${encodeURIComponent(m.query)}`;
          const r = await fetch(url, { headers: { Accept: 'application/json' } });
          const j = r.ok ? await r.json() : null;
          const hit = Array.isArray(j) && j[0];
          results.push(hit ? { key: m.key, query: m.query, lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name } : { key: m.key, query: m.query, lat: null, lng: null });
        } catch {
          // Netzwerk/Blocker: später erneut versuchen, nichts speichern
        }
        tried.push(m.key);
        setState((s) => ({ ...s, done: i + 1 }));
        await new Promise((res) => setTimeout(res, 1100));
      }
      try { sessionStorage.setItem('map-geo-tried', JSON.stringify(tried.slice(-500))); } catch { /* egal */ }
      if (!cancelled && results.length) {
        await api.post('/map/places', { places: results }).catch(() => {});
        onDone();
      }
      if (!cancelled) setState({ running: false, done: 0, total: 0 });
    })();
    return () => { cancelled = true; };
  }, [missing]); // eslint-disable-line
  return state;
}

// ------------------------------------------------------------------
export function MapPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useUi();
  const [archived, setArchived] = useState(false);
  const { data, error, loading, reload } = useApi(`/map${archived ? '?archived=1' : ''}`);
  const mapRef = useRef(null);
  const [selectedKey, setSelectedKey] = useState(null);
  const [bounds, setBounds] = useState(null);
  const [pick, setPick] = useState(null);
  const [showAllCats, setShowAllCats] = useState(false);
  const [moreFilters, setMoreFilters] = useState(false);
  const [importing, setImporting] = useState(false);
  const [listTab, setListTab] = useState('view');
  const fitted = useRef(false);

  const type = params.get('typ') || 'all';
  const cats = (params.get('kat') || '').split(',').filter(Boolean);
  const status = params.get('status') || '';
  const listId = params.get('liste') || '';
  const q = (params.get('q') || '').trim().toLowerCase();
  const [search, setSearch] = useState(params.get('q') || '');
  useEffect(() => { const t = setTimeout(() => setParams({ q: search || null }), 250); return () => clearTimeout(t); }, [search]); // eslint-disable-line

  const geo = useGeocodeMissing(data?.missing, () => invalidateAll());
  const items = data?.items || [];

  // Filter (Kategorien-Zähler ohne Kategorie-Filter, damit man sieht, was es gibt)
  const baseFiltered = useMemo(() => items.filter((it) => {
    if (type !== 'all' && it.type !== type) return false;
    if (status && it.type === 'creator' && it.status !== status) return false;
    if (status && it.type === 'firm') return false;
    if (listId && (it.type !== 'firm' || String(it.list_id) !== listId)) return false;
    if (q && ![it.title, it.city, it.industry, it.niche, it.contact, it.address, it.list_name].filter(Boolean).join(' ').toLowerCase().includes(q)) return false;
    return true;
  }), [items, type, status, listId, q]);
  const filtered = useMemo(() => (cats.length ? baseFiltered.filter((it) => it.categories.some((c) => cats.includes(c))) : baseFiltered), [baseFiltered, cats.join()]); // eslint-disable-line
  const located = useMemo(() => filtered.filter((it) => Number.isFinite(it.lat)), [filtered]);
  const unlocated = filtered.filter((it) => !Number.isFinite(it.lat));

  const catCounts = useMemo(() => {
    const m = new Map();
    for (const it of baseFiltered) for (const c of it.categories) m.set(c, (m.get(c) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [baseFiltered]);
  const typeCounts = useMemo(() => ({ all: items.length, creator: items.filter((i) => i.type === 'creator').length, firm: items.filter((i) => i.type === 'firm').length }), [items]);
  const lists = useMemo(() => {
    const m = new Map();
    for (const it of items) if (it.type === 'firm') m.set(String(it.list_id), it.list_name);
    return [...m.entries()].map(([value, label]) => ({ value, label }));
  }, [items]);

  // Beim ersten Laden auf alle Einträge zoomen
  useEffect(() => {
    if (!data || fitted.current || !mapRef.current) return;
    fitted.current = true;
    const pts = items.filter((i) => Number.isFinite(i.lat));
    if (pts.length) mapRef.current.fitBounds(pts, { animate: false, maxZoom: 12 });
    else mapRef.current.fitBounds(REGIONS.de.bounds, { animate: false });
  }, [data]); // eslint-disable-line

  const inView = useMemo(() => {
    if (!bounds) return located;
    return located.filter((it) => it.lat <= bounds.north && it.lat >= bounds.south && it.lng >= bounds.west && it.lng <= bounds.east)
      .sort((x, y) => x.title.localeCompare(y.title, 'de'));
  }, [located, bounds]);

  const toggleCat = (c) => setParams({ kat: (cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c]).join(',') || null });
  const selected = items.find((i) => i.key === selectedKey) || null;
  const focus = (it) => {
    setSelectedKey(it.key);
    if (Number.isFinite(it.lat)) mapRef.current?.flyTo(it.lat, it.lng, Math.max(mapRef.current.getView().zoom, 14));
  };

  const savePosition = async (it, latlng) => {
    try {
      await api.patch('/map/position', { type: it.type, id: it.id, lat: latlng ? Math.round(latlng.lat * 1e6) / 1e6 : null, lng: latlng ? Math.round(latlng.lng * 1e6) / 1e6 : null });
      toast(latlng ? `Position von ${it.title} gespeichert.` : `${it.title} steht wieder am Ort aus den Stammdaten.`);
      setPick(null);
      setSelectedKey(it.key);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const runImport = async () => {
    setImporting(true);
    try {
      const r = await api.post('/map/app-import');
      toast(`${r.creators} Creator und ${r.firms} Firmen übernommen.`);
      fitted.current = false;
      invalidateAll();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setImporting(false);
    }
  };

  const onViewChange = useCallback((b) => setBounds(b), []);
  const shownCats = showAllCats ? catCounts : catCounts.slice(0, 8);

  return (
    <div className="mapx">
      <aside className="mapx-panel">
        <header className="mapx-head">
          <h1>Map</h1>
          <p>{data ? <>{located.length} von {filtered.length} {filtered.length === 1 ? 'Eintrag' : 'Einträgen'} auf der Karte{unlocated.length ? `, ${unlocated.length} ohne Ort` : ''}.</> : 'Lädt …'}</p>
        </header>

        {data?.app_import && (
          <div className="mapx-import">
            <strong>Recherche-Daten übernehmen?</strong>
            <span>Im früheren App-Bereich liegen noch {data.app_import.creators} Creator und {data.app_import.firms} Firmen. Übernimm sie ins CRM, dann erscheinen sie hier und unter Creator bzw. Listen.</span>
            <Button size="sm" variant="primary" loading={importing} onClick={runImport}>Jetzt übernehmen</Button>
          </div>
        )}

        <div className="mapx-filters">
          <div className="mapx-types" role="radiogroup" aria-label="Was anzeigen?">
            {TYPES.map((t) => (
              <button key={t.value} type="button" role="radio" aria-checked={type === t.value} className={type === t.value ? 'on' : ''}
                onClick={() => setParams({ typ: t.value === 'all' ? null : t.value, liste: t.value === 'creator' ? null : listId || null, status: t.value === 'firm' ? null : status || null })}>
                {t.value === 'creator' && <span className="lg-shape lg-circle" />}
                {t.value === 'firm' && <span className="lg-shape lg-square" />}
                {t.label}<span className="mapx-count">{typeCounts[t.value]}</span>
              </button>
            ))}
          </div>

          <label className="mapx-search">
            <Icon name="search" size={16} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, Ort, Branche …" aria-label="Auf der Karte suchen" />
          </label>

          <section className="mapx-section">
            <div className="mapx-section-head">
              <h2>Kategorien</h2>
              {cats.length > 0 && <button type="button" className="link small" onClick={() => setParams({ kat: null })}>Alle zeigen</button>}
            </div>
            {!catCounts.length ? <p className="small muted">Noch keine Kategorien – bei Creatorn über die Nische, bei Firmen über das Feld „Kategorie“ in der Liste.</p> : (
              <div className="mapx-cats">
                {shownCats.map(([c, n]) => (
                  <button key={c} type="button" className={`mapx-cat ${cats.includes(c) ? 'on' : ''}`} style={{ '--c': categoryColor(c) }} aria-pressed={cats.includes(c)} onClick={() => toggleCat(c)}>
                    <span className="mapx-cat-dot" />{c}<span className="mapx-count">{n}</span>
                  </button>
                ))}
                {catCounts.length > 8 && <button type="button" className="mapx-cat mapx-cat-more" onClick={() => setShowAllCats(!showAllCats)}>{showAllCats ? 'Weniger' : `+ ${catCounts.length - 8} weitere`}</button>}
              </div>
            )}
          </section>

          <section className="mapx-section">
            <button type="button" className="mapx-more" aria-expanded={moreFilters} onClick={() => setMoreFilters(!moreFilters)}>
              <Icon name={moreFilters ? 'chevronUp' : 'chevronDown'} size={15} /> Weitere Filter{(status || listId || archived) ? ' (aktiv)' : ''}
            </button>
            {moreFilters && (
              <div className="mapx-more-body">
                {type !== 'firm' && <Select value={status} onChange={(e) => setParams({ status: e.target.value || null })} placeholder="Jeder Creator-Status" options={CREATOR_STATUSES.filter((s) => s !== 'Archiviert')} aria-label="Creator-Status" />}
                {type !== 'creator' && <Select value={listId} onChange={(e) => setParams({ liste: e.target.value || null })} placeholder="Alle Listen" options={lists} aria-label="Liste" />}
                <label className="checkline"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archivierte Creator zeigen</label>
              </div>
            )}
          </section>

        </div>

        <section className="mapx-results">
          <div className="mapx-tabs" role="tablist" aria-label="Liste">
            <button type="button" role="tab" aria-selected={listTab === 'view'} className={listTab === 'view' ? 'on' : ''} onClick={() => setListTab('view')}>
              Im Kartenausschnitt <span className="mapx-count">{inView.length}</span>
            </button>
            {unlocated.length > 0 && (
              <button type="button" role="tab" aria-selected={listTab === 'missing'} className={listTab === 'missing' ? 'on' : ''} onClick={() => setListTab('missing')}>
                Ohne Ort <span className="mapx-count">{unlocated.length}</span>
              </button>
            )}
          </div>
          <div className="mapx-scroll">
            {listTab === 'missing' && unlocated.length > 0 ? (
              <>
                <p className="mapx-hint">Kein Wohnort bzw. keine Adresse hinterlegt. Trag den Ort im Profil ein oder setz den Punkt direkt auf die Karte.</p>
                <ul className="mapx-list">
                  {unlocated.slice(0, 80).map((it) => (
                    <li key={it.key} className="mapx-row nolink">
                      <Marker it={it} small />
                      <div className="mapx-row-main">
                        <div className="mapx-row-title">{it.title}</div>
                        <div className="mapx-row-sub">{it.type === 'creator' ? 'Creator' : it.list_name}</div>
                      </div>
                      <button type="button" className="mapx-row-action" onClick={() => setPick(it)}><Icon name="pin" size={13} /> Setzen</button>
                    </li>
                  ))}
                </ul>
              </>
            ) : !data ? <Spinner /> : !inView.length ? (
              <p className="mapx-hint">{filtered.length ? 'Hier ist nichts – verschieb die Karte oder zoom heraus.' : 'Keine Treffer für diese Filter.'}</p>
            ) : (
              <ul className="mapx-list">
                {inView.slice(0, 200).map((it) => <ResultRow key={it.key} it={it} active={it.key === selectedKey} onClick={() => focus(it)} />)}
                {inView.length > 200 && <li className="mapx-hint">… und {inView.length - 200} weitere – zoom hinein, um sie zu sehen.</li>}
              </ul>
            )}
          </div>
        </section>
      </aside>

      <div className="mapx-map">
        {error && !data ? <div className="mapx-error"><ErrorBox error={error} onRetry={reload} /></div> : null}
        <SlippyMap
          ref={mapRef}
          points={located}
          selectedKey={selectedKey}
          onSelect={(p) => setSelectedKey(p ? p.key : null)}
          onViewChange={onViewChange}
          pickMode={!!pick}
          onPick={(ll) => pick && savePosition(pick, ll)}
          renderMarker={(p, { selected: sel }) => <Marker it={p} selected={sel} />}
          renderCluster={(pts) => <Cluster pts={pts} />}
          renderPopup={(p) => (p.cluster ? <ClusterPopup pts={p.cluster} onClose={p.close} onPick={(it) => { p.close(); focus(it); }} />
            : <Popup it={p} onClose={() => setSelectedKey(null)} onOpen={() => navigate(p.link)} onMove={() => { setPick(p); setSelectedKey(null); }} />)}
        >
          <div className="mapx-views" data-map-ui>
            {Object.entries(REGIONS).map(([k, r]) => (
              <button key={k} type="button" onClick={() => mapRef.current?.fitBounds(r.bounds, { padding: 30, maxZoom: 13 })}>{r.label}</button>
            ))}
            <button type="button" className="strong" disabled={!located.length} onClick={() => mapRef.current?.fitBounds(located, { maxZoom: 14 })}>Alle Treffer</button>
          </div>
          <div className="mapx-legend" data-map-ui aria-hidden="true">
            <span><span className="lg-shape lg-circle" /> Creator</span>
            <span><span className="lg-shape lg-square" /> Firma</span>
            <span className="muted">Farbe = Kategorie</span>
          </div>
          {pick && (
            <div className="mapx-pick" data-map-ui>
              <span><strong>{pick.title}</strong> platzieren: Klick auf die Stelle in der Karte.</span>
              {pick.precision === 'manual' && <button type="button" className="link small" onClick={() => savePosition(pick, null)}>Auf Ort aus Stammdaten zurücksetzen</button>}
              <Button size="sm" onClick={() => setPick(null)}>Abbrechen</Button>
            </div>
          )}
          {geo.running && (
            <div className="mapx-geo" data-map-ui role="status">
              <span className="spinner spinner-sm" /> Suche {geo.total} {geo.total === 1 ? 'Ort' : 'Orte'} auf der Karte ({geo.done}/{geo.total}) …
            </div>
          )}
          {loading && data && <div className="mapx-geo" data-map-ui role="status"><span className="spinner spinner-sm" /> Aktualisiere …</div>}
        </SlippyMap>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
function Marker({ it, selected, small }) {
  const color = primaryColor(it);
  const cls = `mk ${it.type === 'creator' ? 'mk-creator' : 'mk-firm'} ${selected ? 'sel' : ''} ${small ? 'sm' : ''} ${it.precision === 'city' ? 'approx' : ''}`;
  return (
    <span className={cls} style={{ '--c': color }}>
      {it.type === 'creator' && it.avatar_url ? <img src={it.avatar_url} alt="" draggable={false} /> : <span className="mk-ini">{initials(it.title)}</span>}
    </span>
  );
}

function Cluster({ pts }) {
  // Ring aus Kategorie-Anteilen, innen die Anzahl
  const counts = new Map();
  for (const p of pts) { const c = p.categories[0] || '–'; counts.set(c, (counts.get(c) || 0) + 1); }
  let acc = 0;
  const stops = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => {
    const from = (acc / pts.length) * 360;
    acc += n;
    const to = (acc / pts.length) * 360;
    return `${c === '–' ? '#9a9da6' : categoryColor(c)} ${from}deg ${to}deg`;
  }).join(', ');
  const creators = pts.filter((p) => p.type === 'creator').length;
  const size = Math.round(34 + Math.min(26, Math.log2(pts.length) * 6));
  return (
    <span className="mk-cluster" style={{ width: size, height: size, background: `conic-gradient(${stops})` }}
      title={`${creators} Creator, ${pts.length - creators} Firmen`}>
      <span className="mk-cluster-inner">{pts.length}</span>
    </span>
  );
}

function ResultRow({ it, active, onClick }) {
  const isCreator = it.type === 'creator';
  return (
    <li>
      <button type="button" className={`mapx-row ${active ? 'on' : ''}`} onClick={onClick}>
        <Marker it={it} small />
        <span className="mapx-row-main">
          <span className="mapx-row-top">
            <span className="mapx-row-title">{it.title}</span>
            {isCreator && it.followers ? <span className="mapx-row-num">{fmtCompact(it.followers)}</span> : null}
          </span>
          <span className="mapx-row-sub">
            {it.city && <span className="mapx-row-city"><Icon name="pin" size={11} />{it.city}</span>}
            {isCreator
              ? it.categories.slice(0, 2).map((c) => <span key={c} className="mapx-row-cat" style={{ '--c': categoryColor(c) }}><i />{c}</span>)
              : <span className="mapx-row-ind">{it.industry || it.categories[0] || 'Firma'}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

function Popup({ it, onClose, onOpen, onMove }) {
  const isCreator = it.type === 'creator';
  return (
    <div className="mpop" role="dialog" aria-label={it.title}>
      <button type="button" className="mpop-x" onClick={onClose} aria-label="Schließen"><Icon name="x" size={14} /></button>
      <div className="mpop-head">
        <Marker it={it} />
        <div className="mpop-titles">
          <div className="mpop-kicker">{isCreator ? 'Creator' : it.list_name}</div>
          <div className="mpop-title">{it.title}</div>
          <div className="mpop-sub">{isCreator ? [it.city, it.status].filter(Boolean).join(', ') : [it.industry, it.city].filter(Boolean).join(' in ')}</div>
        </div>
      </div>
      {it.categories.length > 0 && (
        <div className="mpop-cats">{it.categories.slice(0, 4).map((c) => <span key={c} style={{ '--c': categoryColor(c) }}><i />{c}</span>)}</div>
      )}
      <dl className="mpop-facts">
        {isCreator && it.followers ? <><dt>Reichweite</dt><dd>{fmtCompact(it.followers)} Follower{it.instagram ? ` · @${it.instagram}` : it.tiktok ? ` · @${it.tiktok}` : ''}</dd></> : null}
        {isCreator && it.manager ? <><dt>Manager</dt><dd>{it.manager}</dd></> : null}
        {!isCreator && it.contact ? <><dt>Kontakt</dt><dd>{it.contact}{it.position ? `, ${it.position}` : ''}</dd></> : null}
        {!isCreator && it.address ? <><dt>Adresse</dt><dd>{it.address}</dd></> : null}
        {!isCreator && it.status ? <><dt>Status</dt><dd>{it.status}</dd></> : null}
        {!isCreator && it.instagram ? <><dt>Instagram</dt><dd><a className="link" href={`https://instagram.com/${String(it.instagram).replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer">@{String(it.instagram).replace(/^@/, '')}</a></dd></> : null}
      </dl>
      {it.precision === 'city' && <p className="mpop-note">Steht in der Ortsmitte von {it.city}. Für den genauen Punkt {isCreator ? 'den Pin setzen' : 'die Adresse ergänzen oder den Pin setzen'}.</p>}
      <div className="mpop-actions">
        <Button size="sm" variant="primary" onClick={onOpen}>{isCreator ? 'Profil öffnen' : 'In Liste öffnen'}</Button>
        <Button size="sm" icon="pin" onClick={onMove}>Pin setzen</Button>
      </div>
    </div>
  );
}

function ClusterPopup({ pts, onClose, onPick }) {
  const city = pts.every((p) => p.city === pts[0].city) ? pts[0].city : null;
  return (
    <div className="mpop mpop-list" role="dialog" aria-label={`${pts.length} Einträge`}>
      <button type="button" className="mpop-x" onClick={onClose} aria-label="Schließen"><Icon name="x" size={14} /></button>
      <div className="mpop-kicker">{city ? `${pts.length} in ${city}` : `${pts.length} an dieser Stelle`}</div>
      <ul className="mapx-list">
        {pts.slice(0, 60).map((it) => <ResultRow key={it.key} it={it} onClick={() => onPick(it)} />)}
      </ul>
    </div>
  );
}
