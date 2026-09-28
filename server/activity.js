import { q } from './db.js';

/**
 * Speichert einen Eintrag in der Aktivitäten-Historie und aktualisiert "letzte Aktivität" des Creators.
 * message wird ohne Benutzernamen gespeichert, z. B. "hat den Status von 'Lead' auf 'Aktiv' geändert."
 * run: optionale Query-Funktion (innerhalb einer Transaktion)
 */
export async function logActivity({ creatorId = null, userId = null, entityType, entityId = null, action, message }, run = q) {
  await run(
    `insert into activities (creator_id, user_id, entity_type, entity_id, action, message)
     values ($1, $2, $3, $4, $5, $6)`,
    [creatorId, userId, entityType, entityId, action, message]
  );
  if (creatorId) {
    await run(`update creators set last_activity_at = now() where id = $1`, [creatorId]);
  }
}
