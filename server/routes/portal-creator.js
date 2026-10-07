// Creator-Bereich: alle Endpunkte, die ein eingeloggter Creator für seinen eigenen Bereich nutzt.
// Das Team kann denselben Bereich als Vorschau öffnen (Header "X-View-As-Creator" oder ?as=ID) – dann nur lesend.
import { q, one, tx, TODAY } from '../db.js';
import { HttpError, readJson, idParam, intParam, json } from '../http.js';
import { v, validate } from '../validate.js';
import { logActivity } from '../activity.js';
import { readUpload, randomKey, fileResponse } from '../upload.js';
import { putFile, getFile, removeFile } from '../storage.js';
import { createZip } from '../zip.js';
import { billingSchema } from './creators.js';
import {
  PORTAL_DOC_GROUPS, PORTAL_UPLOAD_CATEGORIES, CREATOR_STAGES, CALENDAR_KINDS, CREATOR_EXPENSE_CATEGORIES,
  REIMBURSEMENT_STATUSES, VAT_RATES, PLATFORMS,
} from '../../shared/constants.js';

const DEFAULT_TAX_BUFFER = 30;
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const iso = (d) => (d ? (typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10)) : null);

// ---------------------------------------------------------------------------
// Wer schaut hier? Creator selbst – oder das Team in der Vorschau
// ---------------------------------------------------------------------------
async function context({ user, req, query }) {
  let creatorId;
  let preview = false;
  if (user.role === 'creator') {
    creatorId = user.creator_id;
  } else {
    creatorId = Number(req.headers.get('x-view-as-creator') || query.get('as'));
    preview = true;
    if (!Number.isInteger(creatorId) || creatorId <= 0) throw new HttpError(400, 'Für die Vorschau fehlt der Creator.');
  }
  if (!creatorId) throw new HttpError(403, 'Dieser Bereich ist nur für Creator.');
  const c = await one(
    `select c.*, u.name as manager_name, u.email as manager_email
     from creators c left join users u on u.id = c.manager_id where c.id = $1`,
    [creatorId]
  );
  if (!c) throw new HttpError(preview ? 404 : 403, preview ? 'Creator nicht gefunden.' : 'Dein Creator-Profil wurde nicht gefunden. Bitte melde dich bei deinem Management.');
  return { c, preview };
}
const assertWritable = (ctx) => {
  if (ctx.preview) throw new HttpError(403, 'Vorschau: Hier kannst du nur ansehen, nichts ändern.');
};

// ---------------------------------------------------------------------------
// Kooperationen aus Creator-Sicht
// ---------------------------------------------------------------------------
const COLLAB_SELECT = `
  select co.id, co.brand, co.campaign_name, co.status, co.platform, co.description, co.deliverables,
    co.start_date, co.end_date, co.deadline, co.fee, co.payout_status, co.invoice_status,
    co.contact_name, co.contact_email, co.usage_rights, co.exclusivity,
    co.briefing_date, co.approval_date, co.publish_date, co.published_on, co.invoice_due_date, co.payout_date,
    co.content_links, co.content_note, co.content_submitted_at, co.created_at,
    f.rate as commission_rate, f.agency_fee, f.payout, f.rev_date,
    (select count(*)::int from collab_messages m where m.collaboration_id = co.id) as message_count
  from collaborations co join collab_finance f on f.id = co.id`;

export function stageOf(c) {
  if (c.status === 'Abgebrochen') return 'Abgebrochen';
  if (c.payout_status === 'Ausgezahlt' || c.invoice_status === 'Bezahlt') return 'Bezahlt';
  if (['Offen', 'Eingereicht', 'Überfällig'].includes(c.invoice_status)) return 'Rechnung';
  if (c.published_on || c.status === 'Abgeschlossen') return 'Veröffentlicht';
  if (['Aktiv', 'Content ausstehend', 'Abnahme'].includes(c.status)) return 'Content fällig';
  if (c.status === 'Geplant') return 'Bestätigt';
  if (c.status === 'Verhandlung') return 'Verhandlung';
  return 'Anfrage';
}

/** Ergänzt Status-Stufe und Beträge (netto, USt, brutto) aus Creator-Sicht */
function decorate(c, creator) {
  const vatRate = creator.small_business === true ? 0 : 19;
  const net = round2(c.payout);
  const vat = round2((net * vatRate) / 100);
  return {
    ...c,
    stage: stageOf(c),
    stage_index: CREATOR_STAGES.indexOf(stageOf(c)),
    money: { fee: round2(c.fee), commission_rate: Number(c.commission_rate), agency_fee: round2(c.agency_fee), net, vat_rate: vatRate, vat, gross: round2(net + vat) },
    overdue: c.invoice_status === 'Überfällig',
  };
}

async function loadCollabs(creator, where = '', params = []) {
  const rows = await q(`${COLLAB_SELECT} where co.creator_id = $1 ${where} order by coalesce(co.deadline, co.publish_date, co.start_date, co.created_at::date) desc, co.id desc`, [creator.id, ...params]);
  return rows.map((r) => decorate(r, creator));
}

// ---------------------------------------------------------------------------
// Finanzen
// ---------------------------------------------------------------------------
const BUCKET = { 'Bestätigt': 'expected', 'Content fällig': 'expected', 'Veröffentlicht': 'expected', Rechnung: 'invoiced', Bezahlt: 'paid' };
const expenseNet = (e) => round2(Number(e.amount_gross) / (1 + Number(e.vat_rate) / 100));

function periodFilter(dateStr, year, month) {
  if (!dateStr) return false;
  const d = iso(dateStr);
  if (Number(d.slice(0, 4)) !== year) return false;
  return !month || Number(d.slice(5, 7)) === month;
}
const incomeDate = (c) => iso(c.stage === 'Bezahlt' ? c.payout_date || c.rev_date : c.rev_date);

async function financeData(creator, year, month) {
  const collabs = (await loadCollabs(creator)).filter((c) => BUCKET[c.stage] && periodFilter(incomeDate(c), year, month));
  const expenses = (await q(
    `select e.*, co.brand as collaboration_brand, d.filename as receipt_filename
     from creator_expenses e left join collaborations co on co.id = e.collaboration_id left join documents d on d.id = e.document_id
     where e.creator_id = $1 order by e.expense_date desc, e.id desc`,
    [creator.id]
  )).filter((e) => periodFilter(e.expense_date, year, month));

  const sum = (arr, fn) => round2(arr.reduce((a, x) => a + fn(x), 0));
  const income = {};
  for (const b of ['expected', 'invoiced', 'paid']) {
    const list = collabs.filter((c) => BUCKET[c.stage] === b);
    income[b] = { net: sum(list, (c) => c.money.net), vat: sum(list, (c) => c.money.vat), gross: sum(list, (c) => c.money.gross), count: list.length };
  }
  const agencyFee = sum(collabs, (c) => c.money.agency_fee);
  const gross = sum(collabs, (c) => c.money.fee);
  const ownExpenses = expenses.filter((e) => e.reimbursement_status !== 'Erstattet');
  const exp = {
    gross: sum(expenses, (e) => Number(e.amount_gross)),
    net: sum(ownExpenses, expenseNet),
    input_vat: creator.small_business === true ? 0 : sum(ownExpenses, (e) => Number(e.amount_gross) - expenseNet(e)),
    reimbursable_open: sum(expenses.filter((e) => e.reimbursable && ['Keine', 'Beantragt'].includes(e.reimbursement_status)), (e) => Number(e.amount_gross)),
    reimbursed: sum(expenses.filter((e) => e.reimbursement_status === 'Erstattet'), (e) => Number(e.amount_gross)),
  };
  // Steuerpuffer = Schätzung: Satz × (Einnahmen netto, fakturiert + bezahlt − eigene Ausgaben netto) + Umsatzsteuer-Zahllast
  const rate = creator.tax_buffer_rate === null || creator.tax_buffer_rate === undefined ? DEFAULT_TAX_BUFFER : Number(creator.tax_buffer_rate);
  const taxableProfit = Math.max(0, income.invoiced.net + income.paid.net - exp.net);
  const vatDue = creator.small_business === true ? 0 : Math.max(0, income.invoiced.vat + income.paid.vat - exp.input_vat);
  const buffer = {
    rate, profit_basis: round2(taxableProfit), income_tax_estimate: round2((taxableProfit * rate) / 100), vat_due: round2(vatDue),
    total: round2((taxableProfit * rate) / 100 + vatDue), small_business: creator.small_business,
  };
  return { collabs, expenses, income, agency_fee: agencyFee, gross_fees: gross, expenses_summary: exp, buffer };
}

// ---------------------------------------------------------------------------
// Kalender
// ---------------------------------------------------------------------------
function taxDeadlines(creator, from, to) {
  const out = [];
  const years = new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))]);
  for (const y of years) {
    for (const m of ['03', '06', '09', '12']) out.push({ date: `${y}-${m}-10`, title: 'Einkommensteuer-Vorauszahlung (falls festgesetzt)' });
    out.push({ date: `${y}-07-31`, title: `Steuererklärung ${y - 1} (ohne Steuerberater)` });
    if (creator.small_business === false) {
      for (let mm = 1; mm <= 12; mm++) out.push({ date: `${y}-${String(mm).padStart(2, '0')}-10`, title: 'Umsatzsteuer-Voranmeldung (monatlich/quartalsweise)' });
    }
  }
  return out.filter((e) => e.date >= from && e.date <= to).map((e, i) => ({ id: `tax-${e.date}-${i}`, date: e.date, kind: 'Frist', title: e.title, source: 'tax', note: 'Allgemeine Frist – prüf mit deinem Steuerberater, ob sie für dich gilt.' }));
}

async function calendarEvents(creator, from, to) {
  const events = [];
  const collabs = await loadCollabs(creator, `and co.status <> 'Abgebrochen'`);
  const add = (c, field, kind, title) => {
    const d = iso(c[field]);
    if (d && d >= from && d <= to) events.push({ id: `c${c.id}-${field}`, date: d, kind, title: `${title}: ${c.brand}`, collaboration_id: c.id, source: 'deal', stage: c.stage });
  };
  for (const c of collabs) {
    add(c, 'briefing_date', 'Briefing', 'Briefing');
    add(c, 'approval_date', 'Freigabe', 'Freigabe');
    add(c, 'deadline', 'Content-Abgabe', 'Content-Abgabe');
    add(c, 'publish_date', 'Veröffentlichung', 'Veröffentlichung');
    if (c.stage !== 'Bezahlt') add(c, 'invoice_due_date', 'Zahlung', 'Zahlung fällig');
    add(c, 'payout_date', 'Zahlung', 'Auszahlung');
  }
  const tasks = await q(
    `select t.id, t.title, t.due_date, co.brand from tasks t left join collaborations co on co.id = t.collaboration_id
     where t.creator_id = $1 and t.status = 'Wartet auf Creator' and t.due_date between $2 and $3`,
    [creator.id, from, to]
  );
  for (const t of tasks) events.push({ id: `t${t.id}`, date: iso(t.due_date), kind: 'Erinnerung', title: t.title + (t.brand ? ` (${t.brand})` : ''), source: 'task', task_id: t.id });
  const entries = await q(
    `select e.*, co.brand from creator_calendar_entries e left join collaborations co on co.id = e.collaboration_id
     where e.creator_id = $1 and e.entry_date between $2 and $3`,
    [creator.id, from, to]
  );
  for (const e of entries) {
    events.push({
      id: `e${e.id}`, entry_id: e.id, date: iso(e.entry_date), time: e.entry_time, kind: e.kind, title: e.title, note: e.notes,
      platform: e.platform, done: e.done, collaboration_id: e.collaboration_id, brand: e.brand, source: 'entry',
    });
  }
  events.push(...taxDeadlines(creator, from, to));
  return events.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}

const entrySchema = {
  entry_date: v.date({ label: 'Datum', required: true }),
  entry_time: (val) => {
    if (val === undefined || val === null || val === '') return null;
    if (!/^\d{1,2}:\d{2}$/.test(String(val))) throw 'Uhrzeit bitte als HH:MM.';
    return String(val);
  },
  kind: v.oneOf(CALENDAR_KINDS, { label: 'Art', def: 'Content-Plan' }),
  title: v.str({ label: 'Titel', required: true, max: 160 }),
  notes: v.str({ label: 'Notiz', max: 2000 }),
  platform: v.str({ label: 'Plattform', max: 40 }),
  collaboration_id: v.ref({ label: 'Kooperation' }),
  done: v.bool({ label: 'Erledigt' }),
};

const expenseSchema = {
  expense_date: v.date({ label: 'Datum', required: true }),
  title: v.str({ label: 'Beschreibung', required: true, max: 160 }),
  category: v.oneOf(CREATOR_EXPENSE_CATEGORIES, { label: 'Kategorie', def: 'Sonstiges' }),
  amount_gross: v.num({ label: 'Betrag (brutto)', required: true, max: 1e7 }),
  vat_rate: (val) => {
    const n = val === undefined || val === null || val === '' ? 19 : Number(val);
    if (!VAT_RATES.includes(n)) throw 'Steuersatz bitte 19, 7 oder 0 %.';
    return n;
  },
  reimbursable: v.bool({ label: 'Erstattung durch Marke/Agentur' }),
  collaboration_id: v.ref({ label: 'Kooperation' }),
  notes: v.str({ label: 'Notiz', max: 2000 }),
};

async function assertOwnCollab(creatorId, collabId) {
  if (!collabId) return;
  const co = await one(`select creator_id from collaborations where id = $1`, [collabId]);
  if (!co || co.creator_id !== creatorId) throw new HttpError(422, 'Kooperation nicht gefunden.', { collaboration_id: 'Ungültig.' });
}

const profileSchema = {
  first_name: v.str({ label: 'Vorname', max: 80 }),
  last_name: v.str({ label: 'Nachname', max: 80 }),
  email: v.email({ label: 'Kontakt-E-Mail' }),
  phone: v.str({ label: 'Telefonnummer', max: 40 }),
  city: v.str({ label: 'Wohnort', max: 80 }),
  bio: v.str({ label: 'Kurzvorstellung', max: 1500 }),
  size_top: v.str({ label: 'Größe Oberteil', max: 20 }),
  size_bottom: v.str({ label: 'Größe Hose', max: 20 }),
  size_shoes: v.str({ label: 'Schuhgröße', max: 20 }),
  height_cm: v.int({ label: 'Körpergröße', min: 50, max: 250 }),
  size_notes: v.str({ label: 'Hinweis zu Größen', max: 500 }),
  tax_buffer_rate: v.num({ label: 'Steuerpuffer (%)', max: 60 }),
  ...billingSchema,
};
const PROFILE_COLUMNS = Object.keys(profileSchema);

// ---------------------------------------------------------------------------
// Export-Helfer
// ---------------------------------------------------------------------------
const de = (n) => Number(n || 0).toFixed(2).replace('.', ',');
const csvCell = (x) => {
  const s = x === null || x === undefined ? '' : String(x);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
const fmtDe = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');

function incomeCsv(fin) {
  const rows = [['Datum', 'Status', 'Marke', 'Kampagne', 'Honorar Marke', 'Provision %', 'Provision', 'Netto (deine Einnahme)', 'USt-Satz', 'USt', 'Brutto', 'Rechnungsstatus', 'Ausgezahlt am']];
  for (const c of fin.collabs) {
    rows.push([fmtDe(incomeDate(c)), c.stage, c.brand, c.campaign_name || '', de(c.money.fee), de(c.money.commission_rate), de(c.money.agency_fee), de(c.money.net), `${c.money.vat_rate} %`, de(c.money.vat), de(c.money.gross), c.invoice_status, fmtDe(iso(c.payout_date))]);
  }
  return toCsv(rows);
}
function expenseCsv(fin) {
  const rows = [['Datum', 'Beschreibung', 'Kategorie', 'Brutto', 'USt-Satz', 'Netto', 'Erstattung', 'Kooperation', 'Beleg']];
  for (const e of fin.expenses) {
    rows.push([fmtDe(iso(e.expense_date)), e.title, e.category, de(e.amount_gross), `${Number(e.vat_rate)} %`, de(expenseNet(e)), e.reimbursable ? e.reimbursement_status : 'nein', e.collaboration_brand || '', e.receipt_filename || '']);
  }
  return toCsv(rows);
}

/**
 * DATEV-Buchungsstapel (Format EXTF 700). Standard-Konten SKR03 – unbedingt mit dem Steuerberater abstimmen.
 * Bezahlte Einnahmen: Bank an Erlöse. Ausgaben (ohne erstattete): Aufwand an Bank, BU 9 (19 %) / 8 (7 %).
 */
function datevCsv(fin, creator, { year, month, accounts, berater, mandant }) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 17);
  const from = `${year}${month ? String(month).padStart(2, '0') : '01'}01`;
  const lastDay = month ? new Date(year, month, 0).getDate() : 31;
  const to = `${year}${month ? String(month).padStart(2, '0') : '12'}${String(lastDay).padStart(2, '0')}`;
  const header = ['"EXTF"', 700, 21, '"Buchungsstapel"', 13, stamp, '', '"LLK"', '""', '""', berater || '', mandant || '', `${year}0101`, 4, from, to,
    `"Export ${creator.display_name}"`.slice(0, 30), '""', 1, 0, 0, '"EUR"'].join(';');
  const cols = ['Umsatz (ohne Soll/Haben-Kz)', 'Soll/Haben-Kennzeichen', 'WKZ Umsatz', 'Kurs', 'Basis-Umsatz', 'WKZ Basis-Umsatz', 'Konto', 'Gegenkonto (ohne BU-Schlüssel)', 'BU-Schlüssel', 'Belegdatum', 'Belegfeld 1', 'Belegfeld 2', 'Skonto', 'Buchungstext'];
  const lines = [header, cols.join(';')];
  const ddmm = (d) => `${d.slice(8, 10)}${d.slice(5, 7)}`;
  const txt = (s) => `"${String(s || '').replace(/"/g, "'").slice(0, 60)}"`;
  const revenueAccount = creator.small_business === true ? accounts.revenue_small : accounts.revenue;
  for (const c of fin.collabs.filter((x) => x.stage === 'Bezahlt')) {
    const d = incomeDate(c);
    lines.push([de(c.money.gross), '"S"', '"EUR"', '', '', '', accounts.bank, revenueAccount, '', ddmm(d), txt(`K-${c.id}`), '', '', txt(`${c.brand} ${c.campaign_name || ''}`.trim())].join(';'));
  }
  for (const e of fin.expenses.filter((x) => x.reimbursement_status !== 'Erstattet')) {
    const d = iso(e.expense_date);
    const bu = creator.small_business === true ? '' : Number(e.vat_rate) === 19 ? '9' : Number(e.vat_rate) === 7 ? '8' : '';
    lines.push([de(e.amount_gross), '"S"', '"EUR"', '', '', '', accounts.expense, accounts.bank, bu, ddmm(d), txt(`A-${e.id}`), '', '', txt(e.title)].join(';'));
  }
  return Buffer.from(lines.join('\r\n') + '\r\n', 'latin1');
}

const periodLabel = (year, month) => (month ? `${year}-${String(month).padStart(2, '0')}` : String(year));
const fileName = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '_');
function readPeriod(query) {
  const year = intParam(query.get('year'), { min: 2000, max: 2100, def: new Date().getFullYear() });
  const m = query.get('month') ? intParam(query.get('month'), { min: 1, max: 12, def: 0 }) : 0;
  return { year, month: m || null };
}
function readAccounts(query) {
  const acc = (k, def) => {
    const x = String(query.get(k) || def).replace(/\D/g, '');
    return x.length >= 4 && x.length <= 8 ? x : def;
  };
  return { bank: acc('bank', '1200'), revenue: acc('revenue', '8400'), revenue_small: acc('revenue_small', '8195'), expense: acc('expense', '4900') };
}

// ---------------------------------------------------------------------------
export default function register(route) {
  const P = (method, path, handler) => route(method, path, handler, { portal: true });

  P('GET', '/portal/overview', async (args) => {
    const { c, preview } = await context(args);
    const year = new Date().getFullYear();
    const fin = await financeData(c, year, null);
    const today = new Date().toISOString().slice(0, 10);
    const in21 = new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10);
    const [events, todos, docs, collabs, messages] = await Promise.all([
      calendarEvents(c, today, in21),
      q(`select t.id, t.title, t.description, t.due_date, t.priority, co.brand from tasks t left join collaborations co on co.id = t.collaboration_id
         where t.creator_id = $1 and t.status = 'Wartet auf Creator' order by t.due_date asc nulls last, t.id limit 10`, [c.id]),
      q(`select id, category, filename, created_at from documents where creator_id = $1 and visible_to_creator = true order by created_at desc limit 5`, [c.id]),
      loadCollabs(c, `and co.status <> 'Abgebrochen'`),
      q(`select m.id, m.body, m.created_at, co.id as collaboration_id, co.brand, u.name as author, (u.role = 'creator') as mine
         from collab_messages m join collaborations co on co.id = m.collaboration_id left join users u on u.id = m.user_id
         where co.creator_id = $1 order by m.created_at desc limit 4`, [c.id]),
    ]);
    const byStage = Object.fromEntries(CREATOR_STAGES.map((s) => [s, collabs.filter((x) => x.stage === s).length]));
    return {
      preview,
      creator: {
        id: c.id, display_name: c.display_name, first_name: c.first_name,
        avatar_url: c.avatar_key ? `/api/portal/avatar?v=${c.avatar_key.slice(-8)}${preview ? `&as=${c.id}` : ''}` : null,
        manager_name: c.manager_name, manager_email: c.manager_email,
        profile_missing: ['billing_street', 'billing_zip', 'billing_city', 'iban'].filter((k) => !c[k]),
        small_business_unknown: c.small_business === null || c.small_business === undefined,
      },
      year, income: fin.income, buffer: fin.buffer, by_stage: byStage,
      events: events.filter((e) => e.source !== 'tax' || e.date <= in21).slice(0, 8),
      todos, documents: docs, messages,
      active: collabs.filter((x) => ['Bestätigt', 'Content fällig'].includes(x.stage)).slice(0, 5),
    };
  });

  P('GET', '/portal/avatar', async (args) => {
    const { c } = await context(args);
    if (!c.avatar_key) throw new HttpError(404, 'Kein Profilbild.');
    const f = await getFile(c.avatar_key);
    if (!f) throw new HttpError(404, 'Kein Profilbild.');
    return fileResponse(f.data, { filename: 'avatar', mime: f.metadata?.mime || 'image/jpeg', inline: true, cache: 'private, max-age=3600' });
  });

  // ---------- Kalender ----------
  P('GET', '/portal/calendar', async (args) => {
    const { c } = await context(args);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(args.query.get('from') || '') ? args.query.get('from') : new Date().toISOString().slice(0, 8) + '01';
    const to = /^\d{4}-\d{2}-\d{2}$/.test(args.query.get('to') || '') ? args.query.get('to') : new Date(Date.now() + 62 * 864e5).toISOString().slice(0, 10);
    if (to < from) throw new HttpError(422, 'Ungültiger Zeitraum.');
    return { events: await calendarEvents(c, from, to), kinds: CALENDAR_KINDS };
  });

  P('POST', '/portal/calendar', async (args) => {
    const ctx = await context(args);
    assertWritable(ctx);
    const data = validate(await readJson(args.req), entrySchema);
    await assertOwnCollab(ctx.c.id, data.collaboration_id);
    const row = await one(
      `insert into creator_calendar_entries (creator_id, collaboration_id, entry_date, entry_time, kind, title, notes, platform, done, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [ctx.c.id, data.collaboration_id, data.entry_date, data.entry_time, data.kind, data.title, data.notes, data.platform, data.done, args.user.id]
    );
    return json({ id: row.id }, 201);
  });

  P('PATCH', '/portal/calendar/:id', async (args) => {
    const ctx = await context(args);
    assertWritable(ctx);
    const id = idParam(args.params.id);
    const data = validate(await readJson(args.req), entrySchema, { partial: true });
    if ('collaboration_id' in data) await assertOwnCollab(ctx.c.id, data.collaboration_id);
    const keys = Object.keys(data);
    if (!keys.length) return { ok: true };
    const row = await one(
      `update creator_calendar_entries set ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = now()
       where id = $1 and creator_id = $2 returning id`,
      [id, ctx.c.id, ...keys.map((k) => data[k])]
    );
    if (!row) throw new HttpError(404, 'Eintrag nicht gefunden.');
    return { ok: true };
  });

  P('DELETE', '/portal/calendar/:id', async (args) => {
    const ctx = await context(args);
    assertWritable(ctx);
    const row = await one(`delete from creator_calendar_entries where id = $1 and creator_id = $2 returning id`, [idParam(args.params.id), ctx.c.id]);
    if (!row) throw new HttpError(404, 'Eintrag nicht gefunden.');
    return { ok: true };
  });

  // ---------- Kooperationen ----------
  P('GET', '/portal/collaborations', async (args) => {
    const { c } = await context(args);
    const items = await loadCollabs(c, `and co.status <> 'Abgebrochen'`);
    const filter = args.query.get('filter');
    const groups = {
      open: ['Anfrage', 'Verhandlung'], active: ['Bestätigt', 'Content fällig', 'Veröffentlicht'], billing: ['Rechnung'], done: ['Bezahlt'],
    };
    return { items: groups[filter] ? items.filter((x) => groups[filter].includes(x.stage)) : items, stages: CREATOR_STAGES };
  });

  P('GET', '/portal/collaborations/:id', async (args) => {
    const { c } = await context(args);
    const id = idParam(args.params.id);
    const [item] = await loadCollabs(c, `and co.id = $2`, [id]);
    if (!item) throw new HttpError(404, 'Kooperation nicht gefunden.');
    const [documents, messages, expenses] = await Promise.all([
      q(`select id, category, filename, created_at from documents where creator_id = $1 and collaboration_id = $2 and visible_to_creator = true order by created_at desc`, [c.id, id]),
      q(`select m.id, m.body, m.created_at, u.name as author, (u.role = 'creator') as mine from collab_messages m left join users u on u.id = m.user_id
         where m.collaboration_id = $1 order by m.created_at asc`, [id]),
      q(`select id, expense_date, title, amount_gross, reimbursable, reimbursement_status from creator_expenses where creator_id = $1 and collaboration_id = $2 order by expense_date`, [c.id, id]),
    ]);
    return { item, documents, messages, expenses, stages: CREATOR_STAGES };
  });

  P('POST', '/portal/collaborations/:id/messages', async (args) => {
    const ctx = await context(args);
    assertWritable(ctx);
    const id = idParam(args.params.id);
    const data = validate(await readJson(args.req), { body: v.str({ label: 'Nachricht', required: true, max: 4000 }) });
    const co = await one(`select id, brand, creator_id from collaborations where id = $1`, [id]);
    if (!co || co.creator_id !== ctx.c.id) throw new HttpError(404, 'Kooperation nicht gefunden.');
    const m = await one(`insert into collab_messages (collaboration_id, user_id, body) values ($1, $2, $3) returning id, created_at`, [id, args.user.id, data.body]);
    await logActivity({ creatorId: ctx.c.id, userId: args.user.id, entityType: 'collaboration', entityId: id, action: 'message_from_creator', message: `hat eine Nachricht zu „${co.brand}“ geschrieben: „${data.body.slice(0, 120)}${data.body.length > 120 ? '…' : ''}“` });
    return json({ id: m.id }, 201);
  });

  P('POST', '/portal/collaborations/:id/content', async (args) => {
    const ctx = await context(args);
    assertWritable(ctx);
    const c = ctx.c;
    const id = idParam(args.params.id);
    const data = validate(await readJson(args.req), {
      content_links: v.str({ label: 'Links', required: true, max: 3000 }),
      content_note: v.str({ label: 'Nachricht', max: 2000 }),
    });
    const links = data.content_links.split(/\s+/).filter(Boolean);
    if (!links.every((l) => /^https?:\/\/\S+$/i.test(l))) {
      throw new HttpError(422, 'Bitte nur vollständige Links eintragen (beginnend mit https://), getrennt durch Leerzeichen oder Zeilen.', { content_links: 'Ungültiger Link.' });
    }
    const co = await one(`select id, brand, status, creator_id from collaborations where id = $1`, [id]);
    if (!co || co.creator_id !== c.id) throw new HttpError(404, 'Kooperation nicht gefunden.');
    if (!['Geplant', 'Aktiv', 'Content ausstehend', 'Abnahme'].includes(co.status)) {
      throw new HttpError(422, 'Für diese Kooperation kann gerade kein Content eingereicht werden.');
    }
    await tx(async (run) => {
      await run(
        `update collaborations set content_links = $2, content_note = $3, content_submitted_at = now(),
           status = case when status in ('Geplant', 'Aktiv', 'Content ausstehend') then 'Abnahme' else status end, updated_at = now()
         where id = $1`,
        [id, links.join('\n'), data.content_note]
      );
      await run(
        `insert into tasks (title, description, creator_id, collaboration_id, assignee_id, priority, status, due_date, created_by)
         values ($1, $2, $3, $4, $5, 'Hoch', 'Offen', ${TODAY} + 2, $6)`,
        [`Content prüfen: ${co.brand}`, `${c.display_name} hat Content eingereicht:\n${links.join('\n')}${data.content_note ? `\n\nNachricht: ${data.content_note}` : ''}`,
          c.id, id, c.manager_id || null, args.user.id]
      );
      await logActivity({ creatorId: c.id, userId: args.user.id, entityType: 'collaboration', entityId: id, action: 'content_submitted', message: `hat Content für „${co.brand}“ eingereicht.` }, run);
    });
    const [item] = await loadCollabs(c, `and co.id = $2`, [id]);
    return { item };
  });

  P('POST', '/portal/todos/:id/done', async (args) => {
    const ctx = await context(args);
    assertWritable(ctx);
    const id = idParam(args.params.id);
    const t = await one(`select id, title, creator_id, status from tasks where id = $1`, [id]);
    if (!t || t.creator_id !== ctx.c.id || t.status !== 'Wartet auf Creator') throw new HttpError(404, 'Aufgabe nicht gefunden.');
    await q(`update tasks set status = 'In Bearbeitung', updated_at = now() where id = $1`, [id]);
    await logActivity({ creatorId: ctx.c.id, userId: args.user.id, entityType: 'task', entityId: id, action: 'task_done_by_creator', message: `hat „${t.title}“ als erledigt gemeldet.` });
    return { ok: true };
  });

  // ---------- Finanzen ----------
  P('GET', '/portal/finance', async (args) => {
    const { c } = await context(args);
    const { year, month } = readPeriod(args.query);
    const fin = await financeData(c, year, month);
    const yearsRows = await q(
      `select distinct extract(year from coalesce(co.payout_date, f.rev_date))::int as y from collaborations co join collab_finance f on f.id = co.id where co.creator_id = $1
       union select distinct extract(year from expense_date)::int from creator_expenses where creator_id = $1`,
      [c.id]
    );
    const years = [...new Set([new Date().getFullYear(), ...yearsRows.map((r) => r.y)])].sort((a, b) => b - a);
    const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, expected: 0, invoiced: 0, paid: 0, expenses: 0 }));
    if (!month) {
      for (const co of fin.collabs) months[Number(incomeDate(co).slice(5, 7)) - 1][BUCKET[co.stage]] += co.money.net;
      for (const e of fin.expenses) months[Number(iso(e.expense_date).slice(5, 7)) - 1].expenses += expenseNet(e);
    }
    return {
      year, month, years, months: months.map((m) => ({ ...m, expected: round2(m.expected), invoiced: round2(m.invoiced), paid: round2(m.paid), expenses: round2(m.expenses) })),
      income: fin.income, agency_fee: fin.agency_fee, gross_fees: fin.gross_fees, expenses: fin.expenses_summary, buffer: fin.buffer,
      items: fin.collabs, expense_items: fin.expenses, categories: CREATOR_EXPENSE_CATEGORIES, vat_rates: VAT_RATES,
      small_business: c.small_business,
    };
  });

  P('POST', '/portal/expenses', async (args) => {
    const ctx = await context(args);
    assertWritable(ctx);
    const data = validate(await readJson(args.req), expenseSchema);
    await assertOwnCollab(ctx.c.id, data.collaboration_id);
    const row = await one(
      `insert into creator_expenses (creator_id, collaboration_id, expense_date, title, category, amount_gross, vat_rate, reimbursable, reimbursement_status, notes, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [ctx.c.id, data.collaboration_id, data.expense_date, data.title, data.category, data.amount_gross, data.vat_rate, data.reimbursable,
        data.reimbursable ? 'Beantragt' : 'Keine', data.notes, args.user.id]
    );
    if (data.reimbursable) {
      await logActivity({ creatorId: ctx.c.id, userId: args.user.id, entityType: 'expense', entityId: row.id, action: 'expense_reimbursement_requested', message: `hat eine Auslagenerstattung beantragt: „${data.title}“ (${de(data.amount_gross)} €).` });
    }
    return json({ id: row.id }, 201);
  });

  P('PATCH', '/portal/expenses/:id', async (args) => {
    const ctx = await context(args);
    assertWritable(ctx);
    const id = idParam(args.params.id);
    const before = await one(`select * from creator_expenses where id = $1 and creator_id = $2`, [id, ctx.c.id]);
    if (!before) throw new HttpError(404, 'Ausgabe nicht gefunden.');
    if (before.reimbursement_status === 'Erstattet') throw new HttpError(422, 'Diese Ausgabe wurde schon erstattet und kann nicht mehr geändert werden.');
    const data = validate(await readJson(args.req), expenseSchema, { partial: true });
    if ('collaboration_id' in data) await assertOwnCollab(ctx.c.id, data.collaboration_id);
    if ('reimbursable' in data) data.reimbursement_status = data.reimbursable ? 'Beantragt' : 'Keine';
    const keys = Object.keys(data);
    if (keys.length) {
      await q(`update creator_expenses set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [id, ...keys.map((k) => data[k])]);
    }
    return { ok: true };
  });

  P('DELETE', '/portal/expenses/:id', async (args) => {
    const ctx = await context(args);
    assertWritable(ctx);
    const row = await one(`delete from creator_expenses where id = $1 and creator_id = $2 and reimbursement_status <> 'Erstattet' returning id`, [idParam(args.params.id), ctx.c.id]);
    if (!row) throw new HttpError(404, 'Ausgabe nicht gefunden oder bereits erstattet.');
    return { ok: true };
  });

  // Beleg zu einer Ausgabe hochladen (wird zusätzlich unter Dokumente → Belege abgelegt)
  P('POST', '/portal/expenses/:id/receipt', async (args) => {
    const ctx = await context(args);
    assertWritable(ctx);
    const id = idParam(args.params.id);
    const e = await one(`select id, title, collaboration_id, document_id from creator_expenses where id = $1 and creator_id = $2`, [id, ctx.c.id]);
    if (!e) throw new HttpError(404, 'Ausgabe nicht gefunden.');
    const up = await readUpload(args.req);
    const key = `documents/${ctx.c.id}/${randomKey()}`;
    await putFile(key, up.buffer, { mime: up.mime, filename: up.filename });
    const doc = await one(
      `insert into documents (creator_id, collaboration_id, category, filename, mime_type, size_bytes, blob_key, uploaded_by, visible_to_creator)
       values ($1, $2, 'Belege', $3, $4, $5, $6, $7, true) returning id`,
      [ctx.c.id, e.collaboration_id, up.filename, up.mime, up.size, key, args.user.id]
    );
    await q(`update creator_expenses set document_id = $2, updated_at = now() where id = $1`, [id, doc.id]);
    return json({ document_id: doc.id }, 201);
  });

  // ---------- Exporte ----------
  P('GET', '/portal/export/:kind', async (args) => {
    const { c } = await context(args);
    const kind = args.params.kind;
    const { year, month } = readPeriod(args.query);
    const fin = await financeData(c, year, month);
    const label = periodLabel(year, month);
    const base = fileName(`${c.display_name}_${label}`);
    const send = (buf, name, mime) =>
      new Response(buf, { status: 200, headers: { 'Content-Type': mime, 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    const datevOpts = { year, month, accounts: readAccounts(args.query), berater: String(args.query.get('berater') || '').replace(/\D/g, '').slice(0, 7), mandant: String(args.query.get('mandant') || '').replace(/\D/g, '').slice(0, 5) };

    if (kind === 'income.csv') return send(Buffer.from(incomeCsv(fin), 'utf8'), `Einnahmen_${base}.csv`, 'text/csv; charset=utf-8');
    if (kind === 'expenses.csv') return send(Buffer.from(expenseCsv(fin), 'utf8'), `Ausgaben_${base}.csv`, 'text/csv; charset=utf-8');
    if (kind === 'datev.csv') return send(datevCsv(fin, c, datevOpts), `EXTF_Buchungsstapel_${base}.csv`, 'text/csv; charset=windows-1252');
    if (kind !== 'package.zip') throw new HttpError(404, 'Unbekannter Export.');

    // Steuerberater-Paket: CSVs + DATEV + Übersicht + PDF-Belege des Zeitraums
    const docs = (await q(
      `select id, category, filename, blob_key, size_bytes, created_at from documents
       where creator_id = $1 and visible_to_creator = true and category in ('Rechnungen', 'Belege') order by created_at`,
      [c.id]
    )).filter((d) => periodFilter(d.created_at, year, month));
    const receiptIds = new Set(fin.expenses.map((e) => e.document_id).filter(Boolean));
    const extraReceipts = receiptIds.size
      ? await q(`select id, category, filename, blob_key, size_bytes, created_at from documents where id = any($1::int[])`, [[...receiptIds]])
      : [];
    const all = [...new Map([...docs, ...extraReceipts].map((d) => [d.id, d])).values()];
    const LIMIT = 4.5 * 1024 * 1024;
    let size = 0;
    const files = [];
    const skipped = [];
    for (const d of all) {
      if (size + d.size_bytes > LIMIT) { skipped.push(d.filename); continue; }
      const f = await getFile(d.blob_key);
      if (!f) { skipped.push(d.filename); continue; }
      size += d.size_bytes;
      files.push({ name: `Belege/${d.category}/${d.id}_${fileName(d.filename)}`, data: Buffer.from(f.data) });
    }
    const b = fin.buffer;
    const summary = [
      `Steuerberater-Paket – ${c.display_name} – Zeitraum ${label}`,
      `Erstellt am ${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`,
      '',
      `Kleinunternehmer (§ 19 UStG): ${c.small_business === true ? 'ja' : c.small_business === false ? 'nein' : 'nicht angegeben'}`,
      c.tax_number ? `Steuernummer: ${c.tax_number}` : null,
      c.vat_id ? `USt-IdNr.: ${c.vat_id}` : null,
      '',
      'EINNAHMEN (deine Anteile nach Provision)',
      `  erwartet:    ${de(fin.income.expected.net)} € netto`,
      `  fakturiert:  ${de(fin.income.invoiced.net)} € netto + ${de(fin.income.invoiced.vat)} € USt`,
      `  bezahlt:     ${de(fin.income.paid.net)} € netto + ${de(fin.income.paid.vat)} € USt`,
      `  Provision Management: ${de(fin.agency_fee)} €`,
      '',
      'AUSGABEN',
      `  gesamt brutto: ${de(fin.expenses_summary.gross)} €, davon erstattet: ${de(fin.expenses_summary.reimbursed)} €`,
      `  eigene Ausgaben netto: ${de(fin.expenses_summary.net)} €, Vorsteuer: ${de(fin.expenses_summary.input_vat)} €`,
      '',
      `STEUERPUFFER (Schätzung, ${b.rate} %): ${de(b.total)} €`,
      '',
      'Dateien:',
      '  Einnahmen.csv / Ausgaben.csv – für Excel (Semikolon, UTF-8)',
      '  EXTF_Buchungsstapel.csv – DATEV-Format (EXTF 700), Standardkonten SKR03:',
      `    Bank ${datevOpts.accounts.bank}, Erlöse ${datevOpts.accounts.revenue} / Kleinunternehmer ${datevOpts.accounts.revenue_small}, Aufwand ${datevOpts.accounts.expense}`,
      '    → Konten und Kontierung bitte vor dem Import mit dem Steuerberater abstimmen.',
      skipped.length ? `\nNicht enthalten (zu groß oder fehlend, bitte einzeln herunterladen): ${skipped.join(', ')}` : null,
      '',
      'Hinweis: Alle Werte sind eine Zusammenstellung aus dem Creator-Bereich und keine Steuerberatung.',
    ].filter((x) => x !== null).join('\r\n');
    const zip = createZip([
      { name: 'Uebersicht.txt', data: Buffer.from(summary, 'utf8') },
      { name: 'Einnahmen.csv', data: Buffer.from(incomeCsv(fin), 'utf8') },
      { name: 'Ausgaben.csv', data: Buffer.from(expenseCsv(fin), 'utf8') },
      { name: 'EXTF_Buchungsstapel.csv', data: datevCsv(fin, c, datevOpts) },
      ...files,
    ]);
    return send(zip, `Steuerberater-Paket_${base}.zip`, 'application/zip');
  });

  // ---------- Dokumente ----------
  P('GET', '/portal/documents', async (args) => {
    const { c } = await context(args);
    const items = await q(
      `select d.id, d.category, d.filename, d.mime_type, d.size_bytes, d.created_at, d.collaboration_id,
         co.brand as collaboration_brand, (u.role = 'creator') as uploaded_by_me
       from documents d left join collaborations co on co.id = d.collaboration_id left join users u on u.id = d.uploaded_by
       where d.creator_id = $1 and d.visible_to_creator = true order by d.created_at desc`,
      [c.id]
    );
    const groups = PORTAL_DOC_GROUPS.map((g) => ({ ...g, items: items.filter((d) => g.categories.includes(d.category)) }));
    return { groups, upload_categories: PORTAL_UPLOAD_CATEGORIES };
  });

  P('GET', '/portal/documents/:id/file', async (args) => {
    const { c } = await context(args);
    const d = await one(`select filename, mime_type, blob_key from documents where id = $1 and creator_id = $2 and visible_to_creator = true`, [idParam(args.params.id), c.id]);
    if (!d) throw new HttpError(404, 'Datei nicht gefunden.');
    const f = await getFile(d.blob_key);
    if (!f) throw new HttpError(404, 'Die Datei ist im Speicher nicht mehr vorhanden.');
    return fileResponse(f.data, { filename: d.filename, mime: d.mime_type, inline: args.query.get('download') !== '1' });
  });

  P('POST', '/portal/documents', async (args) => {
    const ctx = await context(args);
    assertWritable(ctx);
    const up = await readUpload(args.req);
    const meta = validate(up.fields, {
      category: v.oneOf(PORTAL_UPLOAD_CATEGORIES, { label: 'Kategorie', required: true }),
      collaboration_id: v.ref({ label: 'Kooperation' }),
    });
    await assertOwnCollab(ctx.c.id, meta.collaboration_id);
    const key = `documents/${ctx.c.id}/${randomKey()}`;
    await putFile(key, up.buffer, { mime: up.mime, filename: up.filename });
    let doc;
    try {
      doc = await one(
        `insert into documents (creator_id, collaboration_id, category, filename, mime_type, size_bytes, blob_key, uploaded_by, visible_to_creator)
         values ($1, $2, $3, $4, $5, $6, $7, $8, true) returning id`,
        [ctx.c.id, meta.collaboration_id, meta.category, up.filename, up.mime, up.size, key, args.user.id]
      );
    } catch (e) {
      await removeFile(key);
      throw e;
    }
    await logActivity({ creatorId: ctx.c.id, userId: args.user.id, entityType: 'document', entityId: doc.id, action: 'document_uploaded', message: `hat die Datei „${up.filename}“ (${meta.category}) hochgeladen.` });
    return json({ id: doc.id }, 201);
  });

  // ---------- Eigene Daten ----------
  P('GET', '/portal/profile', async (args) => {
    const { c } = await context(args);
    const socials = await q(`select platform, username, url, followers from social_accounts where creator_id = $1 order by platform`, [c.id]);
    const profile = Object.fromEntries(PROFILE_COLUMNS.map((k) => [k, c[k] ?? null]));
    if (profile.tax_buffer_rate === null) profile.tax_buffer_rate = DEFAULT_TAX_BUFFER;
    return {
      profile, socials, platforms: PLATFORMS.map((p) => p.key),
      readonly: { display_name: c.display_name, manager_name: c.manager_name, manager_email: c.manager_email, commission_rate: c.commission_rate },
    };
  });

  P('PUT', '/portal/profile', async (args) => {
    const ctx = await context(args);
    assertWritable(ctx);
    const c = ctx.c;
    const data = validate(await readJson(args.req), profileSchema, { partial: true });
    const keys = Object.keys(data);
    if (!keys.length) return { ok: true };
    const changed = keys.filter((k) => String(data[k] ?? '') !== String(c[k] ?? ''));
    await q(`update creators set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [c.id, ...keys.map((k) => data[k])]);
    if (changed.length) {
      const sensitive = changed.some((k) => ['iban', 'bank_holder', 'tax_number', 'vat_id'].includes(k));
      await logActivity({
        creatorId: c.id, userId: args.user.id, entityType: 'creator', entityId: c.id, action: 'portal_profile_updated',
        message: sensitive ? 'hat im Creator-Bereich die Bank- oder Steuerdaten geändert.' : 'hat im Creator-Bereich die eigenen Daten aktualisiert.',
      });
    }
    return { ok: true };
  });

  // =================================================================
  // Team-Seite: Nachrichten am Deal und Auslagen der Creator
  // =================================================================
  route('GET', '/collaborations/:id/messages', async ({ params }) => {
    const id = idParam(params.id);
    return {
      items: await q(`select m.id, m.body, m.created_at, u.name as author, (u.role = 'creator') as from_creator
        from collab_messages m left join users u on u.id = m.user_id where m.collaboration_id = $1 order by m.created_at asc`, [id]),
    };
  });

  route('POST', '/collaborations/:id/messages', async ({ req, params, user }) => {
    const id = idParam(params.id);
    const data = validate(await readJson(req), { body: v.str({ label: 'Nachricht', required: true, max: 4000 }) });
    const co = await one(`select id, brand, creator_id from collaborations where id = $1`, [id]);
    if (!co) throw new HttpError(404, 'Kooperation nicht gefunden.');
    const m = await one(`insert into collab_messages (collaboration_id, user_id, body) values ($1, $2, $3) returning id`, [id, user.id, data.body]);
    await logActivity({ creatorId: co.creator_id, userId: user.id, entityType: 'collaboration', entityId: id, action: 'message_to_creator', message: `hat dem Creator zu „${co.brand}“ geschrieben.` });
    return json({ id: m.id }, 201);
  });

  route('GET', '/creators/:id/expenses', async ({ params }) => {
    const id = idParam(params.id);
    return {
      items: await q(`select e.*, co.brand as collaboration_brand, d.filename as receipt_filename from creator_expenses e
        left join collaborations co on co.id = e.collaboration_id left join documents d on d.id = e.document_id
        where e.creator_id = $1 order by (e.reimbursement_status = 'Beantragt') desc, e.expense_date desc`, [id]),
      statuses: REIMBURSEMENT_STATUSES,
    };
  });

  route('PATCH', '/creator-expenses/:id', async ({ req, params, user }) => {
    const id = idParam(params.id);
    const data = validate(await readJson(req), { reimbursement_status: v.oneOf(REIMBURSEMENT_STATUSES, { label: 'Erstattung', required: true }) });
    const e = await one(`update creator_expenses set reimbursement_status = $2, reimbursable = ($2 <> 'Keine'), updated_at = now() where id = $1 returning creator_id, title`, [id, data.reimbursement_status]);
    if (!e) throw new HttpError(404, 'Ausgabe nicht gefunden.');
    await logActivity({ creatorId: e.creator_id, userId: user.id, entityType: 'expense', entityId: id, action: 'expense_reimbursement', message: `hat die Erstattung für „${e.title}“ auf '${data.reimbursement_status}' gesetzt.` });
    return { ok: true };
  });
}
