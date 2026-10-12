// Hilfen für mehrere Teammitglieder (Manager/Verantwortliche) pro Datensatz
import { q } from './db.js';
import { HttpError } from './http.js';

/** SQL-Ausdruck: Namen der Personen in Reihenfolge der Liste, z. B. "David Laier, Anton Kretschmer" */
export const namesSql = (col) =>
  `(select string_agg(zz.name, ', ' order by array_position(${col}, zz.id)) from users zz where zz.id = any(${col}))`;

/** Prüft, dass alle IDs Team-Benutzer sind (keine Creator-Konten). */
export async function assertTeamUsers(ids, field, label = 'Benutzer') {
  if (!ids || !ids.length) return;
  const rows = await q(`select id from users where id = any($1::int[]) and role <> 'creator'`, [ids]);
  if (rows.length !== ids.length) throw new HttpError(422, `${label} nicht gefunden.`, { [field]: 'Ungültige Auswahl.' });
}
