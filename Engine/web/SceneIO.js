import { projectPaths } from "./ProjectPaths.js";
import { Vector2 } from './Physics/Vector2.js';
import { ComponentRegistry } from './ComponentRegistry.js';
import { EntityRegistry } from './EntityRegistry.js';

/**
 * A scene's *level file* (js/game/scenes/<scene.id>.json) is the source of truth once one exists -
 * GameLoop.start() fetches and rebuilds every entity straight from it via buildEntitiesFromLevelData
 * below, and the Scene's own `create()` factory is only ever used to bootstrap that file the very
 * first time (see Scene.js). This replaced an earlier design where `create()` was the permanent
 * source of truth and a browser-local autosave silently replayed a diff on top of it every load -
 * that meant the only record of a deliberate edit (e.g. deleting an obstacle) was one specific
 * browser tab's localStorage, with no protection against a second stale tab's own autosave timer
 * silently overwriting it later. A committed JSON file doesn't have that failure mode: it's one
 * file, in git, and loading it is just reading it.
 *
 * serializeScene/applySceneData below are what File > Save writes and what a manual "restore my
 * last unsaved draft" still uses - not something GameLoop applies automatically on every load
 * anymore. All matched by each entity's stable `_sceneKey` - "Tag#N" by creation order for
 * scene-authored entities (assigned once in GameLoop#instantiateScene), or "added:<id>" for ones
 * added at runtime (assigned in GameLoop#addEntityFromRegistry).
 */

/** Where a scene's canonical, committed level data lives - see Scene.js's `id` field doc. Lives
 * alongside the scene manifest (js/game/scenes/index.js) rather than a separate levels/ folder,
 * since a scene registration and its level data are two halves of the same thing. */
export function levelPath(scene) {
    return `${projectPaths().scenes}/${scene.id}.json`;
}

/**
 * Rebuilds a scene's entire entity list straight from a level file's saved data - unlike
 * applySceneData below, there's no `create()` call to match against or diff onto: the file itself
 * is the complete, authoritative definition, so every entity is reconstructed from its registered
 * EntityRegistry type (the same mechanism GameLoop#addEntityFromRegistry uses for the Add menu) and
 * then has its saved transform/rigidbody/collider/component/field data applied on top.
 */
export function buildEntitiesFromLevelData(gameLoop, data) {
    const built = []; // { entity, saved }
    for (const saved of data.entities) {
        const entity = buildEntityFromData(gameLoop, saved);
        if (entity) built.push({ entity, saved });
    }
    // A separate pass, after every entity in the batch already exists - nothing about save order
    // guarantees a parent appears before its children in data.entities.
    const entities = built.map(b => b.entity);
    for (const { entity, saved } of built) linkParent(entity, saved, entities);
    applySceneSettings(gameLoop, data);
    return entities;
}

/** Wires up `entity.parent` from `saved.parentKey` (see Entity#setParent/serializeEntity) by
 * matching against `candidates`' own sceneKeys - `candidates` is passed in explicitly rather than
 * assumed to be `gameLoop.entities`, since during a full scene (re)load the entities being built
 * aren't in `gameLoop.entities` yet (the scene being replaced still is, until the whole batch
 * finishes) - matching against that would wire a freshly-loaded entity's parent to a stale object
 * from the scene it's replacing, not its actual sibling from this same load. */
export function linkParent(entity, saved, candidates) {
    if (!saved.parentKey) return;
    const parent = candidates.find(e => e._sceneKey === saved.parentKey);
    if (parent) entity.setParent(parent);
}

/**
 * Reconstructs one entity from a saved data blob (the exact shape serializeEntity below produces)
 * - the shared inner step behind buildEntitiesFromLevelData's per-entity loop above, and reused
 * wholesale for anything else that needs "turn this saved JSON into a live entity": a prefab
 * instance (see GameLoop#addPrefabInstance), a duplicate, or a pasted clipboard entry (see
 * GameLoop#duplicateEntity/#pasteEntityData) - all three are really just "the level-load path, run
 * once, outside of loading an actual scene." Returns null (rather than throwing) for an
 * unregistered/renamed type, same as a level file silently dropping one - a stale prefab
 * referencing a type that no longer exists shouldn't crash the whole operation.
 */
export function buildEntityFromData(gameLoop, saved) {
    const EntityClass = saved.type ? EntityRegistry.get(saved.type) : null;
    if (!EntityClass) {
        console.error(`Saved entity data references unregistered entity type "${saved.type}" - skipping.`);
        return null;
    }
    const entity = new EntityClass();
    entity._sceneKey = saved.sceneKey;
    entity.start(gameLoop.canvas);
    applyEntityData(entity, saved);
    return entity;
}

/** Scene-wide (not per-entity) saved settings - currently just backgroundColor, see serializeScene.
 * The camera needs no entry here at all: it's just a regular entity with a Camera component (see
 * Camera.js/MainCamera.js), so its position and zoom already round-trip through the ordinary
 * per-entity/per-component serialization below like anything else on it would. */
export function applySceneSettings(gameLoop, data) {
    if (data.backgroundColor && gameLoop.scene) {
        gameLoop.scene.backgroundColor = data.backgroundColor;
    }
}

export function serializeScene(gameLoop) {
    const entities = [];
    for (const entity of gameLoop.entities) {
        if (entity.destroyed || !entity._sceneKey) continue;
        entities.push(serializeEntity(entity));
    }
    return {
        version: 3,
        sceneName: gameLoop.scene?.name ?? null,
        // Scene-wide (not any one entity's) - currently just the canvas-clear color, editable from
        // the Inspector's own "Scene" section rather than through create(). Saved here so it
        // round-trips through the level file the same way an entity edit does.
        backgroundColor: gameLoop.scene?.backgroundColor ?? null,
        savedAt: new Date().toISOString(),
        deletedKeys: [...gameLoop.deletedSceneKeys],
        entities,
    };
}

/** Exported (not just used internally by serializeScene below) so anything that needs "this
 * entity, as plain saveable data" can reuse the exact same shape a level file uses - a prefab save,
 * a copy to the in-memory clipboard, or a duplicate (which round-trips it straight back through
 * buildEntityFromData above) all lean on this rather than a second, parallel serialization. */
export function serializeEntity(entity) {
    const t = entity.transform;
    const rb = entity.rigidbody;

    const data = {
        sceneKey: entity._sceneKey,
        tag: entity.tag,
        // The raw override (possibly null - see Entity's `name` getter/setter), not the computed
        // `entity.name` - saving the computed value would freeze it to whatever `tag` happened to
        // be at save time, permanently losing the "no name of its own, just follows tag" default.
        name: entity._name,
        // Only meaningful for runtime-added entities (create() already knows how to build a
        // scene-authored one) - null when the class was never registered, e.g. built inline in a
        // scene file rather than via a reusable class, same caveat as unregistered components.
        type: EntityRegistry.nameOf(entity.constructor),
        // The parent's sceneKey (see Entity#parent) - null for an unparented (or prefab/pasted,
        // where the original parent doesn't exist in the destination) entity. Matched back to an
        // actual entity object by linkParent above, since a saved file only has plain data, never
        // object references.
        parentKey: entity.parent?._sceneKey ?? null,
        transform: {
            position: { x: t.position.x, y: t.position.y },
            rotation: t.rotation,
            size: { x: t.size.x, y: t.size.y },
        },
        // This entity subclass's own tunable settings (Ball's radius, drag/power constants, etc.) -
        // same [{key,label,type}] mechanism as components' `fields` below, just declared on the
        // Entity subclass itself instead (see Entity.js/Inspector.js).
        fields: Object.fromEntries((entity.constructor.fields ?? []).map(f => [f.key, entity[f.key]])),
        // Only components with a registered type name can round-trip (the type name is what lets
        // load() know which class to `new` back up) - an inline/anonymous component would be
        // silently dropped here rather than saved as something that can't be reconstructed.
        components: entity.components
            .map(c => ({
                type: ComponentRegistry.nameOf(c.constructor),
                fields: Object.fromEntries((c.constructor.fields ?? []).map(f => [f.key, c[f.key]])),
            }))
            .filter(c => c.type !== null),
    };

    if (rb) {
        data.rigidbody = {
            velocity: { x: rb.velocity.x, y: rb.velocity.y },
            angularVelocity: rb.angularVelocity,
            mass: rb.mass,
            isStatic: rb.isStatic,
            useGravity: rb.useGravity,
        };
        if (rb.collider) {
            data.collider = { enabled: rb.collider.enabled, isTrigger: rb.collider.isTrigger, isInverse: rb.collider.isInverse };
            // Rectangle PolygonColliders re-derive their shape from transform.size (already saved
            // above) every time start() runs, so they need nothing extra here - but a custom
            // convex shape's vertices ARE the shape, with no other field they could be recomputed
            // from, so an edit to them would otherwise vanish on the next reload.
            if (rb.collider.localVertices) {
                data.collider.vertices = rb.collider.localVertices.map(v => ({ x: v.x, y: v.y }));
            }
        }
    }

    return data;
}

/** Applies previously-saved edits, deletions, and runtime-added entities onto entities GameLoop
 * just built from its Scene. */
export function applySceneData(gameLoop, data) {
    const byKey = new Map(data.entities.map(e => [e.sceneKey, e]));
    const matchedKeys = new Set();
    const pairs = []; // { entity, saved } - for the parent-linking pass below

    for (const entity of gameLoop.entities) {
        const saved = byKey.get(entity._sceneKey);
        if (saved) {
            applyEntityData(entity, saved);
            matchedKeys.add(entity._sceneKey);
            pairs.push({ entity, saved });
        }
    }

    // Anything saved but not matched to an entity create() just built is one that was added at
    // runtime via the Add menu - reconstruct it from its registered type rather than dropping it.
    for (const saved of data.entities) {
        if (matchedKeys.has(saved.sceneKey)) continue;
        const EntityClass = saved.type ? EntityRegistry.get(saved.type) : null;
        if (!EntityClass) continue; // unregistered/renamed type - drop rather than crash

        const entity = new EntityClass();
        entity._sceneKey = saved.sceneKey;
        entity.start(gameLoop.canvas);
        applyEntityData(entity, saved);
        gameLoop.entities.push(entity);
        pairs.push({ entity, saved });
    }

    // A separate pass, after everything above is in gameLoop.entities - same reasoning as
    // buildEntitiesFromLevelData's own linkParent pass (see SceneIO.js's top-level linkParent doc).
    for (const { entity, saved } of pairs) linkParent(entity, saved, gameLoop.entities);

    if (data.deletedKeys) {
        gameLoop.deletedSceneKeys = new Set(data.deletedKeys);
        for (const entity of gameLoop.entities) {
            if (gameLoop.deletedSceneKeys.has(entity._sceneKey)) entity.destroy();
        }
    }

    applySceneSettings(gameLoop, data);
}

function applyEntityData(entity, saved) {
    // An edit to either had never actually round-tripped here (tag) or didn't exist as a separate
    // concept yet (name) - every reload silently reverted a renamed/re-tagged entity back to its
    // class's own default, since nothing wrote `saved.tag`/`saved.name` back onto the entity even
    // though serializeEntity always saved `tag`.
    if (saved.tag) entity.tag = saved.tag;
    // Straight to `_name` (bypassing the trivial setter) so a genuinely-null saved override
    // restores as "no name of its own, just follows tag" rather than being skipped - `saved.name`
    // itself is only ever absent (not null) for a save from before this field existed.
    if (saved.name !== undefined) entity._name = saved.name;

    const t = entity.transform;
    t.position = new Vector2(saved.transform.position.x, saved.transform.position.y);
    t.rotation = saved.transform.rotation;
    t.size = new Vector2(saved.transform.size.x, saved.transform.size.y);

    if (saved.fields) {
        // Object.assign (not a field-by-field loop) so a field with its own getter/setter (e.g.
        // Ball.radius, which also has to update the renderer/collider) goes through that setter
        // instead of silently overwriting just the plain property.
        Object.assign(entity, saved.fields);
    }

    const rb = entity.rigidbody;
    if (rb && saved.rigidbody) {
        rb.velocity = new Vector2(saved.rigidbody.velocity.x, saved.rigidbody.velocity.y);
        rb.angularVelocity = saved.rigidbody.angularVelocity;
        rb.mass = saved.rigidbody.mass;
        rb.isStatic = saved.rigidbody.isStatic;
        rb.useGravity = saved.rigidbody.useGravity;
        if (rb.collider && saved.collider) {
            rb.collider.enabled = saved.collider.enabled;
            rb.collider.isTrigger = saved.collider.isTrigger;
            rb.collider.isInverse = saved.collider.isInverse ?? false; // older saves predate this field
            if (saved.collider.vertices && typeof rb.collider.setVertices === 'function') {
                rb.collider.setVertices(saved.collider.vertices);
            }
        }
    }

    if (saved.components) {
        // Matched against whatever start() already attached (rather than blindly discarding it
        // all and constructing fresh instances) so a component added or removed via the
        // Inspector's +/- since the save is replayed too, not just tweaks to components create()
        // already knew about - while still reusing an existing instance's identity wherever one
        // of the right type already exists. That identity matters: an entity that keeps its own
        // convenience reference to a component it created in start() (e.g. Ball.renderer,
        // Polygon.renderer) would otherwise have that reference silently orphaned the moment a
        // save is applied - it'd keep pointing at the pre-restore instance while a brand new,
        // separately-restored one took its place in entity.components and got drawn instead.
        const remaining = [...entity.components];
        const rebuilt = [];
        for (const c of saved.components) {
            const ComponentClass = ComponentRegistry.get(c.type);
            if (!ComponentClass) continue; // unregistered/renamed type - drop rather than crash

            const existingIndex = remaining.findIndex(existing => existing instanceof ComponentClass);
            const instance = existingIndex !== -1
                ? remaining.splice(existingIndex, 1)[0]
                : entity.addComponent(new ComponentClass());
            Object.assign(instance, c.fields);
            rebuilt.push(instance);
        }
        entity.components = rebuilt;
    }
}
