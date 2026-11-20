import { CadProject } from '../types/cad';

const DB_NAME = 'WebCad_Deneme1_DB';
const DB_VERSION = 1;
const STORE_NAME = 'projects';
const ACTIVE_KEY = 'autosave_active';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveProjectToIndexedDb(project: CadProject): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(project, ACTIVE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Graceful no-op in restricted contexts
  }
}

export async function loadProjectFromIndexedDb(): Promise<CadProject | null> {
  try {
    const db = await openDb();
    const res = await new Promise<CadProject | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(ACTIVE_KEY);
      req.onsuccess = () => resolve((req.result as CadProject) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return res;
  } catch {
    return null;
  }
}

export async function clearProjectInIndexedDb(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(ACTIVE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Graceful no-op
  }
}
