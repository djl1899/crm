// Schlanker SMTP-Versand (ohne Zusatzpakete) – z. B. über IONOS:
//   SMTP_HOST=smtp.ionos.de  SMTP_PORT=465  SMTP_USER=deine@adresse.de  SMTP_PASS=…  (SMTP_FROM optional)
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

export function mailConfig() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const parsedPort = parseInt(String(process.env.SMTP_PORT || '').trim(), 10);
  const port = parsedPort > 0 && parsedPort < 65536 ? parsedPort : 465;
  const secure = (process.env.SMTP_SECURE || (port === 465 ? 'ssl' : 'starttls')).toLowerCase();
  // SMTP_FROM darf „adresse@x.de“ oder „Name <adresse@x.de>“ sein
  const rawFrom = (process.env.SMTP_FROM || user || '').trim();
  const m = rawFrom.match(/^(.*?)\s*<([^>]+)>$/);
  const from = (m ? m[2] : rawFrom).trim();
  const fromName = m ? m[1].replace(/^"|"$/g, '').trim() : '';
  return { host, user, pass, port, secure, from, fromName, configured: !!(host && user && pass) };
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const encodeHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n');

function buildMessage({ from, fromName, to, subject, text, html }) {
  const boundary = 'b_' + crypto.randomBytes(12).toString('hex');
  const domain = (from.split('@')[1] || 'localhost').replace(/[^a-z0-9.-]/gi, '');
  const fromHeader = fromName ? `${encodeHeader(fromName)} <${from}>` : from;
  return [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomBytes(16).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(text || '')),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(html || '')),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/** Verbindung, die SMTP-Antworten (auch mehrzeilig) liest. */
function smtpConnection(socket) {
  let buffer = '';
  let waiting = null;
  let closedErr = null;
  const tryResolve = () => {
    if (!waiting) return;
    const lines = buffer.split('\r\n');
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\d{3} /.test(lines[i])) {
        const block = lines.slice(0, i + 1);
        buffer = lines.slice(i + 1).join('\r\n');
        const w = waiting;
        waiting = null;
        w.resolve({ code: Number(block[i].slice(0, 3)), text: block.join('\n') });
        return;
      }
    }
  };
  const attach = (s) => {
    s.setEncoding('utf8');
    s.on('data', (d) => { buffer += d; tryResolve(); });
    s.on('error', (e) => { closedErr = e; if (waiting) { waiting.reject(e); waiting = null; } });
    s.on('close', () => { if (waiting) { waiting.reject(closedErr || new Error('Verbindung zum Mailserver geschlossen.')); waiting = null; } });
  };
  attach(socket);
  const api = {
    socket,
    read: () => new Promise((resolve, reject) => { waiting = { resolve, reject }; tryResolve(); }),
    async cmd(line, expect) {
      api.socket.write(line + '\r\n');
      const res = await api.read();
      if (expect && !expect.includes(res.code)) {
        const shown = line.startsWith('AUTH') || /^[A-Za-z0-9+/=]{8,}$/.test(line) ? '(Anmeldung)' : line.split(' ')[0];
        const err = new Error(`Mailserver lehnt ${shown} ab: ${res.text}`);
        err.smtpCode = res.code;
        throw err;
      }
      return res;
    },
    upgrade(newSocket) { api.socket = newSocket; buffer = ''; attach(newSocket); },
  };
  return api;
}

export async function sendMail({ to, subject, text, html, fromName }) {
  const cfg = mailConfig();
  if (!cfg.configured) {
    const e = new Error('E-Mail-Versand ist nicht eingerichtet (SMTP_HOST, SMTP_USER, SMTP_PASS in Netlify setzen).');
    e.code = 'MAIL_NOT_CONFIGURED';
    throw e;
  }
  const timeoutMs = 15000;
  const socket = await new Promise((resolve, reject) => {
    const s = cfg.secure === 'ssl'
      ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
      : net.connect({ host: cfg.host, port: cfg.port });
    s.setTimeout(timeoutMs, () => s.destroy(new Error('Zeitüberschreitung beim Mailserver.')));
    s.once(cfg.secure === 'ssl' ? 'secureConnect' : 'connect', () => resolve(s));
    s.once('error', reject);
  });
  const c = smtpConnection(socket);
  try {
    const greet = await c.read();
    if (greet.code !== 220) throw new Error('Unerwartete Begrüßung vom Mailserver: ' + greet.text);
    const helo = 'crm.local';
    let ehlo = await c.cmd(`EHLO ${helo}`, [250]);
    if (cfg.secure === 'starttls') {
      await c.cmd('STARTTLS', [220]);
      const secured = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket: c.socket, servername: cfg.host }, () => resolve(t));
        t.once('error', reject);
      });
      c.upgrade(secured);
      ehlo = await c.cmd(`EHLO ${helo}`, [250]);
    }
    if (/AUTH[ =][^\n]*PLAIN/i.test(ehlo.text)) {
      await c.cmd('AUTH PLAIN ' + Buffer.from(`\0${cfg.user}\0${cfg.pass}`, 'utf8').toString('base64'), [235]);
    } else {
      await c.cmd('AUTH LOGIN', [334]);
      await c.cmd(b64(cfg.user), [334]);
      await c.cmd(b64(cfg.pass), [235]);
    }
    await c.cmd(`MAIL FROM:<${cfg.from}>`, [250]);
    for (const rcpt of [].concat(to)) await c.cmd(`RCPT TO:<${rcpt}>`, [250, 251]);
    await c.cmd('DATA', [354]);
    const msg = buildMessage({ from: cfg.from, fromName: fromName || cfg.fromName, to: [].concat(to).join(', '), subject, text, html });
    await c.cmd(msg.replace(/\r\n\./g, '\r\n..') + '\r\n.', [250]);
    await c.cmd('QUIT').catch(() => {});
  } finally {
    c.socket.destroy();
  }
  return { ok: true };
}
