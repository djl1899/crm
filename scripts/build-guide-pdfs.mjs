// Erzeugt die PDF-Versionen der Leitfäden (server/guides/pdfs.js).
// Nur lokal nötig, wenn Leitfäden geändert wurden:  PLAYWRIGHT=/pfad/zu/playwright node scripts/build-guide-pdfs.mjs
import fs from 'node:fs';
import path from 'node:path';
import { GUIDES, GUIDE_DISCLAIMER } from '../server/guides/index.js';
import { parseMarkdown, blocksToHtml } from '../shared/markdown.js';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const pwPath = process.env.PLAYWRIGHT || 'playwright';
const pwMod = await import(pwPath);
const { chromium } = pwMod.default || pwMod;
const asset = (f) => fs.readFileSync(path.join(root, 'scripts/pdf-assets', f)).toString('base64');
const AGENCY = 'LLK Management';

const css = `
@font-face { font-family: 'Archivo'; src: url(data:font/woff;base64,${asset('archivo.woff')}) format('woff'); font-weight: 100 900; }
@font-face { font-family: 'Geist'; src: url(data:font/woff2;base64,${asset('geist.woff2')}) format('woff2'); font-weight: 100 900; }
@page { size: A4; margin: 22mm 20mm 22mm 20mm; }
* { box-sizing: border-box; }
body { font-family: 'Geist', 'Helvetica Neue', Arial, sans-serif; color: #18181b; font-size: 10.5pt; line-height: 1.55; margin: 0; }
.head { border-bottom: 2px solid #0d0d0d; padding-bottom: 14pt; margin-bottom: 18pt; }
.eyebrow { font-size: 8.5pt; letter-spacing: .14em; text-transform: uppercase; color: #71717a; display: flex; justify-content: space-between; }
.eyebrow b { color: #0d0d0d; font-weight: 600; }
h1 { font-family: 'Archivo', sans-serif; font-weight: 800; font-size: 26pt; line-height: 1.05; letter-spacing: -0.02em; margin: 10pt 0 8pt; }
.summary { font-size: 12pt; color: #3f3f46; margin: 0; max-width: 150mm; }
.meta { margin-top: 8pt; font-size: 8.5pt; color: #71717a; }
.meta span + span::before { content: ' · '; }
h2 { font-family: 'Archivo', sans-serif; font-weight: 700; font-size: 14pt; margin: 18pt 0 6pt; letter-spacing: -0.01em; break-after: avoid; }
h2::before { content: ''; display: inline-block; width: 10pt; height: 3pt; background: #ff4f1f; vertical-align: middle; margin-right: 7pt; position: relative; top: -2pt; }
h3 { font-size: 11.5pt; margin: 12pt 0 4pt; break-after: avoid; }
p { margin: 0 0 7pt; }
ul, ol { margin: 0 0 8pt; padding-left: 16pt; }
li { margin-bottom: 3pt; }
a { color: #0d0d0d; }
table { width: 100%; border-collapse: collapse; margin: 4pt 0 10pt; font-size: 9.5pt; break-inside: avoid; }
th { text-align: left; background: #f4f4f5; font-weight: 600; }
th, td { border: 1px solid #e4e4e7; padding: 5pt 7pt; vertical-align: top; }
.note { border-radius: 6pt; padding: 8pt 11pt; margin: 6pt 0 11pt; break-inside: avoid; border: 1px solid; }
.note p:last-child, .note ul:last-child { margin-bottom: 0; }
.note-label { font-size: 8pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 3pt; }
.note-tip { background: #f0fdf4; border-color: #bbf7d0; } .note-tip .note-label { color: #15803d; }
.note-warn { background: #fff7ed; border-color: #fed7aa; } .note-warn .note-label { color: #c2410c; }
.note-info { background: #f4f4f5; border-color: #e4e4e7; } .note-info .note-label { color: #52525b; }
.disclaimer { margin-top: 18pt; padding-top: 8pt; border-top: 1px solid #e4e4e7; font-size: 8.5pt; color: #71717a; }
`;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const browser = await chromium.launch();
const page = await browser.newPage();
const out = {};
for (const g of GUIDES) {
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>${css}</style></head><body>
  <div class="head">
    <div class="eyebrow"><b>${AGENCY}</b><span>Leitfaden · ${esc(g.category)}</span></div>
    <h1>${esc(g.title)}</h1>
    <p class="summary">${esc(g.summary)}</p>
    <div class="meta"><span>Stand ${esc(g.updated)}</span><span>ca. ${g.minutes} Min. Lesezeit</span>${g.audience === 'team' ? '<span>Intern – nur fürs Team</span>' : ''}</div>
  </div>
  ${blocksToHtml(parseMarkdown(g.body))}
  <p class="disclaimer">${esc(GUIDE_DISCLAIMER)}</p>
  </body></html>`;
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const pdf = await page.pdf({
    format: 'A4', printBackground: true, displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="font-size:7pt;color:#a1a1aa;width:100%;padding:0 20mm;display:flex;justify-content:space-between;font-family:Arial"><span>${AGENCY} · ${esc(g.title)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' },
  });
  out[g.slug] = pdf.toString('base64');
  console.log('PDF', g.slug, Math.round(pdf.length / 1024) + ' KB');
}
await browser.close();
fs.writeFileSync(
  path.join(root, 'server/guides/pdfs.js'),
  `// Automatisch erzeugt von scripts/build-guide-pdfs.mjs – nicht von Hand bearbeiten.\nexport const GUIDE_PDFS = ${JSON.stringify(out)};\n`
);
console.log('fertig:', Object.keys(out).length, 'PDFs');
