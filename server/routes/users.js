import { one, q } from '../db.js';
import { HttpError, readJson, idParam } from '../http.js';
import { v, validate } from '../validate.js';
import { hashPassword, validatePasswordStrength, requireAdmin, PUBLIC_USER_FIELDS } from '../auth.js';
import { ROLE_KEYS } from '../../shared/constants.js';
import { logActivity } from '../activity.js';

const userSchema = {
  name: v.str({ label: 'Name', required: true, max: 120 }),
  email: v.email({ required: true }),
  role: v.oneOf(ROLE_KEYS, { label: 'Rolle', def: 'manager' }),
  is_active: v.bool({ label: 'Status' }),
  digest_enabled: v.bool({ label: 'Tägliche Zusammenfassung' }),
};

export default function register(route) {
  // Alle eingeloggten Benutzer sehen die Benutzerliste (z. B. für "Verantwortlicher Manager")
  route('GET', '/users', async () => {
    const users = await q(
      `select ${PUBLIC_USER_FIELDS},
        (select count(*)::int from creators c where c.manager_id = u.id and c.status <> 'Archiviert') as creator_count
       from users u where u.role <> 'creator' order by is_active desc, name asc`
    );
    return { users };
  });

  route('POST', '/users', async ({ req, user }) => {
    requireAdmin(user);
    const body = await readJson(req);
    const data = validate({ is_active: true, ...body }, userSchema);
    validatePasswordStrength(body.password);
    const dup = await one(`select id from users where lower(email) = $1`, [data.email]);
    if (dup) throw new HttpError(409, 'Diese E-Mail-Adresse wird bereits verwendet.', { email: 'Bereits vergeben.' });
    const created = await one(
      `insert into users (name, email, password_hash, role, is_active, digest_enabled) values ($1, $2, $3, $4, $5, $6)
       returning ${PUBLIC_USER_FIELDS}`,
      [data.name, data.email, await hashPassword(body.password), data.role, data.is_active, data.digest_enabled ?? false]
    );
    await logActivity({ userId: user.id, entityType: 'user', entityId: created.id, action: 'user_created', message: `hat den Benutzer „${created.name}“ angelegt.` });
    return { user: created };
  });

  route('PATCH', '/users/:id', async ({ req, params, user }) => {
    requireAdmin(user);
    const id = idParam(params.id);
    const body = await readJson(req);
    const data = validate(body, userSchema, { partial: true });
    const existing = await one(`select ${PUBLIC_USER_FIELDS} from users where id = $1`, [id]);
    if (!existing || existing.role === 'creator') throw new HttpError(404, 'Benutzer nicht gefunden.');
    if (id === user.id && (data.is_active === false || (data.role && data.role !== 'admin'))) {
      throw new HttpError(422, 'Du kannst dich nicht selbst deaktivieren oder deine Admin-Rolle entfernen.');
    }
    if (data.email) {
      const dup = await one(`select id from users where lower(email) = $1 and id <> $2`, [data.email, id]);
      if (dup) throw new HttpError(409, 'Diese E-Mail-Adresse wird bereits verwendet.', { email: 'Bereits vergeben.' });
    }
    // Zwei-Faktor zurücksetzen (z. B. Handy verloren)
    if (body.reset_2fa === true) {
      await q(
        `update users set totp_enabled = false, totp_secret = null, totp_pending = null, totp_last_step = null,
           recovery_codes = '{}', token_version = token_version + 1 where id = $1`,
        [id]
      );
      await logActivity({ userId: user.id, entityType: 'user', entityId: id, action: '2fa_reset', message: `hat die Zwei-Faktor-Anmeldung von „${existing.name}“ zurückgesetzt.` });
      if (Object.keys(data).length === 0 && !body.password) {
        return { user: await one(`select ${PUBLIC_USER_FIELDS} from users where id = $1`, [id]) };
      }
    }
    let passwordHash = null;
    if (body.password) {
      validatePasswordStrength(body.password);
      passwordHash = await hashPassword(body.password);
    }
    const updated = await one(
      `update users set
         name = coalesce($2, name),
         email = coalesce($3, email),
         role = coalesce($4, role),
         is_active = coalesce($5, is_active),
         password_hash = coalesce($6, password_hash),
         digest_enabled = coalesce($7, digest_enabled),
         token_version = token_version + (case when $6::text is not null or $5::boolean = false then 1 else 0 end),
         updated_at = now()
       where id = $1 returning ${PUBLIC_USER_FIELDS}`,
      [id, data.name ?? null, data.email ?? null, data.role ?? null, data.is_active ?? null, passwordHash, data.digest_enabled ?? null]
    );
    const changes = [];
    if (data.role && data.role !== existing.role) changes.push(`Rolle → ${data.role === 'admin' ? 'Administrator' : 'Manager'}`);
    if (data.is_active !== undefined && data.is_active !== existing.is_active) changes.push(data.is_active ? 'aktiviert' : 'deaktiviert');
    if (passwordHash) changes.push('Passwort zurückgesetzt');
    if (data.digest_enabled !== undefined && data.digest_enabled !== existing.digest_enabled) changes.push(`Tägliche Mail ${data.digest_enabled ? 'an' : 'aus'}`);
    await logActivity({
      userId: user.id, entityType: 'user', entityId: id, action: 'user_updated',
      message: `hat den Benutzer „${updated.name}“ geändert${changes.length ? ` (${changes.join(', ')})` : ''}.`,
    });
    return { user: updated };
  });
}
