import { ensureSchema } from './schema.js';
import { getSessionUser, checkCsrf } from './auth.js';
import { HttpError, json, errorResponse } from './http.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import creatorRoutes from './routes/creators.js';
import outreachRoutes from './routes/outreach.js';
import collaborationRoutes from './routes/collaborations.js';
import taskRoutes from './routes/tasks.js';
import contractRoutes from './routes/contracts.js';
import tagRoutes from './routes/tags.js';
import dashboardRoutes from './routes/dashboard.js';
import seedRoutes from './routes/seed.js';
import expenseRoutes from './routes/expenses.js';
import mediaRoutes from './routes/media.js';
import appRoutes from './routes/app.js';
import exportRoutes from './routes/export.js';
import settingsRoutes from './routes/settings.js';
import mediakitRoutes from './routes/mediakit.js';

const routes = [];

function route(method, pattern, handler, { auth = true } = {}) {
  const keys = [];
  const regex = new RegExp(
    '^' +
      pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => {
        keys.push(k);
        return '/([^/]+)';
      }) +
      '/?$'
  );
  routes.push({ method, regex, keys, handler, auth });
}

for (const register of [
  authRoutes, userRoutes, creatorRoutes, outreachRoutes, collaborationRoutes, taskRoutes,
  contractRoutes, tagRoutes, dashboardRoutes, seedRoutes, expenseRoutes, mediaRoutes, appRoutes, exportRoutes, settingsRoutes, mediakitRoutes,
]) {
  register(route);
}

function apiPath(url) {
  let p = url.pathname;
  if (p.startsWith('/.netlify/functions/api')) p = p.slice('/.netlify/functions/api'.length);
  else if (p.startsWith('/api')) p = p.slice(4);
  return p || '/';
}

export async function handle(req) {
  try {
    const url = new URL(req.url);
    const path = apiPath(url);
    let pathMatched = false;
    for (const r of routes) {
      const m = path.match(r.regex);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== req.method) continue;

      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));

      checkCsrf(req);
      await ensureSchema();
      const user = await getSessionUser(req);
      if (r.auth && !user) throw new HttpError(401, 'Bitte melde dich an.');

      const result = await r.handler({ req, params, query: url.searchParams, user });
      if (result instanceof Response) return result;
      return json(result ?? { ok: true });
    }
    throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'Methode nicht erlaubt.' : 'Endpunkt nicht gefunden.');
  } catch (err) {
    return errorResponse(err);
  }
}
