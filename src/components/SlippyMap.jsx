// Schlanke Kartenansicht ohne externe Bibliothek: OpenStreetMap-Kacheln, Verschieben, stufenloses Zoomen,
// Cluster und Popups. Kacheln werden direkt im Browser von tile.openstreetmap.org geladen.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

const TILE = 256;
const MIN_ZOOM = 4;
const MAX_ZOOM = 18;
const TILE_URL = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const worldSize = (z) => TILE * 2 ** z;
function project(lat, lng, z) {
  const s = Math.sin((clamp(lat, -85.05, 85.05) * Math.PI) / 180);
  const w = worldSize(z);
  return { x: ((lng + 180) / 360) * w, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * w };
}
function unproject(x, y, z) {
  const w = worldSize(z);
  const lng = (x / w) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / w;
  return { lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng };
}
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * points: [{ key, lat, lng, ... }]
 * renderMarker(point, { selected }) → Inhalt eines einzelnen Markers
 * renderCluster(points) → Inhalt eines Clusters
 * renderPopup(point | { cluster: points }) → Inhalt des Popups (oder null)
 */
export const SlippyMap = forwardRef(function SlippyMap(
  { points, initial = { lat: 51.1, lng: 10.3, zoom: 6 }, renderMarker, renderCluster, renderPopup, selectedKey, onSelect, onViewChange, pickMode = false, onPick, clusterRadius = 46, children },
  ref
) {
  const box = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState(initial);
  const viewRef = useRef(view);
  viewRef.current = view;
  const anim = useRef(null);
  const [openCluster, setOpenCluster] = useState(null);

  // Größe beobachten
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Sichtbereich nach außen melden (für die Liste "im Kartenausschnitt")
  useEffect(() => {
    if (!onViewChange) return;
    const c = project(view.lat, view.lng, view.zoom);
    const nw = unproject(c.x - size.w / 2, c.y - size.h / 2, view.zoom);
    const se = unproject(c.x + size.w / 2, c.y + size.h / 2, view.zoom);
    const t = setTimeout(() => onViewChange({ north: nw.lat, south: se.lat, west: nw.lng, east: se.lng, zoom: view.zoom }), 120);
    return () => clearTimeout(t);
  }, [view, size, onViewChange]);

  const stopAnim = () => { if (anim.current) cancelAnimationFrame(anim.current); anim.current = null; };

  /** Ansicht setzen; anchor = Bildschirmpunkt, der beim Zoomen an Ort und Stelle bleibt */
  const zoomAround = useCallback((nextZoom, anchor) => {
    setView((v) => {
      const z = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
      const el = box.current;
      const ax = anchor ? anchor.x : (el?.clientWidth || 0) / 2;
      const ay = anchor ? anchor.y : (el?.clientHeight || 0) / 2;
      const w = el?.clientWidth || 0;
      const h = el?.clientHeight || 0;
      const c = project(v.lat, v.lng, v.zoom);
      const geo = unproject(c.x + ax - w / 2, c.y + ay - h / 2, v.zoom);
      const g2 = project(geo.lat, geo.lng, z);
      const center = unproject(g2.x - ax + w / 2, g2.y - ay + h / 2, z);
      return { lat: center.lat, lng: center.lng, zoom: z };
    });
  }, []);

  const animateTo = useCallback((target, duration = 450) => {
    stopAnim();
    const from = { ...viewRef.current };
    if (reducedMotion() || duration === 0) { setView(target); return; }
    const t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      const e = ease(t);
      // In Weltkoordinaten der Ziel-Zoomstufe interpolieren, damit die Bewegung gerade wirkt
      const zMid = from.zoom + (target.zoom - from.zoom) * e;
      const a = project(from.lat, from.lng, 20);
      const b = project(target.lat, target.lng, 20);
      const p = unproject(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e, 20);
      setView({ lat: p.lat, lng: p.lng, zoom: zMid });
      if (t < 1) anim.current = requestAnimationFrame(step);
      else anim.current = null;
    };
    anim.current = requestAnimationFrame(step);
  }, []);

  const fitBounds = useCallback((pts, { padding = 60, maxZoom = 14, animate = true } = {}) => {
    const list = pts.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (!list.length || !box.current) return;
    const w = box.current.clientWidth - padding * 2;
    const h = box.current.clientHeight - padding * 2;
    let lat1 = 90, lat2 = -90, lng1 = 180, lng2 = -180;
    for (const p of list) { lat1 = Math.min(lat1, p.lat); lat2 = Math.max(lat2, p.lat); lng1 = Math.min(lng1, p.lng); lng2 = Math.max(lng2, p.lng); }
    let z = maxZoom;
    for (; z > MIN_ZOOM; z -= 0.25) {
      const a = project(lat2, lng1, z);
      const b = project(lat1, lng2, z);
      if (b.x - a.x <= w && b.y - a.y <= h) break;
    }
    const a = project(lat2, lng1, z);
    const b = project(lat1, lng2, z);
    const c = unproject((a.x + b.x) / 2, (a.y + b.y) / 2, z);
    const target = { lat: c.lat, lng: c.lng, zoom: z };
    if (animate) animateTo(target); else setView(target);
  }, [animateTo]);

  useImperativeHandle(ref, () => ({
    fitBounds,
    flyTo: (lat, lng, zoom) => animateTo({ lat, lng, zoom: zoom ?? Math.max(viewRef.current.zoom, 13) }),
    getView: () => viewRef.current,
    closeCluster: () => setOpenCluster(null),
  }), [fitBounds, animateTo]);

  // ---------- Eingaben: Ziehen, Mausrad, Pinch, Doppelklick, Tastatur ----------
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const moved = useRef(false);

  const onPointerDown = (e) => {
    if (e.target.closest('[data-map-ui]')) return;
    stopAnim();
    box.current.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    const v = viewRef.current;
    if (pointers.current.size === 1) {
      gesture.current = { type: 'pan', start: { x: e.clientX, y: e.clientY }, center: project(v.lat, v.lng, v.zoom), zoom: v.zoom };
    } else if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      gesture.current = { type: 'pinch', dist: Math.hypot(p2.x - p1.x, p2.y - p1.y), zoom: v.zoom };
    }
  };
  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.type === 'pan' && pointers.current.size === 1) {
      const dx = e.clientX - g.start.x;
      const dy = e.clientY - g.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved.current = true;
      const c = unproject(g.center.x - dx, g.center.y - dy, g.zoom);
      setView({ lat: c.lat, lng: c.lng, zoom: g.zoom });
    } else if (g.type === 'pinch' && pointers.current.size === 2) {
      moved.current = true;
      const [p1, p2] = [...pointers.current.values()];
      const rect = box.current.getBoundingClientRect();
      const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      zoomAround(g.zoom + Math.log2(d / g.dist), { x: (p1.x + p2.x) / 2 - rect.left, y: (p1.y + p2.y) / 2 - rect.top });
    }
  };
  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()];
      const v = viewRef.current;
      gesture.current = { type: 'pan', start: p, center: project(v.lat, v.lng, v.zoom), zoom: v.zoom };
    } else if (!pointers.current.size) gesture.current = null;
  };
  // Mausrad: stufenlos, zum Mauszeiger hin
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      stopAnim();
      const rect = el.getBoundingClientRect();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAround(viewRef.current.zoom - clamp(delta, -120, 120) * 0.0045, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAround]);

  const toLatLng = (clientX, clientY) => {
    const rect = box.current.getBoundingClientRect();
    const v = viewRef.current;
    const c = project(v.lat, v.lng, v.zoom);
    return unproject(c.x + clientX - rect.left - rect.width / 2, c.y + clientY - rect.top - rect.height / 2, v.zoom);
  };
  const onClick = (e) => {
    if (moved.current || e.target.closest('[data-map-ui]')) return;
    if (pickMode && onPick) { onPick(toLatLng(e.clientX, e.clientY)); return; }
    setOpenCluster(null);
    onSelect?.(null);
  };
  const onDoubleClick = (e) => {
    if (e.target.closest('[data-map-ui]')) return;
    const rect = box.current.getBoundingClientRect();
    const v = viewRef.current;
    const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const geo = toLatLng(e.clientX, e.clientY);
    // sanft hineinzoomen: Punkt unter dem Mauszeiger bleibt stehen
    const z = clamp(Math.round(v.zoom) + 1, MIN_ZOOM, MAX_ZOOM);
    const g2 = project(geo.lat, geo.lng, z);
    const c = unproject(g2.x - anchor.x + rect.width / 2, g2.y - anchor.y + rect.height / 2, z);
    animateTo({ lat: c.lat, lng: c.lng, zoom: z }, 300);
  };
  const onKeyDown = (e) => {
    const v = viewRef.current;
    const step = 80;
    const c = project(v.lat, v.lng, v.zoom);
    const pan = (dx, dy) => { const p = unproject(c.x + dx, c.y + dy, v.zoom); setView({ ...v, lat: p.lat, lng: p.lng }); };
    if (e.key === 'ArrowLeft') pan(-step, 0);
    else if (e.key === 'ArrowRight') pan(step, 0);
    else if (e.key === 'ArrowUp') pan(0, -step);
    else if (e.key === 'ArrowDown') pan(0, step);
    else if (e.key === '+' || e.key === '=') animateTo({ ...v, zoom: clamp(Math.round(v.zoom) + 1, MIN_ZOOM, MAX_ZOOM) }, 250);
    else if (e.key === '-') animateTo({ ...v, zoom: clamp(Math.round(v.zoom) - 1, MIN_ZOOM, MAX_ZOOM) }, 250);
    else return;
    e.preventDefault();
  };

  // ---------- Kacheln ----------
  const tz = clamp(Math.round(view.zoom), MIN_ZOOM, MAX_ZOOM);
  const scale = 2 ** (view.zoom - tz);
  const ct = project(view.lat, view.lng, tz);
  const tiles = [];
  const n = 2 ** tz;
  const x0 = Math.floor((ct.x - size.w / 2 / scale) / TILE);
  const x1 = Math.floor((ct.x + size.w / 2 / scale) / TILE);
  const y0 = Math.max(0, Math.floor((ct.y - size.h / 2 / scale) / TILE));
  const y1 = Math.min(n - 1, Math.floor((ct.y + size.h / 2 / scale) / TILE));
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const wx = ((x % n) + n) % n;
      tiles.push({ key: `${tz}/${x}/${y}`, src: TILE_URL(tz, wx, y), left: (x * TILE - ct.x) * scale + size.w / 2, top: (y * TILE - ct.y) * scale + size.h / 2 });
    }
  }

  // ---------- Marker & Cluster ----------
  const placed = useMemo(() => {
    const c = project(view.lat, view.lng, view.zoom);
    const pts = [];
    for (const p of points) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      const w = project(p.lat, p.lng, view.zoom);
      const x = w.x - c.x + size.w / 2;
      const y = w.y - c.y + size.h / 2;
      if (x < -80 || y < -80 || x > size.w + 80 || y > size.h + 80) continue;
      pts.push({ p, x, y });
    }
    // Ausgewählter Punkt nie in einem Cluster verstecken
    const groups = [];
    for (const it of pts) {
      if (it.p.key === selectedKey) { groups.push({ x: it.x, y: it.y, items: [it] }); continue; }
      const g = groups.find((gr) => gr.items[0].p.key !== selectedKey && Math.abs(gr.x - it.x) < clusterRadius && Math.abs(gr.y - it.y) < clusterRadius);
      if (g) {
        g.items.push(it);
        g.x = (g.x * (g.items.length - 1) + it.x) / g.items.length;
        g.y = (g.y * (g.items.length - 1) + it.y) / g.items.length;
      } else groups.push({ x: it.x, y: it.y, items: [it] });
    }
    return groups;
  }, [points, view, size, selectedKey, clusterRadius]);

  const clickCluster = (g) => {
    const pts = g.items.map((i) => i.p);
    const lats = pts.map((p) => p.lat);
    const lngs = pts.map((p) => p.lng);
    const spread = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs));
    // Alle am (fast) selben Ort oder schon ganz nah → Liste zeigen, sonst hineinzoomen
    if (spread < 0.0008 || viewRef.current.zoom >= 16) setOpenCluster({ keys: pts.map((p) => p.key) });
    else fitBounds(pts, { padding: 90, maxZoom: 17 });
  };

  const selected = selectedKey ? placed.find((g) => g.items.length === 1 && g.items[0].p.key === selectedKey) : null;
  const clusterGroup = openCluster ? placed.find((g) => g.items.some((i) => openCluster.keys.includes(i.p.key))) : null;

  return (
    <div className={`smap ${pickMode ? 'picking' : ''}`} ref={box} tabIndex={0} role="application" aria-label="Karte – mit Pfeiltasten verschieben, mit + und − zoomen"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onClick={onClick} onDoubleClick={onDoubleClick} onKeyDown={onKeyDown}>
      <div className="smap-tiles" aria-hidden="true">
        {tiles.map((t) => (
          <img key={t.key} src={t.src} alt="" draggable={false} loading="eager" decoding="async"
            style={{ left: t.left, top: t.top, width: TILE * scale + 0.5, height: TILE * scale + 0.5 }}
            onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
        ))}
      </div>
      <div className="smap-markers">
        {placed.map((g) => (g.items.length === 1 ? (
          <button key={g.items[0].p.key} type="button" data-map-ui className={`smap-marker ${g.items[0].p.key === selectedKey ? 'selected' : ''}`}
            style={{ transform: `translate(${g.x}px, ${g.y}px)` }} aria-label={g.items[0].p.title}
            onClick={(e) => { e.stopPropagation(); setOpenCluster(null); onSelect?.(g.items[0].p); }}>
            {renderMarker(g.items[0].p, { selected: g.items[0].p.key === selectedKey })}
          </button>
        ) : (
          <button key={`cl-${g.items[0].p.key}`} type="button" data-map-ui className="smap-cluster"
            style={{ transform: `translate(${g.x}px, ${g.y}px)` }} aria-label={`${g.items.length} Einträge – hineinzoomen`}
            onClick={(e) => { e.stopPropagation(); onSelect?.(null); clickCluster(g); }}>
            {renderCluster(g.items.map((i) => i.p))}
          </button>
        )))}
      </div>
      {selected && renderPopup && (
        <div className={`smap-popup ${selected.y < 320 ? 'below' : ''}`} data-map-ui style={{ transform: `translate(${clamp(selected.x, 160, size.w - 160)}px, ${selected.y}px)`, '--arrow-x': `${selected.x - clamp(selected.x, 160, size.w - 160)}px` }} onClick={(e) => e.stopPropagation()}>
          {renderPopup(selected.items[0].p)}
        </div>
      )}
      {clusterGroup && renderPopup && (
        <div className={`smap-popup ${clusterGroup.y < 360 ? 'below' : ''}`} data-map-ui style={{ transform: `translate(${clamp(clusterGroup.x, 150, size.w - 150)}px, ${clusterGroup.y}px)`, '--arrow-x': `${clusterGroup.x - clamp(clusterGroup.x, 150, size.w - 150)}px` }} onClick={(e) => e.stopPropagation()}>
          {renderPopup({ cluster: clusterGroup.items.map((i) => i.p), close: () => setOpenCluster(null) })}
        </div>
      )}
      <div className="smap-zoom" data-map-ui>
        <button type="button" aria-label="Hineinzoomen" onClick={() => animateTo({ ...viewRef.current, zoom: clamp(Math.round(viewRef.current.zoom) + 1, MIN_ZOOM, MAX_ZOOM) }, 250)}>+</button>
        <button type="button" aria-label="Herauszoomen" onClick={() => animateTo({ ...viewRef.current, zoom: clamp(Math.round(viewRef.current.zoom) - 1, MIN_ZOOM, MAX_ZOOM) }, 250)}>−</button>
      </div>
      <div className="smap-attrib" data-map-ui>
        © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>-Mitwirkende
      </div>
      {children}
    </div>
  );
});
