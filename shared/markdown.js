// Minimaler Markdown-Parser für die Leitfäden (keine HTML-Eingabe, daher sicher).
// Unterstützt: ## / ### Überschriften, Absätze, - Listen, 1. Listen, Tabellen mit |,
// Hinweisboxen (> [!TIPP], > [!ACHTUNG], > [!INFO]), **fett** und [Text](https://link).

export function parseMarkdown(md) {
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let i = 0;
  const isBlank = (l) => !l || !l.trim();
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    let m;
    if ((m = line.match(/^(#{2,3})\s+(.*)$/))) {
      blocks.push({ t: m[1].length === 2 ? 'h2' : 'h3', text: m[2].trim() });
      i++;
      continue;
    }
    if (line.startsWith('>')) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith('>')) buf.push(lines[i++].replace(/^>\s?/, ''));
      let kind = 'info';
      const head = buf[0] && buf[0].match(/^\[!(TIPP|ACHTUNG|INFO)\]\s*(.*)$/);
      if (head) {
        kind = head[1] === 'TIPP' ? 'tip' : head[1] === 'ACHTUNG' ? 'warn' : 'info';
        buf[0] = head[2];
      }
      blocks.push({ t: 'note', kind, blocks: parseMarkdown(buf.join('\n')) });
      continue;
    }
    if (line.trim().startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      blocks.push({ t: 'table', head: rows[0] || [], rows: rows.slice(1) });
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const re = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/;
      const items = [];
      while (i < lines.length && re.test(lines[i])) {
        let text = lines[i].replace(re, '');
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) text += ' ' + lines[i++].trim();
        items.push(text);
      }
      blocks.push({ t: ordered ? 'ol' : 'ul', items });
      continue;
    }
    const buf = [];
    while (i < lines.length && !isBlank(lines[i]) && !/^(#{2,3}\s|>|\s*\||\s*[-*]\s+|\s*\d+\.\s+)/.test(lines[i])) buf.push(lines[i++].trim());
    blocks.push({ t: 'p', text: buf.join(' ') });
  }
  return blocks;
}

/** Zerlegt Inline-Text in Segmente: { text } | { bold } | { link, href } */
export function parseInline(text) {
  const out = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ bold: m[1] });
    else out.push({ link: m[2], href: m[3] });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function inlineToHtml(text) {
  return parseInline(text)
    .map((s) => (s.bold !== undefined ? `<strong>${escHtml(s.bold)}</strong>` : s.link !== undefined ? `<a href="${escHtml(s.href)}">${escHtml(s.link)}</a>` : escHtml(s.text)))
    .join('');
}

export function blocksToHtml(blocks) {
  const NOTE_LABEL = { tip: 'Tipp', warn: 'Achtung', info: 'Gut zu wissen' };
  return blocks
    .map((b) => {
      if (b.t === 'h2' || b.t === 'h3') return `<${b.t}>${inlineToHtml(b.text)}</${b.t}>`;
      if (b.t === 'p') return `<p>${inlineToHtml(b.text)}</p>`;
      if (b.t === 'ul' || b.t === 'ol') return `<${b.t}>${b.items.map((it) => `<li>${inlineToHtml(it)}</li>`).join('')}</${b.t}>`;
      if (b.t === 'note') return `<div class="note note-${b.kind}"><div class="note-label">${NOTE_LABEL[b.kind]}</div>${blocksToHtml(b.blocks)}</div>`;
      if (b.t === 'table') {
        return `<table><thead><tr>${b.head.map((h) => `<th>${inlineToHtml(h)}</th>`).join('')}</tr></thead><tbody>${b.rows
          .map((r) => `<tr>${r.map((c) => `<td>${inlineToHtml(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`;
      }
      return '';
    })
    .join('\n');
}
