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
@page { size: A4; margin: 14mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; background: #eef0f4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { max-width: 820px; margin: 28px auto; background: #fff; border-radius: 18px; overflow: hidden; box-shadow: 0 10px 40px rgba(17,24,39,.12); }
.hero { background: linear-gradient(135deg, #312e81, #6d28d9 60%, #db2777); color: #fff; padding: 40px 44px 34px; display: flex; gap: 28px; align-items: center; }
.avatar { width: 132px; height: 132px; border-radius: 50%; object-fit: cover; border: 4px solid rgba(255,255,255,.85); flex-shrink: 0; background: rgba(255,255,255,.18); display: grid; place-items: center; font-size: 44px; font-weight: 700; }
.kicker { text-transform: uppercase; letter-spacing: .14em; font-size: 11.5px; opacity: .8; font-weight: 600; }
h1 { font-size: 38px; margin: 6px 0 6px; letter-spacing: -.02em; line-height: 1.05; }
.sub { font-size: 15px; opacity: .92; }
.handles { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; }
.handle { display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,.16); border-radius: 999px; padding: 5px 12px; font-size: 13.5px; font-weight: 600; }
.handle svg { width: 15px; height: 15px; }
.body { padding: 34px 44px 38px; }
.stats { display: grid; grid-template-columns: repeat(${Math.max(2, byPlatform.length + 1)}, 1fr); gap: 14px; }
.stat { border: 1px solid #e6e8ec; border-radius: 14px; padding: 16px 18px; }
.stat .label { display: flex; align-items: center; gap: 6px; color: #6b7280; font-size: 12.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }
.stat .label svg { width: 15px; height: 15px; }
.stat .value { font-size: 30px; font-weight: 750; letter-spacing: -.02em; margin-top: 6px; }
.stat .meta { color: #6b7280; font-size: 13px; margin-top: 2px; }
.stat.total { background: #f5f3ff; border-color: #ddd6fe; }
.stat.total .value { color: #5b21b6; }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .1em; color: #6b7280; margin: 30px 0 10px; }
.about { font-size: 15.5px; line-height: 1.6; color: #374151; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { border: 1px solid #e6e8ec; border-radius: 999px; padding: 6px 13px; font-size: 13.5px; font-weight: 600; background: #f9fafb; }
.brand { background: #111827; color: #fff; border-color: #111827; }
.contact { margin-top: 34px; display: flex; justify-content: space-between; gap: 20px; align-items: center; border-top: 1px solid #e6e8ec; padding-top: 20px; font-size: 14px; }
.contact strong { display: block; font-size: 16px; }
.contact .muted { color: #6b7280; }
.hint { max-width: 820px; margin: 0 auto 30px; text-align: center; color: #6b7280; font-size: 13px; }
@media print { body { background: #fff; } .page { margin: 0; box-shadow: none; border-radius: 0; max-width: none; } .hint { display: none; } }
@media (max-width: 640px) { .hero { flex-direction: column; text-align: center; padding: 30px 22px; } .handles { justify-content: center; } .body { padding: 26px 22px; } .stats { grid-template-columns: 1fr 1fr; } h1 { font-size: 30px; } .contact { flex-direction: column; align-items: flex-start; } }
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
  <div class="body">
    <div class="stats">
      ${byPlatform.map((p) => `<div class="stat"><div class="label">${ICONS[p.key] || ''}${esc(p.label)}</div><div class="value">${compact(p.s.followers)}</div><div class="meta">Follower${p.s.engagement_rate ? ` · ${String(p.s.engagement_rate).replace('.', ',')} % Engagement` : ''}</div></div>`).join('')}
      <div class="stat total"><div class="label">Gesamtreichweite</div><div class="value">${compact(reach)}</div><div class="meta">über ${byPlatform.length || 0} Plattform${byPlatform.length === 1 ? '' : 'en'}</div></div>
    </div>
    ${c.bio ? `<h2>Über ${esc(firstName)}</h2><div class="about">${esc(c.bio).replace(/\n/g, '<br>')}</div>` : ''}
    ${c.niche || c.interests ? `<h2>Themen</h2><div class="chips">${[...new Map([...(c.niche || '').split(/[\/,;]/), ...(c.interests || '').split(/[\/,;]/)].map((x) => x.trim()).filter(Boolean).map((x) => [x.toLowerCase(), x])).values()].slice(0, 12).map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}
    ${brands.length ? `<h2>Bisherige Partner</h2><div class="chips">${brands.map((b) => `<span class="chip brand">${esc(b.brand)}</span>`).join('')}</div>` : ''}
    ${c.language ? `<h2>Sprache</h2><div class="about">${esc(c.language)}</div>` : ''}
    <div class="contact">
      <div><span class="muted">Kooperationsanfragen</span><strong>${esc(settings.agency_name || c.manager_name || '')}</strong>${c.manager_name ? `<span>${esc(c.manager_name)}</span>` : ''}</div>
      <div style="text-align:right">${contactEmail ? `<div>${esc(contactEmail)}</div>` : ''}${settings.agency_website ? `<div class="muted">${esc(settings.agency_website.replace(/^https?:\/\//, ''))}</div>` : ''}<div class="muted">Stand: ${new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' })}</div></div>
    </div>
  </div>
</div>
<p class="hint">Als PDF speichern: Drucken (Strg/Cmd + P) → „Als PDF sichern“. Tipp: Hintergrundgrafiken aktivieren.</p>
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
