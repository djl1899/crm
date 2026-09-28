// Netlify Function: komplette REST-API unter /api/* (siehe netlify.toml Redirect)
import { handle } from '../../server/router.js';

export default async (req) => handle(req);
