import crypto from 'node:crypto';
import { q, one, tx } from '../db.js';
import { HttpError } from '../http.js';
import { requireAdmin, hashPassword } from '../auth.js';
import { logActivity } from '../activity.js';

// Heutiges Datum in deutscher Zeit, verschoben um n Tage → 'YYYY-MM-DD'
function day(offset = 0) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  now.setDate(now.getDate() + offset);
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
const ts = (offset, hour = 10) => new Date(`${day(offset)}T${String(hour).padStart(2, '0')}:15:00+02:00`).toISOString();

const TAGS = [
  ['Fashion', 'pink'], ['Beauty', 'violet'], ['Fitness', 'green'], ['Lifestyle', 'blue'], ['Gaming', 'teal'],
  ['UGC', 'amber'], ['High Priority', 'red'], ['Long Term', 'blue'], ['Berlin', 'gray'], ['Premium', 'amber'],
];

// Fiktive Demo-Creator
const CREATORS = [
  { n: 'Anna Müller', f: 'Anna', l: 'Müller', city: 'Berlin', region: 'Berlin', niche: 'Fashion / Lifestyle', ig: ['anna.mueller.style', 125000, 4.2], tt: ['annamueller', 280000, 7.8], st: 'Aktiv', os: 'Abgeschlossen', m: 1, tags: ['Fashion', 'Lifestyle', 'Berlin', 'Premium'], contract: ['Aktiv', -200, 165, 'Exklusiv für Fashion-Brands im DACH-Raum'] },
  { n: 'Jonas Becker', f: 'Jonas', l: 'Becker', city: 'München', region: 'Bayern', niche: 'Fitness', ig: ['jonas.lifts', 86000, 5.1], tt: ['jonasbecker.fit', 142000, 9.3], st: 'Aktiv', os: 'Abgeschlossen', m: 2, tags: ['Fitness', 'Long Term'], contract: ['Aktiv', -120, 20, 'Keine'] },
  { n: 'Lea Hoffmann', f: 'Lea', l: 'Hoffmann', city: 'Hamburg', region: 'Hamburg', niche: 'Beauty', ig: ['lea.glow', 212000, 3.6], tt: null, st: 'Verhandlung', os: 'Im Gespräch', m: 1, tags: ['Beauty', 'High Priority'], contract: ['Zur Unterschrift', 5, 370, 'Exklusiv Skincare'] },
  { n: 'Mehmet Yilmaz', f: 'Mehmet', l: 'Yilmaz', city: 'Köln', region: 'Nordrhein-Westfalen', niche: 'Gaming', ig: ['mehmet.plays', 45000, 6.0], tt: ['mehmetplays', 390000, 11.2], st: 'Im Gespräch', os: 'Antwort erhalten', m: 3, tags: ['Gaming'], contract: null },
  { n: 'Sophie Wagner', f: 'Sophie', l: 'Wagner', city: 'Wien', region: 'Wien', country: 'Österreich', niche: 'Lifestyle / Travel', ig: ['sophie.wanders', 158000, 2.9], tt: ['sophiewagner', 64000, 5.5], st: 'Kontakt aufgenommen', os: 'Follow-up erforderlich', m: 2, tags: ['Lifestyle'], contract: null },
  { n: 'Tim Schröder', f: 'Tim', l: 'Schröder', city: 'Leipzig', region: 'Sachsen', niche: 'Food', ig: ['tim.kocht', 67000, 4.8], tt: ['timkocht', 121000, 8.1], st: 'Lead', os: 'Noch nicht kontaktiert', m: null, tags: ['UGC'], contract: null },
  { n: 'Laura Fischer', f: 'Laura', l: 'Fischer', city: 'Frankfurt am Main', region: 'Hessen', niche: 'Finance / Business', ig: ['laura.money', 102000, 3.1], tt: null, st: 'Lead', os: 'Noch nicht kontaktiert', m: 1, tags: ['High Priority'], contract: null },
  { n: 'Noah Keller', f: 'Noah', l: 'Keller', city: 'Zürich', region: 'Zürich', country: 'Schweiz', niche: 'Tech', ig: ['noah.tech', 38000, 5.9], tt: ['noahkeller.tech', 71000, 6.4], st: 'Pausiert', os: 'Kontaktiert', m: 3, tags: [], contract: ['Ausgelaufen', -400, -35, null] },
  { n: 'Emma Richter', f: 'Emma', l: 'Richter', city: 'Berlin', region: 'Berlin', niche: 'Fashion', ig: ['emma.richter', 245000, 2.7], tt: ['emmarichter', 510000, 6.9], st: 'Aktiv', os: 'Abgeschlossen', m: 2, tags: ['Fashion', 'Berlin', 'Premium', 'Long Term'], contract: ['Aktiv', -60, 305, 'Exklusiv Denim'] },
  { n: 'Felix Braun', f: 'Felix', l: 'Braun', city: 'Stuttgart', region: 'Baden-Württemberg', niche: 'Automotive', ig: ['felix.drives', 54000, 4.4], tt: null, st: 'Abgelehnt', os: 'Kein Interesse', m: 1, tags: [], contract: null },
  { n: 'Mia Schulz', f: 'Mia', l: 'Schulz', city: 'Düsseldorf', region: 'Nordrhein-Westfalen', niche: 'Beauty / UGC', ig: ['mia.makeup', 29000, 7.9], tt: ['miaschulz', 88000, 10.4], st: 'Kontakt aufgenommen', os: 'Kontaktiert', m: 3, tags: ['Beauty', 'UGC'], contract: ['In Vorbereitung', null, null, null] },
  { n: 'Paul Neumann', f: 'Paul', l: 'Neumann', city: 'Mannheim', region: 'Baden-Württemberg', niche: 'Fitness / Outdoor', ig: ['paul.outdoors', 118000, 3.8], tt: ['paulneumann', 56000, 5.2], st: 'Lead', os: 'Noch nicht kontaktiert', m: 2, tags: ['Fitness'], contract: null },
  { n: 'Clara Weber', f: 'Clara', l: 'Weber', city: 'Dresden', region: 'Sachsen', niche: 'Lifestyle / Interior', ig: ['clara.home', 73000, 4.0], tt: null, st: 'Archiviert', os: 'Kein Interesse', m: null, tags: ['Lifestyle'], contract: null },
];

// [creatorIndex, brand, campaign, startOffset, endOffset, status, platform, fee, invoice, deadlineOffset, deliverables]
const COLLABS = [
  [0, 'Nordlicht Apparel', 'Herbstkollektion', -50, -20, 'Abgeschlossen', 'Instagram', 2000, 'Bezahlt', -25, '3 Reels, 5 Stories'],
  [0, 'Velora Cosmetics', 'Glow Week', -10, 20, 'Aktiv', 'Instagram + TikTok', 3500, 'Offen', 10, '2 Reels, 2 TikToks'],
  [0, 'Stadtrad Berlin', 'Urban Mobility', -5, 25, 'Content ausstehend', 'TikTok', 1500, 'Nicht erstellt', 6, '2 TikToks'],
  [0, 'Kaffeehaus Nord', 'Winter Blend', 30, 60, 'Geplant', 'Instagram', 5500, 'Nicht erstellt', 40, '1 Reel, Stories'],
  [1, 'PeakFuel', 'Protein Relaunch', -90, -60, 'Abgeschlossen', 'Instagram', 1800, 'Bezahlt', -65, '2 Reels'],
  [1, 'Iron Studio', 'Gym Opening', -3, 14, 'Aktiv', 'TikTok', 2400, 'Eingereicht', 4, '3 TikToks'],
  [1, 'Runwise', 'Laufschuh-Test', 20, 50, 'Geplant', 'Instagram', 2000, 'Nicht erstellt', 30, '1 Reel, 1 Post'],
  [2, 'Velora Cosmetics', 'Skin Routine', 10, 40, 'Verhandlung', 'Instagram', 4000, 'Nicht erstellt', null, 'Reel + Stories'],
  [3, 'Pixelforge Games', 'Launch Stream', 12, 12, 'Anfrage', 'TikTok', 1200, 'Nicht erstellt', null, 'Live-Stream'],
  [7, 'ByteBox', 'Unboxing', -140, -120, 'Abgeschlossen', 'Instagram', 900, 'Überfällig', -125, '1 Reel'],
  [8, 'Denimwerk', 'Denim Drop', -30, 30, 'Aktiv', 'Instagram + TikTok', 6500, 'Offen', 3, '4 Reels, 4 TikToks'],
  [8, 'Nordlicht Apparel', 'Spring Preview', -200, -170, 'Abgeschlossen', 'Instagram', 4200, 'Bezahlt', -175, '2 Reels'],
  [8, 'Aurum Jewelry', 'Holiday', 45, 75, 'Geplant', 'Instagram', 3000, 'Nicht erstellt', 55, '1 Reel, 3 Stories'],
  [10, 'Velora Cosmetics', 'UGC Paket', -2, 18, 'Abnahme', 'TikTok', 800, 'Nicht erstellt', -1, '5 UGC-Videos'],
  [4, 'Wanderlust Hotels', 'Alpen-Trip', 25, 30, 'Anfrage', 'Instagram', 2500, 'Nicht erstellt', null, 'Reel + Carousel'],
];

// [creatorIndex, title, priority, status, dueOffset, userIdx, collabIdx]
const TASKS = [
  [0, 'Briefing Glow Week an Anna senden', 'Hoch', 'Erledigt', -8, 1, 1],
  [0, 'Reel-Entwurf Glow Week freigeben', 'Hoch', 'Offen', 1, 1, 1],
  [0, 'Rechnung Glow Week erstellen', 'Normal', 'Offen', 12, 1, 1],
  [0, 'TikTok-Skripte Stadtrad prüfen', 'Dringend', 'In Bearbeitung', 0, 2, 2],
  [1, 'Iron Studio: Rechnung nachhalten', 'Normal', 'Wartet auf Creator', -2, 2, 5],
  [1, 'Vertragsverlängerung vorbereiten', 'Hoch', 'Offen', 7, 2, null],
  [2, 'Vertragsentwurf an Lea schicken', 'Dringend', 'Offen', -1, 1, null],
  [3, 'Mediakit von Mehmet anfordern', 'Normal', 'Offen', 3, 3, null],
  [4, 'Nachfassen wegen Alpen-Trip', 'Normal', 'Offen', 0, 2, 14],
  [7, 'Überfällige Rechnung ByteBox klären', 'Hoch', 'Offen', -10, 3, 9],
  [8, 'Denim Drop: Content-Kalender abstimmen', 'Hoch', 'In Bearbeitung', 2, 2, 10],
  [8, 'Shooting-Location Holiday buchen', 'Niedrig', 'Offen', 30, 2, 12],
  [10, 'UGC-Videos abnehmen', 'Hoch', 'Offen', 0, 3, 13],
  [11, 'Paul erstmals anschreiben', 'Normal', 'Offen', 2, 2, null],
  [null, 'Neue Creator-Liste Q4 recherchieren', 'Niedrig', 'Offen', 14, 1, null],
];

// [creatorIndex, dayOffset, channel, userIdx, subject, message, result, followUpOffset|null, done]
const OUTREACH = [
  [0, -120, 'Instagram DM', 1, 'Erstkontakt', 'Creator bezüglich Zusammenarbeit angeschrieben.', 'Erstkontakt', null, true],
  [0, -116, 'Instagram DM', 1, 'Antwort', 'Creator grundsätzlich interessiert.', 'Antwort erhalten', null, true],
  [0, -110, 'E-Mail', 1, 'Angebot', 'Management-Angebot verschickt.', 'Angebot verschickt', null, true],
  [1, -150, 'E-Mail', 2, 'Erstkontakt', 'Kooperationsanfrage PeakFuel weitergeleitet.', 'Erstkontakt', null, true],
  [1, -140, 'Telefon', 2, 'Call', 'Rahmenvertrag besprochen.', 'Termin vereinbart', null, true],
  [2, -14, 'Instagram DM', 1, 'Erstkontakt', 'Anfrage Management + Velora-Kampagne.', 'Erstkontakt', null, true],
  [2, -9, 'E-Mail', 1, 'Konditionen', 'Konditionen und Vertragsentwurf gesendet.', 'Angebot verschickt', 2, false],
  [3, -6, 'Instagram DM', 3, 'Erstkontakt', 'Anfrage zu Pixelforge Launch Stream.', 'Erstkontakt', null, true],
  [3, -4, 'Instagram DM', 3, 'Antwort', 'Interessiert, möchte Details per Mail.', 'Antwort erhalten', 0, false],
  [4, -12, 'E-Mail', 2, 'Erstkontakt', 'Anfrage Wanderlust Hotels.', 'Erstkontakt', -3, false],
  [7, -30, 'E-Mail', 3, 'Status', 'Creator pausiert bis Jahresende.', 'Antwort erhalten', 25, false],
  [8, -300, 'Instagram DM', 2, 'Erstkontakt', 'Management angefragt.', 'Erstkontakt', null, true],
  [8, -290, 'Telefon', 2, 'Call', 'Onboarding-Gespräch.', 'Termin vereinbart', null, true],
  [9, -40, 'Instagram DM', 1, 'Erstkontakt', 'Anfrage Automotive-Kampagne.', 'Erstkontakt', null, true],
  [9, -35, 'Instagram DM', 1, 'Antwort', 'Kein Interesse an Management.', 'Kein Interesse', null, true],
  [10, -3, 'WhatsApp', 3, 'Erstkontakt', 'UGC-Anfrage per WhatsApp.', 'Erstkontakt', 4, false],
  [12, -60, 'E-Mail', 1, 'Erstkontakt', 'Anfrage Interior-Kampagne.', 'Kein Interesse', null, true],
];

export async function seedDemoData(adminId) {
  const existing = await one(`select count(*)::int as n from creators`);
  if (existing.n > 0) throw new HttpError(409, 'Demo-Daten können nur in eine leere Datenbank geladen werden (es existieren bereits Creator).');

  // Demo-Manager: zufälliges Passwort → Login erst nach Passwort-Vergabe durch Admin möglich
  const demoManagers = [['Max Mustermann', 'max.mustermann@demo.local'], ['Lena Schmidt', 'lena.schmidt@demo.local']];
  const userIds = [adminId];
  for (const [name, email] of demoManagers) {
    const u = await one(`select id from users where lower(email) = $1`, [email]);
    if (u) { userIds.push(u.id); continue; }
    const created = await one(
      `insert into users (name, email, password_hash, role) values ($1, $2, $3, 'manager') returning id`,
      [name, email, await hashPassword(crypto.randomBytes(24).toString('base64url'))]
    );
    userIds.push(created.id);
  }
  const uid = (idx) => (idx ? userIds[(idx - 1) % userIds.length] : null);

  await tx(async (run) => {
    const tagIds = {};
    for (const [name, color] of TAGS) {
      const r = await run(
        `insert into tags (name, color) values ($1, $2) on conflict (lower(name)) do update set color = tags.color returning id`,
        [name, color]
      );
      tagIds[name] = r[0].id;
    }

    const creatorIds = [];
    for (const [i, c] of CREATORS.entries()) {
      const r = await run(
        `insert into creators (display_name, first_name, last_name, email, phone, city, region, country, language, niche,
           interests, notes, manager_id, status, outreach_status, contacted, created_by, created_at, last_activity_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18) returning id`,
        [
          c.n, c.f, c.l, `${c.f.toLowerCase()}.${c.l.toLowerCase().replace('ü', 'ue').replace('ö', 'oe')}@example.com`,
          `+49 151 ${String(2000000 + i * 137711).slice(0, 7)}`, c.city, c.region, c.country || 'Deutschland',
          c.country === 'Österreich' || c.country === 'Schweiz' ? 'Deutsch' : 'Deutsch, Englisch', c.niche,
          c.niche.replace(' / ', ', '), 'Fiktiver Demo-Creator.', uid(c.m), c.st, c.os, c.os !== 'Noch nicht kontaktiert',
          adminId, ts(-160 + i * 11),
        ]
      );
      const id = r[0].id;
      creatorIds.push(id);
      if (c.ig) await run(`insert into social_accounts (creator_id, platform, username, url, followers, engagement_rate) values ($1,'instagram',$2,$3,$4,$5)`, [id, c.ig[0], `https://www.instagram.com/${c.ig[0]}/`, c.ig[1], c.ig[2]]);
      if (c.tt) await run(`insert into social_accounts (creator_id, platform, username, url, followers, engagement_rate) values ($1,'tiktok',$2,$3,$4,$5)`, [id, c.tt[0], `https://www.tiktok.com/@${c.tt[0]}`, c.tt[1], c.tt[2]]);
      for (const t of c.tags) await run(`insert into creator_tags (creator_id, tag_id) values ($1, $2)`, [id, tagIds[t]]);
      if (c.contract) {
        const [status, s, e, excl] = c.contract;
        await run(
          `insert into contracts (creator_id, status, start_date, end_date, exclusivity, usage_rights, notice_period, updated_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, status, s === null ? null : day(s), e === null ? null : day(e), excl, 'Organische Nutzung 12 Monate, Paid Ads nach Absprache', '3 Monate zum Quartalsende', adminId]
        );
      }
      await logActivity({ creatorId: id, userId: adminId, entityType: 'creator', entityId: id, action: 'creator_created', message: `hat den Creator „${c.n}“ angelegt.` }, run);
    }

    const collabIds = [];
    for (const [ci, brand, campaign, s, e, status, platform, fee, invoice, dl, deliverables] of COLLABS) {
      const r = await run(
        `insert into collaborations (creator_id, brand, campaign_name, start_date, end_date, status, platform, description,
           deliverables, deadline, fee, invoice_status, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
        [creatorIds[ci], brand, campaign, day(s), day(e), status, platform, `Fiktive Demo-Kampagne „${campaign}“ für ${brand}.`,
          deliverables, dl === null ? null : day(dl), fee, invoice, adminId]
      );
      collabIds.push(r[0].id);
      await logActivity({ creatorId: creatorIds[ci], userId: adminId, entityType: 'collaboration', entityId: r[0].id, action: 'collaboration_created', message: `hat die Kooperation „${brand} – ${campaign}“ erstellt.` }, run);
    }

    for (const [ci, title, prio, status, due, u, co] of TASKS) {
      await run(
        `insert into tasks (title, creator_id, collaboration_id, assignee_id, priority, status, due_date, completed_at, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [title, ci === null ? null : creatorIds[ci], co === null ? null : collabIds[co], uid(u), prio, status, day(due),
          status === 'Erledigt' ? ts(due) : null, adminId]
      );
    }

    for (const [ci, off, channel, u, subject, message, result, fu, done] of OUTREACH) {
      await run(
        `insert into outreach_activities (creator_id, user_id, occurred_at, channel, subject, message, result, follow_up_date, follow_up_done)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [creatorIds[ci], uid(u), ts(off, 11), channel, subject, message, result, fu === null ? null : day(fu), done]
      );
      await run(`insert into activities (creator_id, user_id, entity_type, action, message, created_at) values ($1,$2,'outreach','creator_contacted',$3,$4)`,
        [creatorIds[ci], uid(u), `hat einen Kontakt erfasst (${channel} · ${result}).`, ts(off, 11)]);
    }

    // Realistische Zeitstempel für die Historie
    await run(`update activities a set created_at = c.created_at from creators c
               where a.creator_id = c.id and a.action = 'creator_created' and c.id = any($1::int[])`, [creatorIds]);
    await run(`update activities a set created_at = least(co.created_at, co.start_date::timestamptz - interval '14 days')
               from collaborations co where a.entity_type = 'collaboration' and a.entity_id = co.id and co.creator_id = any($1::int[])`, [creatorIds]);
    await run(`update creators c set last_activity_at = coalesce((select max(a.created_at) from activities a where a.creator_id = c.id), c.created_at)
               where c.id = any($1::int[])`, [creatorIds]);
  });
  return { creators: CREATORS.length };
}

export default function register(route) {
  route('POST', '/admin/seed-demo', async ({ user }) => {
    requireAdmin(user);
    const r = await seedDemoData(user.id);
    await logActivity({ userId: user.id, entityType: 'system', action: 'demo_seeded', message: `hat Demo-Daten geladen (${r.creators} Creator).` });
    return r;
  });

  route('GET', '/health', async () => {
    await q('select 1');
    return { ok: true };
  }, { auth: false });
}
