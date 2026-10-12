// Orte und Kategorien für die Karte – ohne externe Dienste.
// Koordinaten = Stadtmitte (WGS84). Unbekannte Orte sucht der Browser einmalig über OpenStreetMap
// und das CRM speichert das Ergebnis (Tabelle geo_places).

// [Name, Breite, Länge, Aliasse…]
const PLACES = [
  // Rhein-Neckar & Umgebung
  ['Mannheim', 49.4875, 8.4660], ['Heidelberg', 49.3988, 8.6724], ['Ludwigshafen am Rhein', 49.4774, 8.4452, 'Ludwigshafen'],
  ['Viernheim', 49.5402, 8.5788], ['Weinheim', 49.5487, 8.6691], ['Schwetzingen', 49.3833, 8.5704], ['Hockenheim', 49.3223, 8.5475],
  ['Wiesloch', 49.2942, 8.6987], ['Walldorf', 49.3062, 8.6426], ['Leimen', 49.3476, 8.6915], ['Sinsheim', 49.2528, 8.8790],
  ['Eppelheim', 49.4019, 8.6305], ['Ladenburg', 49.4728, 8.6090], ['Edingen-Neckarhausen', 49.4560, 8.6070, 'Edingen', 'Neckarhausen'],
  ['Ilvesheim', 49.4708, 8.5667], ['Brühl', 49.4016, 8.5323], ['Ketsch', 49.3667, 8.5333], ['Oftersheim', 49.3664, 8.5850],
  ['Plankstadt', 49.3946, 8.5965], ['Dossenheim', 49.4500, 8.6720], ['Schriesheim', 49.4740, 8.6590], ['Hirschberg an der Bergstraße', 49.5070, 8.6640, 'Hirschberg'],
  ['Heddesheim', 49.5050, 8.6040], ['Lampertheim', 49.5970, 8.4710], ['Bürstadt', 49.6430, 8.4590], ['Bensheim', 49.6810, 8.6170],
  ['Heppenheim', 49.6420, 8.6390], ['Lorsch', 49.6540, 8.5690], ['Worms', 49.6341, 8.3507], ['Frankenthal', 49.5336, 8.3536],
  ['Speyer', 49.3173, 8.4412], ['Schifferstadt', 49.3850, 8.3750], ['Limburgerhof', 49.4210, 8.3930], ['Neckargemünd', 49.3890, 8.7970],
  ['Mosbach', 49.3530, 9.1450], ['Eberbach', 49.4660, 8.9850], ['Bad Dürkheim', 49.4600, 8.1680],
  ['Neustadt an der Weinstraße', 49.3500, 8.1390, 'Neustadt Weinstraße', 'Neustadt a. d. Weinstraße'], ['Landau in der Pfalz', 49.1990, 8.1180, 'Landau'],
  ['Germersheim', 49.2230, 8.3640], ['Waghäusel', 49.2490, 8.5130], ['Philippsburg', 49.2330, 8.4600], ['Bruchsal', 49.1240, 8.5980],
  ['Bretten', 49.0360, 8.7060], ['Stutensee', 49.0660, 8.4860], ['Ettlingen', 48.9410, 8.4070], ['Karlsruhe', 49.0069, 8.4037],
  ['Rastatt', 48.8580, 8.2040], ['Baden-Baden', 48.7610, 8.2410], ['Pforzheim', 48.8920, 8.6940], ['Heilbronn', 49.1427, 9.2109],
  ['Darmstadt', 49.8728, 8.6512], ['Kaiserslautern', 49.4447, 7.7690],
  // Großstädte & weitere Städte
  ['Berlin', 52.5200, 13.4050], ['Hamburg', 53.5511, 9.9937], ['München', 48.1372, 11.5755, 'Muenchen', 'Munich'],
  ['Köln', 50.9375, 6.9603, 'Koeln', 'Cologne'], ['Frankfurt am Main', 50.1109, 8.6821, 'Frankfurt', 'Frankfurt a. M.'], ['Stuttgart', 48.7758, 9.1829],
  ['Düsseldorf', 51.2277, 6.7735, 'Duesseldorf'], ['Dortmund', 51.5136, 7.4653], ['Essen', 51.4556, 7.0116], ['Leipzig', 51.3397, 12.3731],
  ['Bremen', 53.0793, 8.8017], ['Dresden', 51.0504, 13.7373], ['Hannover', 52.3759, 9.7320], ['Nürnberg', 49.4521, 11.0767, 'Nuernberg'],
  ['Duisburg', 51.4344, 6.7623], ['Bochum', 51.4818, 7.2162], ['Wuppertal', 51.2562, 7.1508], ['Bielefeld', 52.0302, 8.5325],
  ['Bonn', 50.7374, 7.0982], ['Münster', 51.9607, 7.6261], ['Augsburg', 48.3705, 10.8978], ['Wiesbaden', 50.0782, 8.2398],
  ['Mönchengladbach', 51.1805, 6.4428], ['Gelsenkirchen', 51.5177, 7.0857], ['Aachen', 50.7753, 6.0839], ['Braunschweig', 52.2689, 10.5268],
  ['Kiel', 54.3233, 10.1228], ['Chemnitz', 50.8278, 12.9214], ['Halle (Saale)', 51.4825, 11.9697, 'Halle'], ['Magdeburg', 52.1205, 11.6276],
  ['Freiburg im Breisgau', 47.9990, 7.8421, 'Freiburg'], ['Krefeld', 51.3388, 6.5853], ['Mainz', 49.9929, 8.2473], ['Lübeck', 53.8655, 10.6866],
  ['Erfurt', 50.9787, 11.0328], ['Oberhausen', 51.4963, 6.8638], ['Rostock', 54.0924, 12.0991], ['Kassel', 51.3127, 9.4797],
  ['Hagen', 51.3671, 7.4633], ['Potsdam', 52.3906, 13.0645], ['Saarbrücken', 49.2402, 6.9969], ['Hamm', 51.6739, 7.8150],
  ['Mülheim an der Ruhr', 51.4275, 6.8825, 'Mülheim'], ['Oldenburg', 53.1435, 8.2146], ['Osnabrück', 52.2799, 8.0472], ['Leverkusen', 51.0459, 7.0192],
  ['Solingen', 51.1652, 7.0671], ['Herne', 51.5369, 7.2009], ['Neuss', 51.2042, 6.6879], ['Paderborn', 51.7189, 8.7575],
  ['Regensburg', 49.0134, 12.1016], ['Ingolstadt', 48.7665, 11.4258], ['Offenbach am Main', 50.0956, 8.7761, 'Offenbach'], ['Würzburg', 49.7913, 9.9534],
  ['Ulm', 48.4011, 9.9876], ['Wolfsburg', 52.4227, 10.7865], ['Göttingen', 51.5413, 9.9158], ['Bottrop', 51.5236, 6.9285],
  ['Reutlingen', 48.4914, 9.2043], ['Koblenz', 50.3569, 7.5890], ['Bremerhaven', 53.5396, 8.5809], ['Recklinghausen', 51.6141, 7.1979],
  ['Erlangen', 49.5897, 11.0040], ['Bergisch Gladbach', 50.9921, 7.1363], ['Trier', 49.7490, 6.6371], ['Jena', 50.9271, 11.5892],
  ['Remscheid', 51.1787, 7.1897], ['Moers', 51.4516, 6.6408], ['Siegen', 50.8748, 8.0243], ['Hildesheim', 52.1508, 9.9511],
  ['Cottbus', 51.7563, 14.3329], ['Gütersloh', 51.9032, 8.3858], ['Schwerin', 53.6355, 11.4012], ['Iserlohn', 51.3755, 7.6958],
  ['Fürth', 49.4771, 10.9887], ['Gießen', 50.5841, 8.6784], ['Marburg', 50.8022, 8.7667], ['Fulda', 50.5558, 9.6808], ['Hanau', 50.1328, 8.9169],
  ['Ludwigsburg', 48.8975, 9.1919], ['Esslingen am Neckar', 48.7406, 9.3108, 'Esslingen'], ['Tübingen', 48.5216, 9.0576], ['Konstanz', 47.6603, 9.1758],
  ['Böblingen', 48.6856, 9.0153], ['Sindelfingen', 48.7133, 9.0028], ['Bamberg', 49.8988, 10.9028], ['Bayreuth', 49.9456, 11.5713],
  ['Passau', 48.5665, 13.4312], ['Landshut', 48.5442, 12.1469], ['Rosenheim', 47.8561, 12.1289], ['Flensburg', 54.7937, 9.4469],
  ['Zwickau', 50.7189, 12.4964], ['Weimar', 50.9795, 11.3235], ['Gera', 50.8806, 12.0821], ['Frankfurt (Oder)', 52.3471, 14.5506],
  // Österreich & Schweiz
  ['Wien', 48.2082, 16.3738, 'Vienna'], ['Graz', 47.0707, 15.4395], ['Linz', 48.3069, 14.2858], ['Salzburg', 47.8095, 13.0550],
  ['Innsbruck', 47.2692, 11.4041], ['Zürich', 47.3769, 8.5417, 'Zurich'], ['Basel', 47.5596, 7.5886], ['Bern', 46.9480, 7.4474], ['Luzern', 47.0502, 8.3093],
];

/** Normalisierter Schlüssel eines Ortes, z. B. " Mannheim-Neckarau " → "mannheim-neckarau" */
export const placeKey = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,]+$/, '');

export const GAZETTEER = (() => {
  const m = {};
  for (const [name, lat, lng, ...aliases] of PLACES) {
    for (const n of [name, ...aliases]) m[placeKey(n)] = { name, lat, lng };
  }
  return m;
})();

/** Ort aus dem eingebauten Verzeichnis; versteht auch "Mannheim-Neckarau" oder "68161 Mannheim". */
export function lookupPlace(city) {
  const k = placeKey(city).replace(/^\d{5}\s+/, '');
  if (!k) return null;
  if (GAZETTEER[k]) return GAZETTEER[k];
  const base = k.split(/\s*[-/(]\s*|\s+-\s+/)[0];
  return GAZETTEER[base] || null;
}

// ------------------------------------------------------------------
// Kategorien: Nischen der Creator und Branchen der Firmen auf gemeinsame Oberbegriffe bringen
export const CATEGORIES = [
  { name: 'Food', color: '#e8590c', words: ['food', 'essen', 'kochen', 'koch', 'rezept', 'restaurant', 'café', 'cafe', 'kaffee', 'coffee', 'matcha', 'açaí', 'acai', 'bubble tea', 'tee', 'tea', 'brunch', 'frühstück', 'burger', 'pizza', 'eis', 'gelato', 'eisdiele', 'eiscafé', 'bowl', 'poké', 'poke', 'bäckerei', 'patisserie', 'konditorei', 'kuchen', 'dessert', 'cookie', 'donut', 'macaron', 'smoothie', 'saft', 'malatang', 'bagel', 'schokolade', 'healthy food', 'bar', 'säfte', 'snack', 'croissant', 'vegetarisch', 'vegan', 'bistro', 'imbiss', 'bakery', 'manufaktur', 'eiscafe', 'gastro'] },
  { name: 'Fashion', color: '#c2255c', words: ['fashion', 'mode', 'styling', 'outfit', 'streetwear', 'model'] },
  { name: 'Beauty', color: '#d6336c', words: ['beauty', 'makeup', 'make-up', 'skincare', 'kosmetik', 'haare', 'nails'] },
  { name: 'Lifestyle', color: '#5f3dc4', words: ['lifestyle', 'alltag', 'mom life', 'family', 'familie', 'wellness', 'pets', 'haustiere'] },
  { name: 'Travel', color: '#1971c2', words: ['travel', 'reisen', 'reise', 'hotel', 'urlaub'] },
  { name: 'Sport & Fitness', color: '#2b8a3e', words: ['sport', 'fitness', 'fußball', 'fussball', 'hockey', 'gym', 'yoga', 'laufen', 'running'] },
  { name: 'Tech & Gaming', color: '#0c8599', words: ['tech', 'gaming', 'games', 'technik', 'apps'] },
  { name: 'Kunst & Kultur', color: '#862e9c', words: ['kunst', 'kultur', 'art', 'musik', 'music', 'fotografie', 'häkeln', 'diy'] },
  { name: 'Auto & Mobilität', color: '#495057', words: ['auto', 'autos', 'cars', 'mobilität', 'fahrrad'] },
  { name: 'UGC', color: '#868e96', words: ['ugc'] },
];
const OTHER_COLOR = '#868e96';

/**
 * "Lifestyle, Beauty, Food (UGC)" → ['Lifestyle', 'Beauty', 'Food', 'UGC'] (Oberbegriffe, ohne Dopplungen).
 * Letztes Argument { strict: true } → nur bekannte Oberbegriffe, keine freien Begriffe.
 */
export function toCategories(...args) {
  const opts = args.length && typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null ? args.pop() : {};
  const out = [];
  for (const text of args) {
    if (!text) continue;
    const parts = String(text).toLowerCase().split(/[,/;&+:()|]|\bund\b|\bor\b/).map((x) => x.trim()).filter(Boolean);
    for (const part of parts) {
      const hit = CATEGORIES.find((c) => c.words.some((w) => part === w || (w.length > 3 && part.includes(w))));
      const name = hit ? hit.name : !opts.strict && part.length > 2 && part.length < 30 && !/\d/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : null;
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

export const categoryColor = (name) => CATEGORIES.find((c) => c.name === name)?.color || OTHER_COLOR;
