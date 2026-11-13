import { projectPaths } from "./ProjectPaths.js";
import { PrefabRegistry } from './PrefabRegistry.js';

/**
 * Writes a new (or overwritten) prefab straight to disk - unlike GameLoop.saveSceneToFile, this is
 * a dev-time authoring action only (no Save-As/download fallback tiers), so it needs dev_server.py's
 * PUT support to actually persist; without it, this throws and the caller (Inspector's "Save as
 * Prefab") just logs why rather than silently pretending it worked.
 *
 * Two files change: the prefab's own data file, and the manifest that lists it (js/game/prefabs/
 * index.json) - both PUT to disk, then registered in memory so it's immediately usable from the Add
 * menu this session without needing a reload to re-fetch what was just written.
 */
export async function savePrefab(id, name, entityData) {
    const dataPath = `${projectPaths().prefabs}/${id}.json`;
    const dataRes = await fetch(dataPath, { method: 'PUT', body: JSON.stringify(entityData, null, 2) });
    if (!dataRes.ok) throw new Error(`PUT ${dataPath} -> HTTP ${dataRes.status}`);

    await PrefabRegistry.ensureLoaded();
    const manifest = PrefabRegistry.list();
    const existing = manifest.find(e => e.id === id);
    if (existing) existing.name = name;
    else manifest.push({ id, name });

    const manifestPath = `${projectPaths().prefabs}/index.json`;
    const manifestRes = await fetch(manifestPath, { method: 'PUT', body: JSON.stringify(manifest, null, 2) });
    if (!manifestRes.ok) throw new Error(`PUT ${manifestPath} -> HTTP ${manifestRes.status}`);

    PrefabRegistry.registerLocal(id, name, entityData);
}
