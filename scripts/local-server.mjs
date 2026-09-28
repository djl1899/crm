// Lokaler Entwicklungs-/Testserver (ohne Netlify):
//   DATABASE_URL=postgres://... node scripts/local-server.mjs
// Liefert dist/ aus und leitet /api/* an dieselbe Handler-Funktion wie auf Netlify weiter.
// Dateien werden lokal in .local-files/ gespeichert statt in Netlify Blobs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { setStorage } from '../server/storage.js';
import { setDriver } from '../server/db.js';

const PORT = Number(process.env.PORT || 8888);
const root = path.resolve(new URL('..', import.meta.url).pathname);
const dist = path.join(root, 'dist');
const filesDir = path.join(root, '.local-files');

// Lokaler Dateispeicher
setStorage({
  async put(key, data, metadata) {
    const p = path.join(filesDir, key);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.from(data));
    fs.writeFileSync(p + '.meta.json', JSON.stringify(metadata || {}));
  },
  async get(key) {
    const p = path.join(filesDir, key);
    if (!fs.existsSync(p)) return null;
    return { data: fs.readFileSync(p), metadata: JSON.parse(fs.readFileSync(p + '.meta.json', 'utf8')) };
  },
  async remove(key) {
    const p = path.join(filesDir, key);
    fs.rmSync(p, { force: true });
    fs.rmSync(p + '.meta.json', { force: true });
  },
});

// Optional: Treiber über psql (falls das npm-Paket "pg" lokal nicht installiert ist)
if (process.env.USE_PSQL) {
  const lit = (v) => {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (Array.isArray(v)) return `'{${v.map((x) => JSON.stringify(x)).join(',')}}'`;
    return `'${String(v).replace(/'/g, "''")}'`;
  };
  const run = (sql, params = []) =>
    new Promise((resolve, reject) => {
      let text = sql.replace(/\$(\d+)/g, (_, n) => lit(params[Number(n) - 1]));
      const t = text.trim().toLowerCase();
      let wrapped = text;
      let parse = false;
      if (t.includes('pg_advisory')) wrapped = text;
      else if (t.startsWith('select') || t.startsWith('with')) { wrapped = `select coalesce(json_agg(t), '[]') from (${text}) t`; parse = true; }
      else if (/^(insert|update|delete)/.test(t) && /\breturning\b/.test(t)) { wrapped = `with t as (${text}) select coalesce(json_agg(t), '[]') from t`; parse = true; }
      execFile('psql', [process.env.DATABASE_URL, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', wrapped], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve(parse ? JSON.parse(stdout.trim() || '[]') : []);
      });
    });
  setDriver({ query: run, transaction: (fn) => fn(run) });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const { handle } = await import('../server/router.js');

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
    const response = await handle(request);
    const headers = {};
    response.headers.forEach((v, k) => (headers[k] = v));
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  let file = path.join(dist, decodeURIComponent(url.pathname));
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Creator CRM läuft auf http://localhost:${PORT}`));
