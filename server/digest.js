// Tägliche Zusammenfassung per E-Mail (Follow-ups, Aufgaben, Drehs, Deadlines)
import { q, TODAY } from './db.js';
import { sendMail } from './mailer.js';
import { getSettings } from './settings.js';
import { OPEN_TASK_STATUSES, MEDIA_CLOSED_STATUSES } from '../shared/constants.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const list = (arr) => arr.map((s) => `'${s}'`).join(',');
const dateDe = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('.') : '');
const timeDe = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
const appUrl = () => (process.env.APP_URL || process.env.URL || '').replace(/\/$/, '');

/** Sammelt alles Fällige für einen Benutzer. Zugeordnet = eigene Einträge oder eigene Creator (Manager). */
export async function collectDigest(userId) {
  const [followups, tasks, shoots, deliveries, deadlines, payouts] = await Promise.all([
    q(`select o.creator_id, c.display_name, o.follow_up_date, o.channel, o.subject, (o.follow_up_date < ${TODAY}) as overdue
       from outreach_activities o join creators c on c.id = o.creator_id
       where o.follow_up_done = false and o.follow_up_date <= ${TODAY} and (o.user_id = $1 or c.manager_id = $1)
       order by o.follow_up_date limit 30`, [userId]),
    q(`select t.id, t.title, t.due_date, t.priority, c.display_name, (t.due_date < ${TODAY}) as overdue
       from tasks t left join creators c on c.id = t.creator_id
       where t.status in (${list(OPEN_TASK_STATUSES)}) and t.due_date <= ${TODAY} and t.assignee_id = $1
       order by t.due_date, array_position(array['Dringend','Hoch','Normal','Niedrig']::text[], t.priority) limit 30`, [userId]),
    q(`select m.id, m.client_name, m.title, m.shoot_at, m.shoot_location,
         ((m.shoot_at at time zone 'Europe/Berlin')::date = ${TODAY}) as today
       from media_projects m
       where m.status not in (${list(MEDIA_CLOSED_STATUSES)}) and (m.assignee_id = $1 or m.assignee_id is null)
         and (m.shoot_at at time zone 'Europe/Berlin')::date between ${TODAY} and ${TODAY} + 1
       order by m.shoot_at limit 20`, [userId]),
    q(`select m.id, m.client_name, m.title, m.delivery_date, (m.delivery_date < ${TODAY}) as overdue
       from media_projects m
       where m.status not in (${list(MEDIA_CLOSED_STATUSES)}, 'Geliefert') and (m.assignee_id = $1 or m.assignee_id is null)
         and m.delivery_date <= ${TODAY} + 2
       order by m.delivery_date limit 20`, [userId]),
    q(`select co.creator_id, c.display_name, co.brand, co.campaign_name, co.deadline
       from collaborations co join creators c on c.id = co.creator_id
       where co.status not in ('Abgeschlossen', 'Abgebrochen') and co.deadline between ${TODAY} and ${TODAY} + 3
         and (c.manager_id = $1 or c.manager_id is null)
       order by co.deadline limit 20`, [userId]),
    q(`select count(*)::int as n, coalesce(sum(f.payout), 0) as sum
       from collab_finance f join creators c on c.id = f.creator_id
       where f.payout_status = 'Offen' and f.invoice_status = 'Bezahlt' and (c.manager_id = $1 or c.manager_id is null)`, [userId]),
  ]);
  const payout = payouts[0];
  const empty = !followups.length && !tasks.length && !shoots.length && !deliveries.length && !deadlines.length && !payout.n;
  return { followups, tasks, shoots, deliveries, deadlines, payout, empty };
}

export async function buildDigestMail(user, data) {
  const base = appUrl();
  const settings = await getSettings().catch(() => ({ agency_name: '' }));
  const link = (path, label) => (base ? `<a href="${base}${path}" style="color:#4f46e5;text-decoration:none">${esc(label)}</a>` : esc(label));
  const today = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Berlin' });
  const sections = [];
  const text = [`Guten Morgen ${user.name.split(' ')[0]},`, `hier ist deine Übersicht für ${today}.`, ''];
  const add = (title, items) => {
    if (!items.length) return;
    sections.push(`<h3 style="font-size:15px;margin:22px 0 8px;color:#111827">${esc(title)} (${items.length})</h3><ul style="margin:0;padding-left:18px;color:#374151;line-height:1.6">${items.map((i) => `<li>${i.html}</li>`).join('')}</ul>`);
    text.push(`${title} (${items.length})`, ...items.map((i) => `- ${i.text}`), '');
  };
  const red = (s) => `<span style="color:#dc2626;font-weight:600">${s}</span>`;

  add('Follow-ups fällig', data.followups.map((f) => ({
    html: `${link(`/creators/${f.creator_id}?tab=outreach`, f.display_name)} – ${f.overdue ? red(`seit ${dateDe(f.follow_up_date)}`) : 'heute'}${f.subject ? ` · ${esc(f.subject)}` : ''}`,
    text: `${f.display_name} – ${f.overdue ? 'überfällig seit ' + dateDe(f.follow_up_date) : 'heute'}${f.subject ? ' · ' + f.subject : ''}`,
  })));
  add('Deine Aufgaben', data.tasks.map((t) => ({
    html: `${link(`/tasks?open=${t.id}`, t.title)}${t.display_name ? ` (${esc(t.display_name)})` : ''} – ${t.overdue ? red(`fällig seit ${dateDe(t.due_date)}`) : 'heute fällig'}${t.priority === 'Dringend' || t.priority === 'Hoch' ? ` · ${esc(t.priority)}` : ''}`,
    text: `${t.title}${t.display_name ? ' (' + t.display_name + ')' : ''} – ${t.overdue ? 'fällig seit ' + dateDe(t.due_date) : 'heute fällig'}`,
  })));
  add('Drehs heute & morgen', data.shoots.map((m) => ({
    html: `<strong>${m.today ? 'Heute' : 'Morgen'} ${timeDe(m.shoot_at)} Uhr</strong> – ${link(`/media?open=${m.id}`, `${m.client_name}: ${m.title}`)}${m.shoot_location ? ` · ${esc(m.shoot_location)}` : ''}`,
    text: `${m.today ? 'Heute' : 'Morgen'} ${timeDe(m.shoot_at)} Uhr – ${m.client_name}: ${m.title}${m.shoot_location ? ' · ' + m.shoot_location : ''}`,
  })));
  add('Media-Abgaben', data.deliveries.map((m) => ({
    html: `${link(`/media?open=${m.id}`, `${m.client_name}: ${m.title}`)} – ${m.overdue ? red(`überfällig seit ${dateDe(m.delivery_date)}`) : `bis ${dateDe(m.delivery_date)}`}`,
    text: `${m.client_name}: ${m.title} – ${m.overdue ? 'überfällig seit ' : 'bis '}${dateDe(m.delivery_date)}`,
  })));
  add('Kooperations-Deadlines (3 Tage)', data.deadlines.map((d) => ({
    html: `${link(`/creators/${d.creator_id}?tab=collaborations`, d.display_name)} – ${esc(d.brand)}${d.campaign_name ? ` (${esc(d.campaign_name)})` : ''} bis ${dateDe(d.deadline)}`,
    text: `${d.display_name} – ${d.brand}${d.campaign_name ? ' (' + d.campaign_name + ')' : ''} bis ${dateDe(d.deadline)}`,
  })));
  if (data.payout.n) {
    const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(data.payout.sum);
    add('Creator-Auszahlungen fällig', [{ html: `${data.payout.n} Kooperation(en), Brand hat bezahlt – ${eur} an Creator auszahlen (${link('/finance', 'Finanzen')})`, text: `${data.payout.n} Kooperation(en), ${eur} an Creator auszahlen` }]);
  }
  if (data.empty) {
    sections.push('<p style="color:#374151">Heute ist nichts fällig – freie Bahn für neuen Outreach. 🚀</p>');
    text.push('Heute ist nichts fällig.');
  }
  const count = data.followups.length + data.tasks.length + data.shoots.length + data.deliveries.length + data.deadlines.length;
  const subject = data.empty ? `Dein Tag: nichts fällig (${today})` : `Dein Tag: ${count} Punkt${count === 1 ? '' : 'e'} fällig – ${today}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
<div style="max-width:600px;margin:0 auto;padding:24px 16px">
<div style="background:#fff;border:1px solid #e6e8ec;border-radius:12px;padding:24px 26px">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;font-weight:600">${esc(settings.agency_name || 'LLK Management')} · Tagesübersicht</div>
<h2 style="margin:6px 0 4px;font-size:20px;color:#111827">Guten Morgen ${esc(user.name.split(' ')[0])}</h2>
<div style="color:#6b7280">${esc(today)}</div>
${sections.join('\n')}
${base ? `<p style="margin-top:26px"><a href="${base}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">CRM öffnen</a></p>` : ''}
</div>
<p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:14px">Du bekommst diese Mail, weil die tägliche Zusammenfassung in deinen Einstellungen aktiviert ist.</p>
</div></body></html>`;
  if (base) text.push('', `CRM öffnen: ${base}`);
  return { subject, html, text: text.join('\n') };
}

export async function sendDigestTo(user, { force = false } = {}) {
  const data = await collectDigest(user.id);
  if (data.empty && !force) return { user: user.email, sent: false, reason: 'nichts fällig' };
  const mail = await buildDigestMail(user, data);
  await sendMail({ to: user.email, subject: mail.subject, text: mail.text, html: mail.html, fromName: 'LLK Management CRM' });
  return { user: user.email, sent: true };
}

/** Wird von der geplanten Netlify-Funktion jeden Morgen aufgerufen. */
export async function sendAllDigests() {
  const users = await q(`select id, name, email from users where digest_enabled = true and is_active = true and role <> 'creator'`);
  const results = [];
  for (const u of users) {
    try {
      results.push(await sendDigestTo(u));
    } catch (e) {
      results.push({ user: u.email, sent: false, error: e.message });
    }
  }
  return results;
}
