import { projectPaths } from "./ProjectPaths.js";
/**
 * A prefab is a saved, standalone entity (the exact shape SceneIO's serializeEntity produces) that
 * can be dropped into any scene from the Add menu - unlike EntityRegistry (name -> hand-written
 * class, compile-time), this is name -> saved DATA, closer to how SceneRegistry's scene manifest
 * works: js/game/prefabs/index.json lists { id, name } entries, and each one's actual content lives
 * in its own js/game/prefabs/<id>.json (see PrefabIO.js). Placing one just stamps out an ordinary,
 * fully independent entity via SceneIO's buildEntityFromData - there's no ongoing link back to the
 * prefab afterward (editing the prefab later doesn't retroactively touch anything already placed),
 * which keeps this deliberately simple rather than chasing Unity-style prefab-instance overrides.
 */
class PrefabRegistryImpl {
    constructor() {
        this.entries = []; // { id, name }
        this._dataCache = new Map(); // id -> saved entity data
        this._manifestLoaded = false;
        this._loadingPromise = null;
    }

    /** Fetches the manifest once (cached thereafter, including across concurrent callers) - safe to
     * call repeatedly, e.g. every time the Add menu's Prefab tab is opened. */
    ensureLoaded() {
        if (this._manifestLoaded) return Promise.resolve();
        if (this._loadingPromise) return this._loadingPromise;
        this._loadingPromise = (async () => {
            try {
                const res = await fetch(`${projectPaths().prefabs}/index.json`);
                if (res.ok) this.entries = await res.json();
            } catch (e) {
                console.error('Failed to load the prefab manifest:', e);
            }
            this._manifestLoaded = true;
        })();
        return this._loadingPromise;
    }

    list() {
        return [...this.entries];
    }

    /** Case-insensitive substring match on name - mirrors EntityRegistry/ComponentRegistry's own
     * search() shape, minus the grouping neither registry needs here (prefabs aren't categorized). */
    search(query = '') {
        const q = query.trim().toLowerCase();
        return this.entries.filter(e => e.name.toLowerCase().includes(q));
    }

    /** This prefab's saved entity data, fetching (and caching) it on first use. Throws if `id`
     * isn't a real prefab file - callers (the Add menu) only ever pass an id this same registry's
     * own list()/search() just handed them, so that should never actually happen in practice. */
    async getData(id) {
        if (this._dataCache.has(id)) return this._dataCache.get(id);
        const res = await fetch(`${projectPaths().prefabs}/${id}.json`);
        if (!res.ok) throw new Error(`Prefab "${id}" not found (HTTP ${res.status})`);
        const data = await res.json();
        this._dataCache.set(id, data);
        return data;
    }

    /** Adds (or overwrites) a prefab entry in memory - called right after a successful save (see
     * PrefabIO.savePrefab) so it's usable this session without needing a page reload to re-fetch
     * the manifest. */
    registerLocal(id, name, data) {
        const existing = this.entries.find(e => e.id === id);
        if (existing) existing.name = name;
        else this.entries.push({ id, name });
        this._dataCache.set(id, data);
    }

    /** A filename-safe id guaranteed not to collide with anything already registered - same slug
     * scheme as SceneRegistry.uniqueId, kept separate since prefab ids and scene ids are different
     * namespaces (both happen to be "words in a folder", nothing more in common than that). */
    uniqueId(fromName) {
        const base = fromName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'prefab';
        let id = base;
        let n = 2;
        while (this.entries.some(e => e.id === id)) {
            id = `${base}_${n}`;
            n++;
        }
        return id;
    }
}

export const PrefabRegistry = new PrefabRegistryImpl();
