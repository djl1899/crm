// Datenbankzugriff. In Produktion wird `pg` (PostgreSQL) verwendet.
// Verbindung über DATABASE_URL (z. B. Neon, Supabase, eigener Postgres)
// oder NETLIFY_DATABASE_URL (ältere Netlify-DB-/Neon-Erweiterung).

let driver = null;

/** Für lokale Tests kann ein eigener Treiber gesetzt werden: { query(text, params), transaction(fn) } */
export function setDriver(d) {
  driver = d;
}

async function createPgDriver() {
  const connectionString =
    process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
  if (!connectionString) {
    const err = new Error(
      'Keine Datenbank konfiguriert. Bitte in Netlify unter Site configuration → Environment variables die Variable DATABASE_URL setzen und neu deployen.'
    );
    err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  const mod = await import('pg');
  const pg = mod.default || mod;
  pg.types.setTypeParser(1082, (v) => v); // DATE als 'YYYY-MM-DD'
  pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // NUMERIC
  pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10))); // BIGINT (count)

  const isLocal = /localhost|127\.0\.0\.1|host=\/|@\/|%2F/.test(connectionString);
  const pool = new pg.Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: isLocal || /sslmode=disable/.test(connectionString) ? false : { rejectUnauthorized: false },
  });

  return {
    async query(text, params = []) {
      const res = await pool.query(text, params);
      return res.rows;
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(async (text, params = []) => (await client.query(text, params)).rows);
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

async function getDriver() {
  if (!driver) driver = await createPgDriver();
  return driver;
}

/** Führt eine Abfrage aus und gibt die Zeilen zurück. */
export async function q(text, params = []) {
  return (await getDriver()).query(text, params);
}

export async function one(text, params = []) {
  const rows = await q(text, params);
  return rows[0] || null;
}

/** Transaktion: fn erhält eine Query-Funktion (text, params) => rows */
export async function tx(fn) {
  return (await getDriver()).transaction(fn);
}

// "Heute" in deutscher Zeitzone (Server läuft in UTC)
export const APP_TZ = 'Europe/Berlin';
export const TODAY = `((now() at time zone '${APP_TZ}')::date)`;
