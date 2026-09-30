// Zwei-Faktor-Anmeldung (TOTP, RFC 6238) – kompatibel mit Google Authenticator, Microsoft Authenticator,
// Apple Passwörter, 1Password usw. Keine externen Dienste: das Geheimnis verlässt nie den Server/Browser.
import crypto from 'node:crypto';
// QR-Code-Erzeugung: MIT-Lizenz, (c) Kazuhiko Arase – siehe server/vendor/qrcode/LICENSE
import QRCode from './vendor/qrcode/index.cjs';
import QRErrorCorrectLevel from './vendor/qrcode/QRErrorCorrectLevel.cjs';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const generateSecret = () => base32Encode(crypto.randomBytes(20));

function hotp(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = h[h.length - 1] & 0xf;
  const code = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / 30);
export const totpAt = (secret, step) => hotp(secret, step);

/**
 * Prüft einen 6-stelligen Code (±1 Zeitfenster = ±30 s Toleranz).
 * Gibt das verwendete Zeitfenster zurück (für Replay-Schutz) oder null.
 */
export function verifyTotp(secret, code, lastUsedStep = null) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c) || !secret) return null;
  const now = currentStep();
  for (const step of [now, now - 1, now + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    const expected = hotp(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return step;
  }
  return null;
}

export function otpauthUrl({ secret, account, issuer = 'Creator CRM' }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** QR-Code als SVG (wird lokal erzeugt, kein externer Dienst). */
export function qrSvg(text) {
  const qr = new QRCode(-1, QRErrorCorrectLevel.M);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const border = 4;
  const size = n + border * 2;
  let path = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) path += `M${c + border},${r + border}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

// ---------- Wiederherstellungscodes (falls das Handy verloren geht) ----------
export function generateRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(crypto.randomBytes(6)).slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}
export const hashRecoveryCode = (code) =>
  crypto.createHash('sha256').update(String(code).toUpperCase().replace(/[^A-Z2-7]/g, '')).digest('hex');
