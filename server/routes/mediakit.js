// Mediakit: druckbare One-Pager-Seite für Brands (nur öffentliche Angaben, keine internen Notizen/Kontaktdaten).
import { q, one } from '../db.js';
import { HttpError, idParam } from '../http.js';
import { getFile } from '../storage.js';
import { getSettings } from '../settings.js';
import { logActivity } from '../activity.js';
import { PLATFORMS } from '../../shared/constants.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('de-DE');
const compact = (n) => {
  if (n === null || n === undefined) return '–';
  if (n >= 1_000_000) return `${String((n / 1_000_000).toFixed(1)).replace('.', ',').replace(',0', '')} Mio.`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  return nf.format(n);
};
const ICONS = {
  instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2.5" y="2.5" width="19" height="19" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
};

export default function register(route) {
  route('GET', '/creators/:id/mediakit', async ({ params, user }) => {
    const id = idParam(params.id);
    const c = await one(
      `select c.*, u.name as manager_name, u.email as manager_email from creators c left join users u on u.id = c.manager_id where c.id = $1`,
      [id]
    );
    if (!c) throw new HttpError(404, 'Creator nicht gefunden.');
    const [socials, brands, settings] = await Promise.all([
      q(`select platform, username, url, followers, engagement_rate from social_accounts where creator_id = $1`, [id]),
      q(`select brand, max(coalesce(end_date, start_date, created_at::date)) as last
         from collaborations where creator_id = $1 and status in ('Geplant', 'Aktiv', 'Content ausstehend', 'Abnahme', 'Abgeschlossen')
         group by brand order by last desc limit 12`, [id]),
      getSettings(),
    ]);
    let avatar = '';
    if (c.avatar_key) {
      const f = await getFile(c.avatar_key).catch(() => null);
      if (f) avatar = `data:${f.metadata?.mime || 'image/jpeg'};base64,${Buffer.from(f.data).toString('base64')}`;
    }
    const byPlatform = PLATFORMS.map((p) => ({ ...p, s: socials.find((x) => x.platform === p.key) })).filter((p) => p.s);
    const reach = byPlatform.reduce((a, p) => a + (p.s.followers || 0), 0);
    const location = [c.city, c.region && c.region !== c.city ? c.region : null, c.country].filter(Boolean).join(', ');
    const initials = c.display_name.split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
    const contactEmail = settings.agency_email || c.manager_email || '';
    const firstName = c.first_name || c.display_name.split(' ')[0];

    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mediakit – ${esc(c.display_name)}</title>
<style>
@page { size: A4; margin: 16mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif; color: #111; background: #f4f4f4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { max-width: 780px; margin: 32px auto; background: #fff; padding: 56px 60px 48px; }
.hero { display: flex; gap: 28px; align-items: center; padding-bottom: 32px; border-bottom: 1px solid #111; }
.avatar { width: 112px; height: 112px; border-radius: 50%; object-fit: cover; flex-shrink: 0; background: #ececec; display: grid; place-items: center; font-size: 36px; font-weight: 500; color: #555; filter: grayscale(0); }
.kicker { text-transform: uppercase; letter-spacing: .18em; font-size: 10.5px; color: #888; }
h1 { font-size: 40px; font-weight: 500; margin: 8px 0 6px; letter-spacing: -.02em; line-height: 1.05; }
.sub { font-size: 14.5px; color: #555; }
.handles { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 4px 18px; }
.handle { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; color: #111; }
.handle svg { width: 14px; height: 14px; color: #888; }
.stats { display: grid; grid-template-columns: repeat(${Math.max(2, byPlatform.length + 1)}, 1fr); border-bottom: 1px solid #e5e5e5; }
.stat { padding: 26px 0 24px; }
.stat + .stat { padding-left: 24px; border-left: 1px solid #e5e5e5; }
.stat .label { display: flex; align-items: center; gap: 6px; color: #888; font-size: 10.5px; text-transform: uppercase; letter-spacing: .14em; }
.stat .label svg { width: 13px; height: 13px; }
.stat .value { font-size: 32px; font-weight: 400; letter-spacing: -.02em; margin-top: 8px; font-variant-numeric: tabular-nums; }
.stat .meta { color: #888; font-size: 12.5px; margin-top: 2px; }
h2 { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .18em; color: #888; margin: 34px 0 10px; }
.about { font-size: 15px; line-height: 1.65; color: #333; max-width: 620px; }
.chips { font-size: 14.5px; color: #333; line-height: 1.7; }
.chip:not(:last-child)::after { content: ' · '; color: #bbb; }
.contact { margin-top: 44px; display: flex; justify-content: space-between; gap: 20px; align-items: flex-end; border-top: 1px solid #111; padding-top: 18px; font-size: 13.5px; }
.contact strong { display: block; font-size: 15px; font-weight: 500; margin-top: 2px; }
.contact .muted { color: #888; }
.hint { max-width: 780px; margin: 0 auto 30px; text-align: center; color: #888; font-size: 12.5px; }
@media print { body { background: #fff; } .page { margin: 0; padding: 0; max-width: none; } .hint { display: none; } }
@media (max-width: 640px) { .page { margin: 0; padding: 32px 22px; } .hero { flex-direction: column; align-items: flex-start; } h1 { font-size: 32px; } .stats { grid-template-columns: 1fr 1fr; } .stat:nth-child(odd) { padding-left: 0; border-left: 0; } .contact { flex-direction: column; align-items: flex-start; } .contact div[style] { text-align: left !important; } }
</style></head><body>
<div class="page">
  <div class="hero">
    ${avatar ? `<img class="avatar" src="${avatar}" alt="">` : `<div class="avatar">${esc(initials)}</div>`}
    <div>
      <div class="kicker">Mediakit${settings.agency_name ? ` · ${esc(settings.agency_name)}` : ''}</div>
      <h1>${esc(c.display_name)}</h1>
      <div class="sub">${[c.niche, location].filter(Boolean).map(esc).join(' · ')}</div>
      <div class="handles">${byPlatform.filter((p) => p.s.username).map((p) => `<span class="handle">${ICONS[p.key] || ''}@${esc(p.s.username)}</span>`).join('')}</div>
    </div>
  </div>
  <div>
    <div class="stats">
      ${byPlatform.map((p) => `<div class="stat"><div class="label">${ICONS[p.key] || ''}${esc(p.label)}</div><div class="value">${compact(p.s.followers)}</div><div class="meta">Follower${p.s.engagement_rate ? ` · ${String(p.s.engagement_rate).replace('.', ',')} % Engagement` : ''}</div></div>`).join('')}
      <div class="stat"><div class="label">Gesamtreichweite</div><div class="value">${compact(reach)}</div><div class="meta">über ${byPlatform.length || 0} Plattform${byPlatform.length === 1 ? '' : 'en'}</div></div>
    </div>
    ${c.bio ? `<h2>Über ${esc(firstName)}</h2><div class="about">${esc(c.bio).replace(/\n/g, '<br>')}</div>` : ''}
    ${c.niche || c.interests ? `<h2>Themen</h2><div class="chips">${[...new Map([...(c.niche || '').split(/[\/,;]/), ...(c.interests || '').split(/[\/,;]/)].map((x) => x.trim()).filter(Boolean).map((x) => [x.toLowerCase(), x])).values()].slice(0, 12).map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}
    ${brands.length ? `<h2>Bisherige Partner</h2><div class="chips">${brands.map((b) => `<span class="chip">${esc(b.brand)}</span>`).join('')}</div>` : ''}
    ${c.language ? `<h2>Sprache</h2><div class="about">${esc(c.language)}</div>` : ''}
    <div class="contact">
      <div><span class="muted">Kooperationsanfragen</span><strong>${esc(settings.agency_name || c.manager_name || '')}</strong>${c.manager_name ? `<span>${esc(c.manager_name)}</span>` : ''}</div>
      <div style="text-align:right">${contactEmail ? `<div>${esc(contactEmail)}</div>` : ''}${settings.agency_website ? `<div class="muted">${esc(settings.agency_website.replace(/^https?:\/\//, ''))}</div>` : ''}<div class="muted">Stand: ${new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' })}</div></div>
    </div>
  </div>
</div>
<p class="hint">Als PDF speichern: Drucken (Strg/Cmd + P) → „Als PDF sichern“. </p>
</body></html>`;

    await logActivity({ creatorId: id, userId: user.id, entityType: 'creator', entityId: id, action: 'mediakit_opened', message: 'hat das Mediakit erstellt.' });
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  });
}
