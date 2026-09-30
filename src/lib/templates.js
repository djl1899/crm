// Platzhalter in Nachrichten-Vorlagen ersetzen
const nf = new Intl.NumberFormat('de-DE');

export function renderTemplate(text, { creator = {}, socials = {}, me = {} } = {}) {
  const ig = socials.instagram || {};
  const tt = socials.tiktok || {};
  const followers = Math.max(ig.followers || 0, tt.followers || 0);
  const values = {
    Vorname: creator.first_name || (creator.display_name || '').split(' ')[0] || '',
    Name: creator.display_name || '',
    Nische: creator.niche || '',
    Ort: creator.city || creator.region || '',
    Instagram: ig.username ? '@' + ig.username : '',
    TikTok: tt.username ? '@' + tt.username : '',
    Follower: followers ? nf.format(followers) : '',
    MeinName: me.name || '',
  };
  return String(text || '').replace(/\{(\w+)\}/g, (m, key) => (key in values ? values[key] : m));
}
