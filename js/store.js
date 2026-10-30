// store.js — saves everything in the browser with IndexedDB, so the app works offline.
// Two stores: "plays" (one record per play) and "kv" (settings, progress, flags).

const DB_NAME = 'playlens';
const DB_VERSION = 1;
let dbPromise;

function openDb() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('plays', { keyPath: 'id' });
      db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}

export const getPlays = () => run('plays', 'readonly', (s) => s.getAll());
export const savePlay = (play) => run('plays', 'readwrite', (s) => { s.put(play); });
export const deletePlay = (id) => run('plays', 'readwrite', (s) => { s.delete(id); });
export const clearPlays = () => run('plays', 'readwrite', (s) => { s.clear(); });
export const kvGet = (key) => run('kv', 'readonly', (s) => s.get(key));
export const kvSet = (key, value) => run('kv', 'readwrite', (s) => { s.put(value, key); });
