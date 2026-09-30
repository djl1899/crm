// Datenauskunft nach Art. 15 DSGVO: alle gespeicherten Daten zu einem Creator.
import { q, one } from '../db.js';
import { HttpError, idParam } from '../http.js';
import { logActivity } from '../activity.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v) => {
  if (v === null || v === undefined || v === '') return '–';
  if (typeof v === 'boolean') return v ? 'Ja' : 'Nein';
  if (Array.isArray(v)) return v.join(', ') || '–';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.split('-').reverse().join('.');
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) || /^\d{4}-\d{2}-\d{2} \d{2}:/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  }
  return s;
};

async function collect(id) {
  const creator = await one(
    `select c.id, c.display_name, c.first_name, c.last_name, c.email, c.phone, c.city, c.region, c.country, c.language,
       c.niche, c.interests, c.notes, c.status, c.outreach_status, c.contacted, (c.avatar_key is not null) as has_profile_picture,
       u.name as manager, c.created_at, c.updated_at
     from creators c left join users u on u.id = c.manager_id where c.id = $1`,
    [id]
  );
  if (!creator) throw new HttpError(404, 'Creator nicht gefunden.');
  const [socials, tags, contract, outreach, collaborations, tasks, documents, media, expenses, activities] = await Promise.all([
    q(`select platform, username, url, followers, engagement_rate, notes, updated_at from social_accounts where creator_id = $1 order by platform`, [id]),
    q(`select t.name from creator_tags x join tags t on t.id = x.tag_id where x.creator_id = $1 order by t.name`, [id]),
    one(`select status, start_date, end_date, exclusivity, usage_rights, notice_period, notes, updated_at from contracts where creator_id = $1`, [id]),
    q(`select o.occurred_at, o.channel, u.name as user_name, o.subject, o.message, o.result, o.follow_up_date
       from outreach_activities o left join users u on u.id = o.user_id where o.creator_id = $1 order by o.occurred_at`, [id]),
    q(`select id, brand, campaign_name, start_date, end_date, status, platform, description, deliverables, deadline, fee, invoice_status, notes
       from collaborations where creator_id = $1 order by start_date nulls last, id`, [id]),
    q(`select t.title, t.description, t.status, t.priority, t.due_date, t.completed_at, a.name as assignee, t.notes
       from tasks t left join users a on a.id = t.assignee_id where t.creator_id = $1 order by t.created_at`, [id]),
    q(`select d.filename, d.category, d.mime_type, d.size_bytes, d.created_at, u.name as uploaded_by
       from documents d left join users u on u.id = d.uploaded_by where d.creator_id = $1 order by d.created_at`, [id]),
    q(`select client_name, title, project_type, status, shoot_at, delivery_date, price, notes from media_projects where creator_id = $1 order by created_at`, [id]),
    q(`select expense_date, title, category, amount, notes from expenses where creator_id = $1 order by expense_date`, [id]),
    q(`select a.created_at, u.name as user_name, a.message from activities a left join users u on u.id = a.user_id
       where a.creator_id = $1 order by a.created_at`, [id]),
  ]);
  return {
    exported_at: new Date().toISOString(),
    hinweis: 'Datenauskunft gemäß Art. 15 DSGVO. Enthält alle im CRM zu dieser Person gespeicherten Daten. Hochgeladene Dateien sind aufgelistet und können separat bereitgestellt werden.',
    stammdaten: { ...creator, tags: tags.map((t) => t.name) },
    social_media: socials,
    vertrag: contract,
    kontaktverlauf: outreach,
    kooperationen: collaborations,
    aufgaben: tasks,
    dokumente: documents,
    media_projekte: media,
    ausgaben: expenses,
    aktivitaeten: activities,
  };
}

const DE = {
  id: 'ID', display_name: 'Name', first_name: 'Vorname', last_name: 'Nachname', email: 'E-Mail', phone: 'Telefon',
  city: 'Ort', region: 'Region', country: 'Land', language: 'Sprache', niche: 'Nische', interests: 'Interessen',
  notes: 'Notizen', status: 'Status', outreach_status: 'Kontaktstatus', contacted: 'Bereits kontaktiert',
  has_profile_picture: 'Profilbild gespeichert', manager: 'Zuständig', created_at: 'Angelegt', updated_at: 'Zuletzt geändert',
  tags: 'Schlagworte', platform: 'Plattform', username: 'Benutzername', url: 'Profil-URL', followers: 'Follower',
  engagement_rate: 'Engagement-Rate (%)', start_date: 'Beginn', end_date: 'Ende', exclusivity: 'Exklusivität',
  usage_rights: 'Nutzungsrechte', notice_period: 'Kündigungsfrist', occurred_at: 'Zeitpunkt', channel: 'Kanal',
  user_name: 'Bearbeitet von', subject: 'Betreff', message: 'Nachricht / Notiz', result: 'Ergebnis',
  follow_up_date: 'Wiedervorlage', brand: 'Marke', campaign_name: 'Kampagne', description: 'Beschreibung',
  deliverables: 'Leistungen', deadline: 'Deadline', fee: 'Vergütung (€)', invoice_status: 'Rechnungsstatus',
  title: 'Titel', priority: 'Priorität', due_date: 'Fällig', completed_at: 'Erledigt am', assignee: 'Verantwortlich',
  filename: 'Dateiname', category: 'Kategorie', mime_type: 'Dateityp', size_bytes: 'Größe (Bytes)', uploaded_by: 'Hochgeladen von',
  client_name: 'Kunde', project_type: 'Art', shoot_at: 'Drehtermin', delivery_date: 'Abgabe', price: 'Preis (€)',
  expense_date: 'Datum', amount: 'Betrag (€)',
};
const de = (k) => DE[k] || k;

const LABELS = {
  stammdaten: 'Stammdaten', social_media: 'Social Media', vertrag: 'Vertrag', kontaktverlauf: 'Kontaktverlauf',
  kooperationen: 'Kooperationen', aufgaben: 'Aufgaben', dokumente: 'Dokumente', media_projekte: 'Media-Projekte',
  ausgaben: 'Zugeordnete Ausgaben', aktivitaeten: 'Änderungsprotokoll',
};

function toHtml(data) {
  const section = (key, val) => {
    let body;
    if (val === null || (Array.isArray(val) && !val.length)) body = '<p class="empty">Keine Daten gespeichert.</p>';
    else if (Array.isArray(val)) {
      const cols = Object.keys(val[0]);
      body = `<table><thead><tr>${cols.map((c) => `<th>${esc(de(c))}</th>`).join('')}</tr></thead><tbody>${val
        .map((r) => `<tr>${cols.map((c) => `<td>${esc(fmt(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    } else {
      body = `<table class="kv">${Object.entries(val).map(([k, v]) => `<tr><th>${esc(de(k))}</th><td>${esc(fmt(v))}</td></tr>`).join('')}</table>`;
    }
    return `<h2>${esc(LABELS[key] || key)}</h2>${body}`;
  };
  const name = data.stammdaten.display_name;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Datenauskunft – ${esc(name)}</title>
<style>
body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;max-width:1000px;margin:32px auto;padding:0 20px;font-size:13px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
.meta{color:#555;margin-bottom:8px}.note{background:#f5f6f8;border:1px solid #e3e5e9;border-radius:8px;padding:10px 12px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #e3e5e9;padding:5px 7px;text-align:left;vertical-align:top}
th{background:#f7f8fa;font-weight:600;white-space:nowrap}.kv th{width:220px}.empty{color:#777}
@media print{body{margin:0}h2{break-after:avoid}tr{break-inside:avoid}}
</style></head><body>
<h1>Datenauskunft: ${esc(name)}</h1>
<div class="meta">Erstellt am ${esc(fmt(data.exported_at))}</div>
<div class="note">${esc(data.hinweis)}</div>
${Object.keys(LABELS).map((k) => section(k, data[k])).join('\n')}
</body></html>`;
}

export default function register(route) {
  route('GET', '/creators/:id/export', async ({ params, query, user }) => {
    const id = idParam(params.id);
    const data = await collect(id);
    const format = query.get('format') === 'html' ? 'html' : 'json';
    await logActivity({ creatorId: id, userId: user.id, entityType: 'creator', entityId: id, action: 'data_exported',
      message: `hat eine Datenauskunft (${format === 'html' ? 'Übersicht' : 'JSON'}) exportiert.` });
    const safe = data.stammdaten.display_name.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 60) || 'creator';
    const date = new Date().toISOString().slice(0, 10);
    const body = format === 'html' ? toHtml(data) : JSON.stringify(data, null, 2);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': format === 'html' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
        'Content-Disposition': `${format === 'html' ? 'inline' : 'attachment'}; filename="Datenauskunft_${safe}_${date}.${format}"`,
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  });
}
