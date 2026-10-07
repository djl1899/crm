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

// Bereich "App" (Marktplatz-App, getrennt vom CRM)
export const APP_INFLUENCER_STATUSES = ['Interessent', 'Warteliste', 'Beta-Tester', 'Aktiv', 'Inaktiv'];
export const APP_COMPANY_STATUSES = ['Lead', 'Im Gespräch', 'Pilotkunde', 'Zahlender Kunde', 'Abgesprungen'];
export const APP_CAMPAIGN_STATUSES = ['Entwurf', 'Matching', 'Aktiv', 'Abgeschlossen', 'Abgebrochen'];
export const APP_ASSIGNMENT_STATUSES = ['Vorgeschlagen', 'Angefragt', 'Zugesagt', 'Content geliefert', 'Bezahlt', 'Abgesagt'];
export const APP_ROADMAP_STATUSES = ['Idee', 'Geplant', 'In Arbeit', 'Test', 'Fertig'];
export const APP_ROADMAP_AREAS = ['Influencer-App', 'Firmen-Portal', 'KI-Matching', 'Backend', 'Design', 'Marketing', 'Recht & Finanzen'];
export const APP_UPDATE_TYPES = ['Meilenstein', 'Release', 'Feature', 'Bugfix', 'Notiz'];
export const APP_PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'Sonstiges'];

export const PAYOUT_STATUSES = ['Offen', 'Ausgezahlt'];
// Media-Projekte, die als Umsatz zählen (gebucht bis abgeschlossen)
export const MEDIA_REVENUE_EXCLUDED = ['Anfrage', 'Angebot gesendet', 'Abgebrochen'];

// Platzhalter für Nachrichten-Vorlagen
export const TEMPLATE_PLACEHOLDERS = [
  ['{Vorname}', 'Vorname (sonst Name)'], ['{Name}', 'Creator-Name'], ['{Nische}', 'Nische'], ['{Ort}', 'Ort'],
  ['{Instagram}', '@Instagram'], ['{TikTok}', '@TikTok'], ['{Follower}', 'Follower (höchster Wert)'], ['{MeinName}', 'Dein Name'],
];

export const INVOICE_STATUSES = ['Nicht erstellt', 'Offen', 'Eingereicht', 'Bezahlt', 'Überfällig'];

export const TASK_STATUSES = ['Offen', 'In Bearbeitung', 'Wartet auf Creator', 'Erledigt', 'Abgebrochen'];
export const OPEN_TASK_STATUSES = ['Offen', 'In Bearbeitung', 'Wartet auf Creator'];
export const TASK_PRIORITIES = ['Niedrig', 'Normal', 'Hoch', 'Dringend'];

export const CONTRACT_STATUSES = ['Kein Vertrag', 'In Vorbereitung', 'Zur Unterschrift', 'Aktiv', 'Ausgelaufen', 'Gekündigt'];

export const DOCUMENT_CATEGORIES = [
  'Managementvertrag', 'Vollmachten', 'Kampagnenverträge', 'Verträge',
  'Briefings', 'Freigaben', 'Kampagnenunterlagen',
  'Rechnungen', 'Belege', 'Sonstige Dokumente',
];
// Gruppierung im Creator-Bereich
export const PORTAL_DOC_GROUPS = [
  { key: 'mgmt', label: 'Managementvertrag & Vollmachten', categories: ['Managementvertrag', 'Vollmachten'] },
  { key: 'campaign', label: 'Kampagnenverträge', categories: ['Kampagnenverträge', 'Verträge'] },
  { key: 'briefing', label: 'Briefings & Freigaben', categories: ['Briefings', 'Freigaben', 'Kampagnenunterlagen'] },
  { key: 'invoices', label: 'Rechnungen & Belege', categories: ['Rechnungen', 'Belege'] },
  { key: 'other', label: 'Sonstiges', categories: ['Sonstige Dokumente'] },
];
// Was Creator selbst hochladen dürfen
export const PORTAL_UPLOAD_CATEGORIES = ['Rechnungen', 'Belege', 'Freigaben', 'Sonstige Dokumente'];
// Für Creator standardmäßig sichtbar, wenn das Team hochlädt
export const CREATOR_VISIBLE_DEFAULT = ['Managementvertrag', 'Vollmachten', 'Kampagnenverträge', 'Briefings', 'Freigaben', 'Rechnungen', 'Belege'];

// Creator-Sicht auf den Deal-Status
export const CREATOR_STAGES = ['Anfrage', 'Verhandlung', 'Bestätigt', 'Content fällig', 'Veröffentlicht', 'Rechnung', 'Bezahlt'];
// Eigene Kalendereinträge der Creator
export const CALENDAR_KINDS = ['Content-Plan', 'Termin', 'Erinnerung'];

export const CREATOR_EXPENSE_CATEGORIES = [
  'Technik & Equipment', 'Software & Abos', 'Requisiten & Deko', 'Reise & Fahrtkosten', 'Kleidung & Styling (nur Kostüm/Requisite)',
  'Werbung & Marketing', 'Büro & Telefon', 'Steuerberatung & Gebühren', 'Sonstiges',
];
export const REIMBURSEMENT_STATUSES = ['Keine', 'Beantragt', 'Erstattet', 'Abgelehnt'];
export const VAT_RATES = [19, 7, 0];

// Team: Kontaktlisten
export const CONTACT_STATUSES = ['Neu', 'Kontaktiert', 'Im Gespräch', 'Kunde', 'Kein Interesse'];

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

// Konfektionsgrößen (Creator-Profil)
const LETTER_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
export const SIZE_TOP_GROUPS = [
  { label: 'Buchstaben', options: LETTER_SIZES },
  { label: 'Konfektionsgröße (EU)', options: ['32', '34', '36', '38', '40', '42', '44', '46', '48', '50', '52', '54', '56'] },
];
export const SIZE_BOTTOM_GROUPS = [
  { label: 'Buchstaben', options: LETTER_SIZES },
  { label: 'Konfektionsgröße (EU)', options: ['32', '34', '36', '38', '40', '42', '44', '46', '48', '50', '52', '54', '56'] },
  { label: 'Jeans (Bundweite)', options: ['W24', 'W25', 'W26', 'W27', 'W28', 'W29', 'W30', 'W31', 'W32', 'W33', 'W34', 'W36', 'W38', 'W40'] },
];
export const SHOE_SIZES = Array.from({ length: 29 }, (_, i) => {
  const n = 35 + i / 2;
  return Number.isInteger(n) ? String(n) : `${Math.floor(n)},5`;
});
