const DB_NAME = 'tnva-clock-studio';
const DB_VERSION = 2;
const PROJECTS = 'projects';
const SUBMISSIONS = 'communitySubmissions';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECTS)) {
        const store = db.createObjectStore(PROJECTS, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
        store.createIndex('title', 'title');
      }
      if (!db.objectStoreNames.contains(SUBMISSIONS)) {
        const submissions = db.createObjectStore(SUBMISSIONS, { keyPath: 'id' });
        submissions.createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(storeName, mode, operation) {
  const database = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let request;
      try { request = operation(store); } catch (error) { reject(error); return; }
      if (request) {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } else {
        tx.oncomplete = () => resolve();
      }
      tx.onerror = () => reject(tx.error);
    });
  } finally { database.close(); }
}

export async function saveProject(record) {
  const now = new Date().toISOString();
  const data = { ...record, updatedAt: now, createdAt: record.createdAt || now };
  await withStore(PROJECTS, 'readwrite', store => store.put(data));
  return data;
}
export const getProject = id => withStore(PROJECTS, 'readonly', store => store.get(id));
export async function listProjects() {
  const rows = await withStore(PROJECTS, 'readonly', store => store.getAll());
  return rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
export const deleteProject = id => withStore(PROJECTS, 'readwrite', store => store.delete(id));
export const clearProjects = () => withStore(PROJECTS, 'readwrite', store => store.clear());
