import steuern from './steuern.js';
import recht from './recht.js';
import agentur from './agentur.js';

export const GUIDES_UPDATED = 'Oktober 2026';
export const GUIDE_DISCLAIMER =
  'Dieser Leitfaden gibt einen verständlichen Überblick (Stand Oktober 2026) und ersetzt keine Steuer- oder Rechtsberatung. Gesetze und Grenzwerte ändern sich – im Einzelfall Steuerberater oder Anwalt fragen.';

export const CATEGORY_ORDER = ['Start & Organisation', 'Steuern', 'Werbung & Recht', 'Agentur'];

export const GUIDES = [...steuern, ...recht, ...agentur].map((g) => ({ ...g, body: g.body.trim(), updated: GUIDES_UPDATED }));

export const visibleGuides = (user) => GUIDES.filter((g) => user.role !== 'creator' || g.audience === 'all');
