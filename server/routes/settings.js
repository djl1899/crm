import { q, one } from '../db.js';
import { HttpError, readJson, idParam, json } from '../http.js';
import { v, validate } from '../validate.js';
import { requireAdmin } from '../auth.js';
import { getSettings, setSetting } from '../settings.js';
import { OUTREACH_CHANNELS } from '../../shared/constants.js';
import { mailConfig } from '../mailer.js';
import { sendDigestTo } from '../digest.js';

export default function register(route) {
  // ---------- Allgemeine Einstellungen ----------
  route('GET', '/settings', async () => ({ settings: await getSettings() }));

  route('PUT', '/settings', async ({ req, user }) => {
    requireAdmin(user);
    const data = validate(await readJson(req), {
      default_commission_rate: v.num({ label: 'Standard-Provision', max: 100 }),
      agency_name: v.str({ label: 'Agenturname', max: 120 }),
      agency_email: v.email({ label: 'Agentur-E-Mail' }),
      agency_website: v.url({ label: 'Website' }),
    }, { partial: true });
    for (const [k, val] of Object.entries(data)) {
      if (k === 'default_commission_rate' && val === null) throw new HttpError(422, 'Bitte eine Standard-Provision angeben.', { default_commission_rate: 'Pflichtfeld.' });
      await setSetting(k, val ?? '');
    }
    return { settings: await getSettings() };
  });

  // ---------- Nachrichten-Vorlagen ----------
  const schema = {
    name: v.str({ label: 'Name der Vorlage', required: true, max: 120 }),
    channel: v.oneOf(OUTREACH_CHANNELS, { label: 'Kanal' }),
    subject: v.str({ label: 'Betreff', max: 200 }),
    body: v.str({ label: 'Text', required: true, max: 10000 }),
  };

  route('GET', '/templates', async () => ({
    items: await q(`select t.*, u.name as created_by_name from message_templates t left join users u on u.id = t.created_by order by lower(t.name)`),
  }));

  route('POST', '/templates', async ({ req, user }) => {
    const d = validate(await readJson(req), schema);
    const row = await one(
      `insert into message_templates (name, channel, subject, body, created_by) values ($1, $2, $3, $4, $5) returning id`,
      [d.name, d.channel, d.subject, d.body, user.id]
    );
    return json({ id: row.id }, 201);
  });

  route('PATCH', '/templates/:id', async ({ req, params }) => {
    const id = idParam(params.id);
    const d = validate(await readJson(req), schema, { partial: true });
    const keys = Object.keys(d);
    if (!keys.length) return { ok: true };
    const row = await one(
      `update message_templates set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1 returning id`,
      [id, ...keys.map((k) => d[k])]
    );
    if (!row) throw new HttpError(404, 'Vorlage nicht gefunden.');
    return { ok: true };
  });

  route('DELETE', '/templates/:id', async ({ params }) => {
    const row = await one(`delete from message_templates where id = $1 returning id`, [idParam(params.id)]);
    if (!row) throw new HttpError(404, 'Vorlage nicht gefunden.');
    return { ok: true };
  });

  // ---------- Tägliche Mail ----------
  route('GET', '/mail/status', async () => {
    const c = mailConfig();
    return { configured: c.configured, from: c.configured ? c.from : null };
  });

  route('POST', '/mail/test-digest', async ({ user }) => {
    try {
      await sendDigestTo(user, { force: true });
    } catch (e) {
      if (e.code === 'MAIL_NOT_CONFIGURED') throw new HttpError(422, e.message);
      throw new HttpError(502, `Senden fehlgeschlagen: ${e.message}`);
    }
    return { ok: true, to: user.email };
  });
}
