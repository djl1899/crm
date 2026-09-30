// Geplante Netlify-Funktion: schickt jeden Morgen die Tagesübersicht an alle Benutzer mit aktivierter Mail.
// Zeitplan in UTC: 05:00 UTC = 07:00 Uhr Sommerzeit / 06:00 Uhr Winterzeit (Deutschland).
import { ensureSchema } from '../../server/schema.js';
import { sendAllDigests } from '../../server/digest.js';

export default async () => {
  await ensureSchema();
  const results = await sendAllDigests();
  console.log('[daily-digest]', JSON.stringify(results));
  return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
};

export const config = { schedule: '0 5 * * *' };
