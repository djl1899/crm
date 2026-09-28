import { q, one } from '../db.js';
import { HttpError, readJson, idParam, json } from '../http.js';
import { v, validate } from '../validate.js';
import { logActivity } from '../activity.js';
import { TAG_COLORS } from '../../shared/constants.js';

const tagSchema = {
  name: v.str({ label: 'Tag-Name', required: true, max: 40 }),
  color: v.oneOf(TAG_COLORS, { label: 'Farbe', def: 'gray' }),
};

export default function register(route) {
  route('GET', '/tags', async () => {
    const tags = await q(
      `select t.id, t.name, t.color, t.created_at,
        (select count(*)::int from creator_tags x where x.tag_id = t.id) as creator_count
       from tags t order by lower(t.name)`
    );
    return { tags };
  });

  route('POST', '/tags', async ({ req, user }) => {
    const data = validate(await readJson(req), tagSchema);
    if (await one(`select id from tags where lower(name) = lower($1)`, [data.name])) {
      throw new HttpError(409, 'Ein Tag mit diesem Namen existiert bereits.', { name: 'Bereits vorhanden.' });
    }
    const tag = await one(`insert into tags (name, color) values ($1, $2) returning id, name, color`, [data.name, data.color]);
    await logActivity({ userId: user.id, entityType: 'tag', entityId: tag.id, action: 'tag_created', message: `hat den Tag „${tag.name}“ erstellt.` });
    return json({ tag }, 201);
  });

  route('PATCH', '/tags/:id', async ({ req, params }) => {
    const id = idParam(params.id);
    const data = validate(await readJson(req), tagSchema, { partial: true });
    if (data.name && (await one(`select id from tags where lower(name) = lower($1) and id <> $2`, [data.name, id]))) {
      throw new HttpError(409, 'Ein Tag mit diesem Namen existiert bereits.', { name: 'Bereits vorhanden.' });
    }
    const tag = await one(
      `update tags set name = coalesce($2, name), color = coalesce($3, color) where id = $1 returning id, name, color`,
      [id, data.name ?? null, data.color ?? null]
    );
    if (!tag) throw new HttpError(404, 'Tag nicht gefunden.');
    return { tag };
  });

  route('DELETE', '/tags/:id', async ({ params, user }) => {
    const id = idParam(params.id);
    const tag = await one(`delete from tags where id = $1 returning name`, [id]);
    if (!tag) throw new HttpError(404, 'Tag nicht gefunden.');
    await logActivity({ userId: user.id, entityType: 'tag', entityId: id, action: 'tag_deleted', message: `hat den Tag „${tag.name}“ gelöscht.` });
    return { ok: true };
  });
}
