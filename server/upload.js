import crypto from 'node:crypto';
import { HttpError } from './http.js';
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from '../shared/constants.js';

const EXT_TO_MIME = {};
for (const [mime, exts] of Object.entries(ALLOWED_UPLOAD_TYPES)) for (const e of exts) EXT_TO_MIME[e] = mime;

export function sanitizeFilename(name) {
  const base = String(name || 'datei')
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (base || 'datei').slice(0, 150);
}

function startsWith(buf, bytes, offset = 0) {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

// Prüft die Datei-Signatur ("Magic Bytes"), damit keine getarnten Dateien hochgeladen werden.
function signatureMatches(mime, buf) {
  switch (mime) {
    case 'application/pdf': return startsWith(buf, [0x25, 0x50, 0x44, 0x46]);
    case 'image/png': return startsWith(buf, [0x89, 0x50, 0x4e, 0x47]);
    case 'image/jpeg': return startsWith(buf, [0xff, 0xd8, 0xff]);
    case 'image/gif': return startsWith(buf, [0x47, 0x49, 0x46, 0x38]);
    case 'image/webp': return startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8);
    case 'application/zip':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return startsWith(buf, [0x50, 0x4b]);
    case 'application/msword':
    case 'application/vnd.ms-excel':
    case 'application/vnd.ms-powerpoint':
      return startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0]);
    case 'text/plain':
    case 'text/csv':
      return !buf.subarray(0, 4096).includes(0);
    default:
      return false;
  }
}

/**
 * Liest einen multipart-Upload (Feld "file") und prüft Typ, Größe und Signatur.
 * Gibt { buffer, filename, mime, size, fields } zurück.
 */
export async function readUpload(req, { allowedMimes = Object.keys(ALLOWED_UPLOAD_TYPES), maxBytes = MAX_UPLOAD_BYTES } = {}) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len && len > maxBytes + 64 * 1024) throw new HttpError(413, `Die Datei ist zu groß (max. ${Math.round(maxBytes / 1024 / 1024)} MB).`);
  let form;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, 'Upload konnte nicht gelesen werden.');
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') throw new HttpError(422, 'Bitte eine Datei auswählen.', { file: 'Keine Datei.' });
  if (file.size === 0) throw new HttpError(422, 'Die Datei ist leer.');
  if (file.size > maxBytes) throw new HttpError(413, `Die Datei ist zu groß (max. ${Math.round(maxBytes / 1024 / 1024)} MB).`);

  const filename = sanitizeFilename(file.name);
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const mime = EXT_TO_MIME[ext];
  if (!mime || !allowedMimes.includes(mime)) {
    throw new HttpError(415, 'Dieser Dateityp ist nicht erlaubt.', { file: 'Dateityp nicht erlaubt.' });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!signatureMatches(mime, buffer)) {
    throw new HttpError(415, 'Der Dateiinhalt passt nicht zur Dateiendung.', { file: 'Ungültiger Inhalt.' });
  }
  const fields = {};
  for (const [k, val] of form.entries()) if (k !== 'file' && typeof val === 'string') fields[k] = val;
  return { buffer, filename, mime, size: buffer.length, fields };
}

export const randomKey = () => crypto.randomBytes(12).toString('hex');

/** Antwort für eine gespeicherte Datei mit sicheren Headern. */
export function fileResponse(data, { filename, mime, inline = false, cache = 'private, no-store' }) {
  const canInline = inline && (mime === 'application/pdf' || mime.startsWith('image/') || mime === 'text/plain');
  const encoded = encodeURIComponent(filename);
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  const headers = {
      'Content-Type': mime,
      'Content-Disposition': `${canInline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': cache,
  };
  // PDFs brauchen den eingebauten Browser-Viewer; alle anderen Dateien werden per CSP isoliert.
  if (mime !== 'application/pdf') {
    headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";
  }
  return new Response(data, { status: 200, headers });
}
