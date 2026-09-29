// Gemeinsame Konstanten für Frontend und Backend.
// Neue Werte (z. B. weitere Plattformen) können hier ergänzt werden.

export const CREATOR_STATUSES = [
  'Lead',
  'Kontakt aufgenommen',
  'Im Gespräch',
  'Verhandlung',
  'Aktiv',
  'Pausiert',
  'Abgelehnt',
  'Archiviert',
];
export const ARCHIVED_STATUS = 'Archiviert';

export const OUTREACH_STATUSES = [
  'Noch nicht kontaktiert',
  'Kontaktiert',
  'Antwort erhalten',
  'Kein Interesse',
  'Follow-up erforderlich',
  'Im Gespräch',
  'Abgeschlossen',
];

export const OUTREACH_CHANNELS = ['Instagram DM', 'E-Mail', 'Telefon', 'WhatsApp', 'Sonstiges'];

export const OUTREACH_RESULT_SUGGESTIONS = [
  'Erstkontakt',
  'Keine Antwort',
  'Antwort erhalten',
  'Interessiert',
  'Kein Interesse',
  'Angebot verschickt',
  'Termin vereinbart',
  'Nachgefasst',
];

export const COLLAB_STATUSES = [
  'Anfrage',
  'Verhandlung',
  'Geplant',
  'Aktiv',
  'Content ausstehend',
  'Abnahme',
  'Abgeschlossen',
  'Abgebrochen',
];
// Laufende Kooperationen
export const ACTIVE_COLLAB_STATUSES = ['Aktiv', 'Content ausstehend', 'Abnahme'];
// Kooperationen, deren Vergütung als Umsatz zählt (bestätigte Deals)
export const REVENUE_COLLAB_STATUSES = ['Geplant', 'Aktiv', 'Content ausstehend', 'Abnahme', 'Abgeschlossen'];

export const EXPENSE_CATEGORIES = [
  'Domain & Hosting', 'Software & Tools', 'Werbung & Marketing', 'Equipment', 'Reisekosten',
  'Creator-Auszahlung', 'Büro & Verwaltung', 'Rechts- & Steuerberatung', 'Sonstiges',
];

// Media Produktion
export const MEDIA_STATUSES = [
  'Anfrage', 'Angebot gesendet', 'Gebucht', 'Dreh geplant', 'Gedreht', 'Schnitt', 'Feedback', 'Geliefert', 'Abgeschlossen', 'Abgebrochen',
];
export const MEDIA_CLOSED_STATUSES = ['Abgeschlossen', 'Abgebrochen'];
export const MEDIA_TYPES = ['Social Media Content', 'Reel / TikTok', 'Imagefilm', 'Werbespot', 'Fotoshooting', 'Event', 'Hochzeit', 'Produktfotos', 'Sonstiges'];

export const INVOICE_STATUSES = ['Nicht erstellt', 'Offen', 'Eingereicht', 'Bezahlt', 'Überfällig'];

export const TASK_STATUSES = ['Offen', 'In Bearbeitung', 'Wartet auf Creator', 'Erledigt', 'Abgebrochen'];
export const OPEN_TASK_STATUSES = ['Offen', 'In Bearbeitung', 'Wartet auf Creator'];
export const TASK_PRIORITIES = ['Niedrig', 'Normal', 'Hoch', 'Dringend'];

export const CONTRACT_STATUSES = ['Kein Vertrag', 'In Vorbereitung', 'Zur Unterschrift', 'Aktiv', 'Ausgelaufen', 'Gekündigt'];

export const DOCUMENT_CATEGORIES = ['Verträge', 'Rechnungen', 'Briefings', 'Kampagnenunterlagen', 'Sonstige Dokumente'];

// Plattformen: weitere Einträge hier ergänzen (z. B. YouTube) – DB-Tabelle social_accounts ist generisch.
export const PLATFORMS = [
  { key: 'instagram', label: 'Instagram', profileUrl: (u) => `https://www.instagram.com/${u}/` },
  { key: 'tiktok', label: 'TikTok', profileUrl: (u) => `https://www.tiktok.com/@${u}` },
];
export const PLATFORM_KEYS = PLATFORMS.map((p) => p.key);

export const ROLES = [
  { key: 'admin', label: 'Administrator' },
  { key: 'manager', label: 'Manager' },
];
export const ROLE_KEYS = ROLES.map((r) => r.key);

export const TAG_COLORS = ['gray', 'blue', 'green', 'amber', 'red', 'violet', 'pink', 'teal'];

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB (Request-Limit von Netlify Functions: ~6 MB inkl. Kodierung)

export const ALLOWED_UPLOAD_TYPES = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
  'text/plain': ['txt'],
  'text/csv': ['csv'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.ms-powerpoint': ['ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
  'application/zip': ['zip'],
};
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
