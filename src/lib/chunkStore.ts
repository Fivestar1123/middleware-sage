// Chunk blob cache backed by IndexedDB.
// Stores each split chunk as a Blob keyed by (entryId, name), so the JS heap
// only holds lightweight references and chunks can be lazy-loaded on demand.

const DB_NAME = 'splitter-cache';
const STORE = 'chunks';
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

const openDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('entryId', 'entryId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
};

const chunkKey = (entryId: string, name: string) => `${entryId}::${name}`;

export const putChunkBlob = async (entryId: string, name: string, blob: Blob): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ key: chunkKey(entryId, name), entryId, name, blob });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};

export const getChunkBlob = async (entryId: string, name: string): Promise<Blob | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(chunkKey(entryId, name));
    req.onsuccess = () => resolve((req.result as { blob: Blob } | undefined)?.blob ?? null);
    req.onerror = () => reject(req.error);
  });
};

export const deleteEntryChunks = async (entryId: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const idx = store.index('entryId');
    const req = idx.openKeyCursor(IDBKeyRange.only(entryId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};

export const hasEntryChunks = async (entryId: string, expected: number): Promise<boolean> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).index('entryId').count(IDBKeyRange.only(entryId));
    req.onsuccess = () => resolve(req.result >= expected);
    req.onerror = () => reject(req.error);
  });
};
