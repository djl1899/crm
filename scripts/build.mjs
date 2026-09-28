// Frontend-Build mit esbuild → dist/
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });

await build({
  entryPoints: { app: path.join(root, 'src/main.jsx') },
  outdir: path.join(dist, 'assets'),
  bundle: true,
  minify: true,
  sourcemap: false,
  format: 'esm',
  target: ['es2020', 'chrome100', 'safari15', 'firefox100'],
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  logLevel: 'info',
});

const version = Date.now().toString(36);
for (const f of fs.readdirSync(path.join(root, 'public'))) {
  const src = path.join(root, 'public', f);
  let content = fs.readFileSync(src);
  if (f === 'index.html') content = content.toString().replaceAll('__VERSION__', version);
  fs.writeFileSync(path.join(dist, f), content);
}
console.log('Build fertig → dist/');
