/**
 * Persists FileSystemFileHandle objects (from the File System Access API's showSaveFilePicker)
 * across page reloads, keyed by an arbitrary string - so GameLoop's Save-As fallback (used only
 * when the dev server's direct PUT save isn't available - see GameLoop#saveSceneToFile) has to
 * prompt for a destination once per scene, ever, not on every single save. IndexedDB rather than
 * localStorage because a FileSystemFileHandle isn't JSON-serializable but IS structured-cloneable,
 * which IndexedDB supports directly.
 */
const DB_NAME = 'piston-file-handles';
const STORE_NAME = 'handles';

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function getHandle(key) {
    try {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(key);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        return null; // no IndexedDB access (e.g. private browsing) - just means prompting every time
    }
}

export async function setHandle(key, handle) {
    try {
        const db = await openDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(handle, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) { /* not fatal - just means it'll prompt again next time */ }
}
