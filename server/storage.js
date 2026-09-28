// Dateispeicher. In Produktion: Netlify Blobs (dauerhaft, automatisch in jeder Netlify-Site verfügbar).
// Für lokale Tests kann ein anderer Speicher gesetzt werden.

let storage = null;

export function setStorage(s) {
  storage = s;
}

async function getStorage() {
  if (storage) return storage;
  const { getStore } = await import('@netlify/blobs');
  const store = getStore({ name: 'crm-files', consistency: 'strong' });
  storage = {
    async put(key, data, metadata = {}) {
      await store.set(key, data, { metadata });
    },
    async get(key) {
      const res = await store.getWithMetadata(key, { type: 'arrayBuffer' });
      if (!res) return null;
      return { data: res.data, metadata: res.metadata || {} };
    },
    async remove(key) {
      await store.delete(key);
    },
  };
  return storage;
}

export async function putFile(key, data, metadata) {
  return (await getStorage()).put(key, data, metadata);
}
export async function getFile(key) {
  return (await getStorage()).get(key);
}
export async function removeFile(key) {
  try {
    await (await getStorage()).remove(key);
  } catch (e) {
    console.error('[storage] Löschen fehlgeschlagen', key, e);
  }
}
