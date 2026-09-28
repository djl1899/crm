// End-to-End-API-Test gegen eine LEERE Datenbank.
// Start: Server lokal starten (npm run local), dann: node scripts/api-test.mjs
const BASE = 'http://localhost:8888/api';
let cookie = '';
let fails = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { fails++; console.log('  ✗', msg); } };
async function call(method, path, body, { csrf = true, form = false, raw = false, useCookie = true } = {}) {
  const headers = {};
  if (csrf) headers['X-Requested-With'] = 'crm';
  if (body && !form) headers['Content-Type'] = 'application/json';
  if (useCookie && cookie) headers.cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body ? (form ? body : JSON.stringify(body)) : undefined });
  const sc = res.headers.get('set-cookie');
  if (sc && useCookie) cookie = sc.split(';')[0];
  if (raw) return res;
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

console.log('Auth');
let r = await call('GET', '/auth/status');
ok(r.data.needsSetup === true, 'Setup nötig bei leerer DB');
r = await call('GET', '/creators');
ok(r.status === 401, 'Geschützte Route ohne Login → 401');
r = await call('POST', '/auth/setup', { name: 'Admin', email: 'admin@test.de', password: 'kurz' });
ok(r.status === 422, 'Zu kurzes Passwort abgelehnt');
r = await call('POST', '/auth/setup', { name: 'Admin', email: 'admin@test.de', password: 'sicher1234' }, { csrf: false });
ok(r.status === 403, 'CSRF-Header fehlt → 403');
r = await call('POST', '/auth/setup', { name: 'David Admin', email: 'Admin@Test.de', password: 'sicher1234', demo: false });
ok(r.status === 200 && r.data.user.role === 'admin', 'Ersteinrichtung legt Admin an');
r = await call('POST', '/auth/setup', { name: 'X', email: 'x@test.de', password: 'sicher1234' });
ok(r.status === 409, 'Zweites Setup verhindert');
cookie = '';
r = await call('POST', '/auth/login', { email: 'admin@test.de', password: 'falsch123' });
ok(r.status === 401, 'Falsches Passwort → 401');
r = await call('POST', '/auth/login', { email: 'ADMIN@test.de', password: 'sicher1234' });
ok(r.status === 200, 'Login (E-Mail case-insensitiv)');

console.log('Benutzer');
r = await call('POST', '/users', { name: 'Max Mustermann', email: 'max@test.de', password: 'passwort123', role: 'manager' });
ok(r.status === 200, 'Admin legt Manager an');
const maxId = r.data.user.id;
r = await call('POST', '/users', { name: 'Dup', email: 'max@test.de', password: 'passwort123' });
ok(r.status === 409, 'Doppelte E-Mail abgelehnt');

console.log('Tags');
r = await call('POST', '/tags', { name: 'Fashion', color: 'pink' });
const tFashion = r.data.tag.id;
r = await call('POST', '/tags', { name: 'Premium', color: 'amber' });
const tPremium = r.data.tag.id;
r = await call('POST', '/tags', { name: 'fashion' });
ok(r.status === 409, 'Tag-Duplikat (case-insensitiv) abgelehnt');

console.log('Creator CRUD + Validierung');
r = await call('POST', '/creators', { display_name: '' });
ok(r.status === 422 && r.data.details.display_name, 'Pflichtfeld Name');
r = await call('POST', '/creators', { display_name: 'X', email: 'kaputt' });
ok(r.status === 422 && r.data.details.email, 'Ungültige E-Mail');
r = await call('POST', '/creators', { display_name: 'X', instagram: { username: 'x', followers: -5 } });
ok(r.status === 422, 'Negative Follower abgelehnt: ' + r.data.error);
r = await call('POST', '/creators', { display_name: 'X', tiktok: { url: 'kein url' } });
ok(r.status === 422, 'Ungültige URL abgelehnt: ' + r.data.error);
r = await call('POST', '/creators', {
  display_name: 'Anna Müller', email: 'anna@example.com', city: 'Berlin', region: 'Berlin', country: 'Deutschland', niche: 'Fashion / Lifestyle',
  instagram: { username: '@anna', followers: 125000, engagement_rate: '4,2' }, tiktok: { username: 'https://www.tiktok.com/@annamueller', followers: 280000 },
  tag_ids: [tFashion, tPremium], manager_id: maxId, status: 'Aktiv',
});
ok(r.status === 201, 'Creator angelegt');
const anna = r.data.creator.id;
r = await call('POST', '/creators', { display_name: 'Tom Big', country: 'Deutschland', instagram: { username: 'tombig', followers: 150000 } });
const tom = r.data.creator.id;
await call('POST', '/creators', { display_name: 'Lisa Small', country: 'Deutschland', instagram: { username: 'lisa', followers: 20000 } });
await call('POST', '/creators', { display_name: 'Wien Big', country: 'Österreich', instagram: { username: 'wien', followers: 300000 } });
r = await call('GET', `/creators/${anna}`);
ok(r.data.socials.instagram.username === 'anna' && r.data.socials.instagram.url === 'https://www.instagram.com/anna/', 'Username normalisiert + URL generiert');
ok(r.data.socials.tiktok.username === 'annamueller', 'TikTok-Username aus URL extrahiert');
ok(r.data.socials.instagram.engagement_rate === 4.2, 'Engagement Rate mit Komma');
ok(r.data.tags.length === 2 && r.data.creator.manager_name === 'Max Mustermann', 'Tags & Manager verknüpft');

console.log('Suche & Filter');
r = await call('GET', '/creators?country=Deutschland&followers_platform=instagram&min_followers=100001&contacted=no');
ok(r.data.total === 2 && r.data.items.every((c) => c.instagram_followers > 100000), 'Beispiel: DE, >100k IG, nicht angeschrieben → ' + r.data.items.map((c) => c.display_name).join(', '));
r = await call('GET', '/creators?q=@annamueller');
ok(r.data.total === 1, 'Suche nach TikTok-Username');
r = await call('GET', `/creators?tags=${tFashion},${tPremium}`);
ok(r.data.total === 1, 'Tag-Filter');
r = await call('GET', '/creators?sort=followers&dir=desc');
ok(r.data.items[0].display_name === 'Wien Big', 'Sortierung nach Followern');
r = await call('GET', '/creators?sort=name&dir=asc&page_size=2&page=2');
ok(r.data.items.length === 2 && r.data.pages === 2, 'Pagination');

console.log('Bearbeiten & Aktivitäten');
r = await call('PATCH', `/creators/${tom}`, { status: 'Kontakt aufgenommen', city: 'Hamburg' });
ok(r.status === 200, 'Creator bearbeitet');
r = await call('GET', `/creators/${tom}/activities`);
ok(r.data.items.some((a) => a.message.includes("von 'Lead' auf 'Kontakt aufgenommen'")), 'Statusänderung protokolliert');
const before = r.data.items.length;
r = await call('GET', `/creators/${tom}`);
await call('PATCH', `/creators/${tom}`, { instagram: { username: 'tombig', followers: 150000 }, tag_ids: [] });
r = await call('GET', `/creators/${tom}/activities`);
ok(r.data.items.length === before, 'Unveränderte Social-/Tag-Daten erzeugen keinen Log-Eintrag');

console.log('Outreach & Follow-ups');
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
r = await call('POST', '/outreach', { creator_id: tom, channel: 'Instagram DM', subject: 'Erstkontakt', result: 'Erstkontakt', follow_up_date: '2020-01-01' });
ok(r.status === 201, 'Kontakt erfasst');
r = await call('GET', `/creators/${tom}`);
ok(r.data.creator.contacted === true && r.data.creator.outreach_status === 'Kontaktiert', 'Automatisch angeschrieben + Status Kontaktiert');
r = await call('GET', '/followups?range=overdue');
ok(r.data.items.length === 1, 'Überfälliges Follow-up erscheint');
r = await call('POST', '/outreach', { creator_id: tom, channel: 'E-Mail', result: 'Antwort erhalten', outreach_status: 'Antwort erhalten', follow_up_date: today });
r = await call('GET', '/followups?range=overdue');
ok(r.data.items.length === 0, 'Neuer Kontakt schließt alte Follow-ups');
r = await call('GET', '/followups?range=today');
ok(r.data.items.length === 1, 'Follow-up heute');
r = await call('GET', '/outreach?creator_id=' + tom);
ok(r.data.items.length === 2 && new Date(r.data.items[0].occurred_at) >= new Date(r.data.items[1].occurred_at), 'Kontaktverlauf chronologisch');

console.log('Kooperationen & Finanzen');
r = await call('POST', '/collaborations', { creator_id: anna, brand: 'Brand A', start_date: '2026-03-01', end_date: '2026-02-01' });
ok(r.status === 422, 'Enddatum vor Start abgelehnt');
for (const [fee, status] of [[2000, 'Abgeschlossen'], [3500, 'Aktiv'], [1500, 'Geplant'], [999, 'Anfrage'], [500, 'Abgebrochen']]) {
  r = await call('POST', '/collaborations', { creator_id: anna, brand: 'Brand ' + fee, fee, status, start_date: today });
}
ok(r.status === 201, 'Kooperationen angelegt');
r = await call('GET', `/collaborations?creator_id=${anna}&status=Aktiv`);
const collabId = r.data.items[0].id;
r = await call('GET', `/creators/${anna}`);
ok(r.data.stats.total_revenue === 7000, 'Gesamtumsatz = 7.000 € (nur bestätigte Kooperationen): ' + r.data.stats.total_revenue);
ok(r.data.stats.active_collabs === 1, 'Aktive Kooperationen gezählt');
r = await call('PATCH', `/collaborations/${collabId}`, { invoice_status: 'Bezahlt' });
ok(r.status === 200, 'Rechnungsstatus geändert');
r = await call('GET', '/finance/summary');
ok(r.data.totals.total === 7000 && r.data.totals.month === 7000 && r.data.totals.paid === 3500, 'Finanzübersicht Monat/Gesamt/Bezahlt');
r = await call('GET', `/collaborations?creator_id=${anna}&timeframe=past`);
ok(r.data.items.length === 2, 'Vergangene Kooperationen (abgeschlossen/abgebrochen)');

console.log('Aufgaben');
r = await call('POST', '/tasks', { title: 'Briefing senden', creator_id: anna, collaboration_id: collabId, due_date: today, priority: 'Hoch' });
ok(r.status === 201, 'Aufgabe erstellt');
const taskId = r.data.id;
r = await call('POST', '/tasks', { title: 'Falsch', creator_id: tom, collaboration_id: collabId });
ok(r.status === 422, 'Kooperation eines anderen Creators abgelehnt');
r = await call('GET', '/tasks?due=today&status=open');
ok(r.data.items.length === 1, 'Filter heute fällig');
r = await call('PATCH', `/tasks/${taskId}`, { status: 'Erledigt' });
r = await call('GET', `/tasks/${taskId}`);
ok(r.data.task.completed_at, 'Abschlussdatum gesetzt');

console.log('Verträge & Dokumente');
r = await call('PUT', `/creators/${anna}/contract`, { status: 'Aktiv', start_date: today, end_date: '2027-12-31', exclusivity: 'Fashion' });
ok(r.status === 200 && r.data.contract.status === 'Aktiv', 'Vertrag gespeichert');
r = await call('GET', '/creators?has_contract=yes');
ok(r.data.total === 1, 'Filter Vertrag vorhanden');
const pdf = new Blob([Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')], { type: 'application/pdf' });
let fd = new FormData();
fd.append('file', pdf, 'Vertrag Anna.pdf'); fd.append('creator_id', String(anna)); fd.append('category', 'Verträge');
r = await call('POST', '/documents', fd, { form: true });
ok(r.status === 201, 'PDF hochgeladen');
const docId = r.data.id;
fd = new FormData();
fd.append('file', new Blob(['<script>alert(1)</script>']), 'boese.pdf'); fd.append('creator_id', String(anna)); fd.append('category', 'Verträge');
r = await call('POST', '/documents', fd, { form: true });
ok(r.status === 415, 'Getarnte Datei abgelehnt');
fd = new FormData();
fd.append('file', new Blob(['x']), 'a.exe'); fd.append('creator_id', String(anna)); fd.append('category', 'Verträge');
r = await call('POST', '/documents', fd, { form: true });
ok(r.status === 415, '.exe abgelehnt');
let res = await call('GET', `/documents/${docId}/file?download=1`, null, { raw: true });
const txt = await res.text();
ok(res.status === 200 && txt.startsWith('%PDF') && res.headers.get('content-disposition').startsWith('attachment'), 'Download funktioniert');
r = await call('GET', `/creators/${anna}/activities`);
ok(r.data.items.some((a) => a.action === 'contract_uploaded'), 'Upload in Historie');
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000050001', 'hex');
fd = new FormData(); fd.append('file', new Blob([png]), 'a.png');
r = await call('POST', `/creators/${anna}/avatar`, fd, { form: true });
ok(r.status === 200 && r.data.avatar_url, 'Profilbild hochgeladen');
res = await call('GET', r.data.avatar_url.replace('/api', ''), null, { raw: true });
ok(res.status === 200 && res.headers.get('content-type') === 'image/png', 'Profilbild ausgeliefert');

console.log('Dashboard & globale Suche');
r = await call('GET', '/dashboard');
ok(r.status === 200 && r.data.kpi.creators_total === 4 && r.data.kpi.contracts_active === 1, 'Dashboard-KPIs');
ok(r.data.followups.length === 1 && r.data.activities.length > 5, 'Dashboard Follow-ups & Aktivitäten');
r = await call('GET', '/search?q=brand 35');
ok(r.data.collaborations.length === 1, 'Globale Suche findet Brand');
r = await call('GET', '/search?q=briefing');
ok(r.data.tasks.length === 1, 'Globale Suche findet Aufgabe');
r = await call('GET', '/search?q=@annamueller');
ok(r.data.creators.length === 1, 'Globale Suche findet TikTok-Username');

console.log('Rechte');
const adminC = cookie;
cookie = '';
await call('POST', '/auth/login', { email: 'max@test.de', password: 'passwort123' });
r = await call('GET', `/creators/${anna}`);
ok(r.status === 200, 'Manager sieht alle Creator');
r = await call('PATCH', `/creators/${tom}`, { niche: 'Gaming' });
ok(r.status === 200, 'Manager darf bearbeiten');
r = await call('POST', '/users', { name: 'Hacker', email: 'h@test.de', password: 'passwort123' });
ok(r.status === 403, 'Manager darf keine Benutzer anlegen');
r = await call('DELETE', `/creators/${tom}`);
ok(r.status === 403, 'Manager darf nicht endgültig löschen');
const maxCookie = cookie;
cookie = adminC;
r = await call('PATCH', `/users/${maxId}`, { is_active: false });
ok(r.status === 200, 'Admin deaktiviert Manager');
cookie = maxCookie;
r = await call('GET', '/creators');
ok(r.status === 401, 'Bestehende Sitzung des deaktivierten Benutzers ungültig');
cookie = '';
r = await call('POST', '/auth/login', { email: 'max@test.de', password: 'passwort123' });
ok(r.status === 403, 'Deaktivierter Benutzer kann sich nicht anmelden');
cookie = adminC;
r = await call('GET', '/creators', null, { raw: true });
ok(r.status === 200, 'Admin-Sitzung weiterhin gültig');

console.log('Archivieren & Löschen');
r = await call('PATCH', `/creators/${tom}`, { status: 'Archiviert' });
r = await call('GET', '/creators');
ok(!r.data.items.some((c) => c.id === tom), 'Archivierter Creator nicht in aktiver Liste');
r = await call('GET', '/creators?archived=only');
ok(r.data.items.length === 1 && r.data.items[0].id === tom, 'Aber über Archiv-Filter auffindbar');
r = await call('DELETE', `/creators/${anna}`);
ok(r.status === 200, 'Endgültig gelöscht (Admin)');
r = await call('GET', `/documents/${docId}/file`, null, { raw: true });
ok(r.status === 404, 'Zugehörige Dateien mitgelöscht');
r = await call('GET', '/collaborations?creator_id=' + anna);
ok(r.data.total === 0, 'Kooperationen kaskadierend gelöscht');

console.log('Demo-Daten');
r = await call('POST', '/admin/seed-demo');
ok(r.status === 409, 'Demo-Daten nur in leere DB');

console.log(fails ? `\n${fails} FEHLER` : '\nAlle Tests bestanden.');
process.exit(fails ? 1 : 0);
