// db.js — thin promise-based wrapper around IndexedDB.
// No dependency needed at this scale (NFR-07: keep storage layer isolated
// so it can be swapped for Dexie.js later without touching the UI).

const DB_NAME = 'notes-app-db';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('notes')) {
        const notes = db.createObjectStore('notes', { keyPath: 'id' });
        notes.createIndex('folderId', 'folderId');
        notes.createIndex('updatedAt', 'updatedAt');
        notes.createIndex('archived', 'archived');
        notes.createIndex('deleted', 'deleted');
      }
      if (!db.objectStoreNames.contains('folders')) {
        const folders = db.createObjectStore('folders', { keyPath: 'id' });
        folders.createIndex('parentId', 'parentId');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const db = {
  async getAll(storeName) {
    const store = await tx(storeName, 'readonly');
    return reqToPromise(store.getAll());
  },
  async get(storeName, id) {
    const store = await tx(storeName, 'readonly');
    return reqToPromise(store.get(id));
  },
  async put(storeName, value) {
    const store = await tx(storeName, 'readwrite');
    return reqToPromise(store.put(value));
  },
  async delete(storeName, id) {
    const store = await tx(storeName, 'readwrite');
    return reqToPromise(store.delete(id));
  },
  async bulkPut(storeName, values) {
    const storeDb = await openDB();
    const store = storeDb.transaction(storeName, 'readwrite').objectStore(storeName);
    await Promise.all(values.map((v) => reqToPromise(store.put(v))));
  },
  async clear(storeName) {
    const store = await tx(storeName, 'readwrite');
    return reqToPromise(store.clear());
  },
  async getMeta(key) {
    const row = await this.get('meta', key);
    return row ? row.value : undefined;
  },
  async setMeta(key, value) {
    return this.put('meta', { key, value });
  },
};

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function nowISO() {
  return new Date().toISOString();
}
