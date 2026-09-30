// Einfache Einstellungen (Schlüssel/Wert in app_meta)
import { q, one } from './db.js';

export const SETTING_DEFAULTS = {
  default_commission_rate: '20',
  agency_name: 'LLK Management',
  agency_email: '',
  agency_website: '',
};

export async function getSettings() {
  const rows = await q(`select key, value from app_meta where key = any($1::text[])`, [Object.keys(SETTING_DEFAULTS)]);
  const out = { ...SETTING_DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  out.default_commission_rate = Number(out.default_commission_rate);
  return out;
}

export async function setSetting(key, value) {
  await q(
    `insert into app_meta (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value`,
    [key, String(value ?? '')]
  );
}

export async function getSetting(key) {
  const row = await one(`select value from app_meta where key = $1`, [key]);
  return row ? row.value : SETTING_DEFAULTS[key];
}
