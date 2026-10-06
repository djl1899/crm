import { q, one, TODAY } from '../db.js';
import { HttpError, readJson, idParam, intParam, json } from '../http.js';
import { v, validate } from '../validate.js';
import { logActivity } from '../activity.js';
import { EXPENSE_CATEGORIES } from '../../shared/constants.js';

const expenseSchema = {
  expense_date: v.date({ label: 'Datum', required: true }),
  title: v.str({ label: 'Beschreibung', required: true, max: 200 }),
  category: v.oneOf(EXPENSE_CATEGORIES, { label: 'Kategorie', def: 'Sonstiges' }),
  amount: v.num({ label: 'Betrag', required: true }),
  paid_by: v.ref({ label: 'Bezahlt von' }),
  creator_id: v.ref({ label: 'Creator' }),
  notes: v.str({ label: 'Notizen', max: 5000 }),
};

const SELECT = `
  select e.*, u.name as paid_by_name, c.display_name as creator_name
  from expenses e
  left join users u on u.id = e.paid_by
  left join creators c on c.id = e.creator_id`;

async function checkRefs(data) {
  if (data.amount !== undefined && data.amount !== null && data.amount <= 0) {
    throw new HttpError(422, 'Der Betrag muss größer als 0 sein.', { amount: 'Muss größer als 0 sein.' });
  }
  if (data.paid_by && !(await one(`select id from users where id = $1 and role <> 'creator'`, [data.paid_by]))) {
    throw new HttpError(422, 'Benutzer nicht gefunden.', { paid_by: 'Ungültig.' });
  }
  if (data.creator_id && !(await one(`select id from creators where id = $1`, [data.creator_id]))) {
    throw new HttpError(422, 'Creator nicht gefunden.', { creator_id: 'Ungültig.' });
  }
}

export default function register(route) {
  route('GET', '/expenses', async ({ query }) => {
    const params = [];
    const p = (x) => { params.push(x); return `$${params.length}`; };
    const where = [];
    if (EXPENSE_CATEGORIES.includes(query.get('category'))) where.push(`e.category = ${p(query.get('category'))}`);
    if (query.get('paid_by')) where.push(`e.paid_by = ${p(intParam(query.get('paid_by'), { def: 0 }))}`);
    const period = query.get('period');
    if (period === 'month') where.push(`date_trunc('month', e.expense_date) = date_trunc('month', ${TODAY})`);
    if (period === 'year') where.push(`date_trunc('year', e.expense_date) = date_trunc('year', ${TODAY})`);
    const s = (query.get('q') || '').trim();
    if (s) {
      const like = p(`%${s}%`);
      where.push(`(e.title ilike ${like} or e.notes ilike ${like})`);
    }
    const w = where.length ? 'where ' + where.join(' and ') : '';
    const pageSize = intParam(query.get('page_size'), { min: 1, max: 200, def: 25 });
    const page = intParam(query.get('page'), { min: 1, def: 1 });
    const sumParams = [...params];
    const rows = await q(
      `${SELECT.replace('select e.*', 'select count(*) over() as total_count, e.*')} ${w}
       order by e.expense_date desc, e.id desc limit ${p(pageSize)} offset ${p((page - 1) * pageSize)}`,
      params
    );
    const sum = await one(`select coalesce(sum(e.amount), 0) as sum from expenses e ${w}`, sumParams);
    const total = rows[0] ? Number(rows[0].total_count) : 0;
    return { items: rows.map(({ total_count, ...r }) => r), total, sum: sum.sum, page, pages: Math.max(1, Math.ceil(total / pageSize)) };
  });

  route('POST', '/expenses', async ({ req, user }) => {
    const data = validate(await readJson(req), expenseSchema);
    await checkRefs(data);
    const keys = Object.keys(data);
    const row = await one(
      `insert into expenses (${keys.join(', ')}, created_by) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}, $${keys.length + 1}) returning id`,
      [...keys.map((k) => data[k]), user.id]
    );
    await logActivity({ creatorId: data.creator_id, userId: user.id, entityType: 'expense', entityId: row.id, action: 'expense_created',
      message: `hat die Ausgabe „${data.title}“ (${data.amount.toFixed(2).replace('.', ',')} €) erfasst.` });
    return json({ id: row.id }, 201);
  });

  route('PATCH', '/expenses/:id', async ({ req, params, user }) => {
    const id = idParam(params.id);
    const data = validate(await readJson(req), expenseSchema, { partial: true });
    const before = await one(`select id, title, creator_id from expenses where id = $1`, [id]);
    if (!before) throw new HttpError(404, 'Ausgabe nicht gefunden.');
    await checkRefs(data);
    const keys = Object.keys(data);
    if (keys.length) {
      await q(`update expenses set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [id, ...keys.map((k) => data[k])]);
    }
    await logActivity({ creatorId: 'creator_id' in data ? data.creator_id : before.creator_id, userId: user.id, entityType: 'expense', entityId: id,
      action: 'expense_updated', message: `hat die Ausgabe „${data.title || before.title}“ bearbeitet.` });
    return { ok: true };
  });

  route('DELETE', '/expenses/:id', async ({ params, user }) => {
    const id = idParam(params.id);
    const row = await one(`delete from expenses where id = $1 returning title, creator_id`, [id]);
    if (!row) throw new HttpError(404, 'Ausgabe nicht gefunden.');
    await logActivity({ creatorId: row.creator_id, userId: user.id, entityType: 'expense', entityId: id, action: 'expense_deleted', message: `hat die Ausgabe „${row.title}“ gelöscht.` });
    return { ok: true };
  });

  // Einnahmen/Ausgaben/Ergebnis + Ausgaben je Kategorie + Monatsverlauf
  route('GET', '/finance/expenses-summary', async () => {
    const totals = await one(
      `select
        coalesce(sum(amount), 0) as total,
        coalesce(sum(amount) filter (where date_trunc('month', expense_date) = date_trunc('month', ${TODAY})), 0) as month,
        coalesce(sum(amount) filter (where date_trunc('year', expense_date) = date_trunc('year', ${TODAY})), 0) as year
       from expenses`
    );
    const byCategory = await q(
      `select category, coalesce(sum(amount), 0) as sum, count(*)::int as count
       from expenses where date_trunc('year', expense_date) = date_trunc('year', ${TODAY})
       group by category order by sum desc`
    );
    const byMonth = await q(
      `select to_char(date_trunc('month', expense_date), 'YYYY-MM') as month, coalesce(sum(amount), 0) as expenses
       from expenses
       where expense_date >= date_trunc('month', ${TODAY}) - interval '11 months'
         and expense_date < date_trunc('month', ${TODAY}) + interval '1 month'
       group by 1 order by 1`
    );
    return { totals, by_category: byCategory, by_month: byMonth };
  });
}
