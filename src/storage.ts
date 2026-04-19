import type { ParsedActivity } from "./types";

// Use a new DB name to avoid version conflicts from previous iterations
// that used auto-incrementing or hash-based version numbers.
const DB_NAME = "paceapp-v2";
const DB_VERSION = 2;
const STORE_NAME = "activities";
const BLOB_STORE = "fitBlobs";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "fileName" });
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        // keyPath is the fileName string, value is an ArrayBuffer.
        db.createObjectStore(BLOB_STORE);
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
  const tx = db.transaction([STORE_NAME, BLOB_STORE], "readwrite");
  tx.objectStore(STORE_NAME).clear();
  tx.objectStore(BLOB_STORE).clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Save the original .fit bytes keyed by fileName so they can be uploaded later. */
export async function saveFitBlob(fileName: string, buffer: ArrayBuffer): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(BLOB_STORE, "readwrite");
  tx.objectStore(BLOB_STORE).put(buffer, fileName);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadFitBlob(fileName: string): Promise<ArrayBuffer | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, "readonly");
    const req = tx.objectStore(BLOB_STORE).get(fileName);
    req.onsuccess = () => resolve((req.result as ArrayBuffer | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}
