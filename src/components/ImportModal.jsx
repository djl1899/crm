import { useState } from 'react';
import { api } from '../lib/api.js';
import { invalidateAll } from '../lib/useApi.js';
import { readCsvFile, toCsv } from '../lib/csv.js';
import { Modal, Button, Select, useUi } from './ui.jsx';
import { Icon } from './Icon.jsx';

export const IMPORT_FIELDS = [
  ['display_name', 'Creator Name', ['name', 'creator', 'creatorname', 'anzeigename', 'creator name']],
  ['first_name', 'Vorname', ['vorname', 'firstname']],
  ['last_name', 'Nachname', ['nachname', 'lastname', 'familienname']],
  ['email', 'E-Mail', ['email', 'e-mail', 'mail', 'emailadresse']],
  ['phone', 'Telefon', ['telefon', 'telefonnummer', 'handy', 'phone', 'tel', 'mobil']],
  ['instagram', 'Instagram (Username/Link)', ['instagram', 'ig', 'insta', 'instagramusername', 'instagramhandle', 'instagramlink', 'instagramurl', 'instagramname']],
  ['instagram_followers', 'Instagram Follower', ['instagramfollower', 'igfollower', 'instafollower', 'followerinstagram', 'follower', 'followers', 'instagramfollowers']],
  ['tiktok', 'TikTok (Username/Link)', ['tiktok', 'tiktokusername', 'tiktokhandle', 'tiktoklink', 'tiktokurl', 'tiktokname']],
  ['tiktok_followers', 'TikTok Follower', ['tiktokfollower', 'tiktokfollowers', 'followertiktok']],
  ['niche', 'Nische', ['nische', 'niche', 'kategorie', 'thema', 'bereich']],
  ['city', 'Ort', ['ort', 'stadt', 'city', 'wohnort']],
  ['region', 'Region', ['region', 'bundesland']],
  ['country', 'Land', ['land', 'country']],
  ['language', 'Sprache', ['sprache', 'language']],
  ['interests', 'Interessen', ['interessen', 'interests']],
  ['tags', 'Tags (mit Komma getrennt)', ['tags', 'tag', 'schlagworte', 'labels']],
  ['status', 'Status', ['status']],
  ['manager', 'Verantwortlicher (Name/E-Mail)', ['manager', 'verantwortlich', 'verantwortlicher', 'betreuer']],
  ['commission_rate', 'Provision (%)', ['provision', 'provisionprozent', 'commission']],
  ['notes', 'Notizen', ['notizen', 'notiz', 'notes', 'bemerkung', 'bemerkungen', 'kommentar', 'info']],
];

const norm = (s) => String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/[^a-z0-9]/g, '');

function autoMap(header) {
  const used = new Set();
  return header.map((h) => {
    const n = norm(h);
    const hit = IMPORT_FIELDS.find(([key, , syn]) => !used.has(key) && (syn.map(norm).includes(n) || norm(key) === n));
    if (hit) { used.add(hit[0]); return hit[0]; }
    return '';
  });
}

export function downloadImportTemplate() {
  const rows = [
    ['Name', 'Vorname', 'Nachname', 'E-Mail', 'Telefon', 'Instagram', 'Instagram Follower', 'TikTok', 'TikTok Follower', 'Nische', 'Ort', 'Region', 'Land', 'Tags', 'Notizen'],
    ['Lisa Beispiel', 'Lisa', 'Beispiel', 'lisa@example.com', '+49 151 1234567', '@lisa.beispiel', '12.500', '@lisabsp', '30K', 'Beauty', 'Köln', 'NRW', 'Deutschland', 'Beauty, UGC', 'Über Empfehlung'],
  ];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  a.download = 'creator-import-vorlage.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ImportModal({ open, onClose }) {
  const { toast } = useUi();
  const [csv, setCsv] = useState(null); // { header, rows, fileName }
  const [mapping, setMapping] = useState([]);
  const [skipDup, setSkipDup] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);

  const reset = () => { setCsv(null); setMapping([]); setResult(null); setProgress(0); setBusy(false); };
  const close = () => { if (!busy) { reset(); onClose(); } };

  const pick = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) {
      toast('Bitte die Tabelle zuerst als CSV speichern (Excel: Datei → Speichern unter → CSV UTF-8).', 'error');
      return;
    }
    try {
      const parsed = await readCsvFile(file);
      if (!parsed.header.length || !parsed.rows.length) throw new Error('Die Datei enthält keine Datenzeilen.');
      if (parsed.rows.length > 5000) throw new Error('Maximal 5.000 Zeilen pro Import.');
      setCsv({ ...parsed, fileName: file.name });
      setMapping(autoMap(parsed.header));
    } catch (err) {
      toast(err.message || 'Datei konnte nicht gelesen werden.', 'error');
    }
  };

  const mappedKeys = mapping.filter(Boolean);
  const hasName = ['display_name', 'first_name', 'last_name', 'instagram', 'tiktok'].some((k) => mappedKeys.includes(k));

  const run = async () => {
    setBusy(true);
    setProgress(0);
    const objects = csv.rows.map((r) => {
      const o = {};
      mapping.forEach((key, i) => { if (key && r[i] !== '') o[key] = r[i]; });
      return o;
    });
    const total = { created: 0, skipped: [], errors: [] };
    try {
      for (let i = 0; i < objects.length; i += 100) {
        const res = await api.post('/creators/import', { rows: objects.slice(i, i + 100), skip_duplicates: skipDup, offset: i });
        total.created += res.created;
        total.skipped.push(...res.skipped);
        total.errors.push(...res.errors);
        setProgress(Math.min(objects.length, i + 100));
      }
      setResult(total);
      invalidateAll();
    } catch (err) {
      toast(err.message, 'error');
      setResult({ ...total, aborted: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} size="lg" title="Creator importieren (CSV)"
      footer={
        result ? <Button variant="primary" onClick={close}>Fertig</Button> : (
          <>
            {csv && <Button onClick={reset} className="mr-auto" disabled={busy}>Andere Datei</Button>}
            <Button onClick={close} disabled={busy}>Abbrechen</Button>
            {csv && <Button variant="primary" icon="upload" onClick={run} loading={busy} disabled={!hasName}>{csv.rows.length} Zeilen importieren</Button>}
          </>
        )
      }>
      {!csv && !result && (
        <div className="stack">
          <p className="muted">Lade eine CSV-Datei hoch, z. B. aus Excel („Speichern unter → CSV UTF-8“), Google Sheets („Datei → Herunterladen → CSV“) oder Numbers („Exportieren → CSV“). Die erste Zeile muss die Spaltennamen enthalten.</p>
          <label className="dropzone">
            <input type="file" accept=".csv,text/csv,text/plain" onChange={pick} />
            <Icon name="upload" size={22} />
            <span>CSV-Datei auswählen</span>
          </label>
          <button type="button" className="link small" onClick={downloadImportTemplate}>Beispiel-Vorlage herunterladen</button>
        </div>
      )}

      {csv && !result && (
        <div className="stack">
          <p className="muted small"><strong>{csv.fileName}</strong> · {csv.rows.length} Zeilen · {csv.header.length} Spalten. Prüfe, welche Spalte in welches Feld soll – nicht zugeordnete Spalten werden ignoriert.</p>
          <div className="table-wrap import-map">
            <table className="table table-compact">
              <thead><tr><th>Spalte in deiner Datei</th><th>Beispielwerte</th><th>Übernehmen als</th></tr></thead>
              <tbody>
                {csv.header.map((h, i) => (
                  <tr key={i}>
                    <td className="strong">{h || <span className="muted">(leer)</span>}</td>
                    <td className="muted clip-wide">{csv.rows.slice(0, 3).map((r) => r[i]).filter(Boolean).join(' · ') || '–'}</td>
                    <td>
                      <Select value={mapping[i]} onChange={(e) => setMapping((m) => m.map((x, k) => (k === i ? e.target.value : x === e.target.value ? '' : x)))}
                        placeholder="– ignorieren –" options={IMPORT_FIELDS.map(([key, label]) => ({ value: key, label }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!hasName && <div className="alert alert-error"><Icon name="alert" size={16} /><span>Bitte mindestens eine Spalte als Name, Vorname/Nachname oder Instagram/TikTok zuordnen.</span></div>}
          <label className="checkbox">
            <input type="checkbox" checked={skipDup} onChange={(e) => setSkipDup(e.target.checked)} />
            <span>Doppelte überspringen (gleicher Name, gleiche E-Mail oder gleicher Instagram-/TikTok-Username)</span>
          </label>
          <p className="muted small">Importierte Creator bekommen den Status „Lead“ (sofern keine Status-Spalte zugeordnet ist) und „Noch nicht kontaktiert“. Fehlende Tags werden automatisch angelegt.</p>
          {busy && <div className="progress"><span style={{ width: `${(progress / csv.rows.length) * 100}%` }} /></div>}
        </div>
      )}

      {result && (
        <div className="stack">
          <div className="stat-row stat-row-3">
            <div className="stat"><div className="stat-label">Importiert</div><div className="stat-value tone-green">{result.created}</div></div>
            <div className="stat"><div className="stat-label">Übersprungen (doppelt)</div><div className="stat-value">{result.skipped.length}</div></div>
            <div className="stat"><div className="stat-label">Fehler</div><div className={`stat-value ${result.errors.length ? 'tone-red' : ''}`}>{result.errors.length}</div></div>
          </div>
          {result.aborted && <div className="alert alert-error"><Icon name="alert" size={16} /><span>Import abgebrochen: {result.aborted}</span></div>}
          {[...result.errors.map((e) => ({ ...e, kind: 'Fehler' })), ...result.skipped.map((e) => ({ ...e, kind: 'Übersprungen' }))].length > 0 && (
            <div className="table-wrap import-map">
              <table className="table table-compact">
                <thead><tr><th>Zeile</th><th>Name</th><th>Hinweis</th></tr></thead>
                <tbody>
                  {result.errors.map((e) => <tr key={'e' + e.line}><td>{e.line}</td><td>{e.name}</td><td className="tone-red">{e.reason}</td></tr>)}
                  {result.skipped.map((e) => <tr key={'s' + e.line}><td>{e.line}</td><td>{e.name}</td><td className="muted">{e.reason}</td></tr>)}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
