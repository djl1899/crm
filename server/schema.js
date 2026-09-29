import { q, tx } from './db.js';

// Versioniertes Schema. Neue Migrationen als weiteres Element anhängen – niemals bestehende ändern.
const MIGRATIONS = [
  // 1: Grundschema
  [
    `create table if not exists app_meta (
      key text primary key,
      value text not null
    )`,
    `create table if not exists users (
      id serial primary key,
      name text not null,
      email text not null,
      password_hash text not null,
      role text not null default 'manager',
      is_active boolean not null default true,
      token_version integer not null default 0,
      last_login_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`,
    `create unique index if not exists users_email_uq on users (lower(email))`,

    `create table if not exists creators (
      id serial primary key,
      display_name text not null,
      first_name text,
      last_name text,
      email text,
      phone text,
      city text,
      region text,
      country text,
      language text,
      niche text,
      interests text,
      notes text,
      avatar_key text,
      manager_id integer references users(id) on delete set null,
      status text not null default 'Lead',
      outreach_status text not null default 'Noch nicht kontaktiert',
      contacted boolean not null default false,
      created_by integer references users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      last_activity_at timestamptz not null default now()
    )`,
    `create index if not exists creators_status_idx on creators (status)`,
    `create index if not exists creators_manager_idx on creators (manager_id)`,
    `create index if not exists creators_last_activity_idx on creators (last_activity_at desc)`,
    `create index if not exists creators_created_idx on creators (created_at desc)`,
    `create index if not exists creators_name_idx on creators (lower(display_name))`,
    `create index if not exists creators_country_idx on creators (lower(country))`,
    `create index if not exists creators_region_idx on creators (lower(region))`,

    `create table if not exists social_accounts (
      id serial primary key,
      creator_id integer not null references creators(id) on delete cascade,
      platform text not null,
      username text,
      url text,
      followers integer,
      engagement_rate numeric(6,2),
      notes text,
      updated_at timestamptz not null default now(),
      unique (creator_id, platform)
    )`,
    `create index if not exists social_platform_followers_idx on social_accounts (platform, followers)`,
    `create index if not exists social_username_idx on social_accounts (lower(username))`,

    `create table if not exists outreach_activities (
      id serial primary key,
      creator_id integer not null references creators(id) on delete cascade,
      user_id integer references users(id) on delete set null,
      occurred_at timestamptz not null default now(),
      channel text not null,
      subject text,
      message text,
      result text,
      follow_up_date date,
      follow_up_done boolean not null default false,
      created_at timestamptz not null default now()
    )`,
    `create index if not exists outreach_creator_idx on outreach_activities (creator_id, occurred_at desc)`,
    `create index if not exists outreach_followup_idx on outreach_activities (follow_up_date) where follow_up_done = false`,

    `create table if not exists collaborations (
      id serial primary key,
      creator_id integer not null references creators(id) on delete cascade,
      brand text not null,
      campaign_name text,
      start_date date,
      end_date date,
      status text not null default 'Anfrage',
      platform text,
      description text,
      deliverables text,
      deadline date,
      fee numeric(12,2) not null default 0,
      invoice_status text not null default 'Nicht erstellt',
      notes text,
      created_by integer references users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`,
    `create index if not exists collab_creator_idx on collaborations (creator_id)`,
    `create index if not exists collab_status_idx on collaborations (status)`,
    `create index if not exists collab_deadline_idx on collaborations (deadline)`,

    `create table if not exists tasks (
      id serial primary key,
      title text not null,
      description text,
      creator_id integer references creators(id) on delete cascade,
      collaboration_id integer references collaborations(id) on delete set null,
      assignee_id integer references users(id) on delete set null,
      priority text not null default 'Normal',
      status text not null default 'Offen',
      due_date date,
      completed_at timestamptz,
      notes text,
      created_by integer references users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`,
    `create index if not exists tasks_status_due_idx on tasks (status, due_date)`,
    `create index if not exists tasks_creator_idx on tasks (creator_id)`,
    `create index if not exists tasks_assignee_idx on tasks (assignee_id)`,

    `create table if not exists contracts (
      id serial primary key,
      creator_id integer not null unique references creators(id) on delete cascade,
      status text not null default 'Kein Vertrag',
      start_date date,
      end_date date,
      exclusivity text,
      usage_rights text,
      notice_period text,
      notes text,
      updated_by integer references users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`,

    `create table if not exists documents (
      id serial primary key,
      creator_id integer not null references creators(id) on delete cascade,
      collaboration_id integer references collaborations(id) on delete set null,
      category text not null,
      filename text not null,
      mime_type text not null,
      size_bytes integer not null,
      blob_key text not null unique,
      uploaded_by integer references users(id) on delete set null,
      created_at timestamptz not null default now()
    )`,
    `create index if not exists documents_creator_idx on documents (creator_id, created_at desc)`,

    `create table if not exists tags (
      id serial primary key,
      name text not null,
      color text not null default 'gray',
      created_at timestamptz not null default now()
    )`,
    `create unique index if not exists tags_name_uq on tags (lower(name))`,

    `create table if not exists creator_tags (
      creator_id integer not null references creators(id) on delete cascade,
      tag_id integer not null references tags(id) on delete cascade,
      primary key (creator_id, tag_id)
    )`,
    `create index if not exists creator_tags_tag_idx on creator_tags (tag_id)`,

    `create table if not exists activities (
      id serial primary key,
      creator_id integer references creators(id) on delete cascade,
      user_id integer references users(id) on delete set null,
      entity_type text not null,
      entity_id integer,
      action text not null,
      message text not null,
      created_at timestamptz not null default now()
    )`,
    `create index if not exists activities_creator_idx on activities (creator_id, created_at desc)`,
    `create index if not exists activities_created_idx on activities (created_at desc)`,

    `create table if not exists login_attempts (
      id serial primary key,
      email text not null,
      ip text,
      success boolean not null,
      created_at timestamptz not null default now()
    )`,
    `create index if not exists login_attempts_idx on login_attempts (lower(email), created_at desc)`,
  ],
  // 2: Ausgaben
  [
    `create table if not exists expenses (
      id serial primary key,
      expense_date date not null,
      title text not null,
      category text not null default 'Sonstiges',
      amount numeric(12,2) not null,
      paid_by integer references users(id) on delete set null,
      creator_id integer references creators(id) on delete set null,
      notes text,
      created_by integer references users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`,
    `create index if not exists expenses_date_idx on expenses (expense_date desc)`,
    `create index if not exists expenses_category_idx on expenses (category)`,
  ],
];

export const SCHEMA_VERSION = MIGRATIONS.length;
let ensured = false;

export async function ensureSchema() {
  if (ensured) return;
  let current = 0;
  try {
    const rows = await q(`select value from app_meta where key = 'schema_version'`);
    current = rows[0] ? Number(rows[0].value) : 0;
  } catch {
    current = 0; // Tabelle existiert noch nicht
  }
  if (current < SCHEMA_VERSION) {
    await tx(async (run) => {
      await run(`select pg_advisory_xact_lock(918273645)`);
      let v = 0;
      try {
        await run(`create table if not exists app_meta (key text primary key, value text not null)`);
        const r = await run(`select value from app_meta where key = 'schema_version'`);
        v = r[0] ? Number(r[0].value) : 0;
      } catch {
        v = 0;
      }
      for (let i = v; i < MIGRATIONS.length; i++) {
        for (const stmt of MIGRATIONS[i]) await run(stmt);
      }
      await run(
        `insert into app_meta (key, value) values ('schema_version', $1)
         on conflict (key) do update set value = excluded.value`,
        [String(SCHEMA_VERSION)]
      );
    });
  }
  ensured = true;
}
