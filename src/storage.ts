import type { ParsedActivity } from "./types";

// Use a new DB name to avoid version conflicts from previous iterations
// that used auto-incrementing or hash-based version numbers.
const DB_NAME = "paceapp-v2";
const DB_VERSION = 1;
const STORE_NAME = "activities";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "fileName" });
      }
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

/**
 * Saves activities to IndexedDB. Raw data (laps, records, summary)
 * persists across deploys. Derived fields (segments, workoutType,
 * workoutLabel) are recomputed on every load via reprocessActivity.
 */
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
