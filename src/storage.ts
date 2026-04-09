import type { ParsedActivity } from "./types";

/**
 * DB version is derived from CACHE_VERSION — a hash of the parsing
 * source files injected at build time by vite.config.ts.
 * When parseFit.ts, segmenter.ts, detectWorkout.ts, or labeller.ts
 * change, the hash changes and the DB is wiped automatically.
 */
declare const __CACHE_VERSION__: number;
const DB_NAME = "paceapp";
const DB_VERSION = typeof __CACHE_VERSION__ !== "undefined" ? __CACHE_VERSION__ : 1;
const STORE_NAME = "activities";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      db.createObjectStore(STORE_NAME, { keyPath: "fileName" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadActivities(): Promise<ParsedActivity[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as ParsedActivity[]);
    req.onerror = () => reject(req.error);
  });
}

export async function saveActivities(activities: ParsedActivity[]): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  for (const a of activities) {
    store.put(a);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearActivities(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
