// Piston Scene view bridge: boots the project's engine in RENDER-ONLY mode (no update/physics) inside the
// editor and answers requests from the Swift editor. It never edits scene data on its own: the editor's
// document is the source of truth, this only mirrors it (PISTON_SPEC.md §4). The running game lives in a
// separate instance (play.html / play.js).

import { BRIDGE_VERSION, post, setupConsoleCapture, loadEngine, setupReceiver } from '/__piston__/common.js';

const params = new URLSearchParams(location.search);
const entryModule = params.get('entry');
setupConsoleCapture('scene');

let engine = null;
let loop = null;
let editCam = null;
let canvas = null;
let view = { x: 400, y: 300, zoom: 1 }; // the EDITOR's camera: world point at viewport centre + CSS zoom

const dpr = () => window.devicePixelRatio || 1;

function sizeCanvas() {
    canvas.width = Math.round(canvas.clientWidth * dpr());
    canvas.height = Math.round(canvas.clientHeight * dpr());
    applyEditorCamera();
}

function applyEditorCamera() {
    if (!editCam) return;
    editCam.transform.position = new engine.Vector2(view.x, view.y);
    editCam.getComponent(engine.Camera).zoom = view.zoom * dpr();
}

function installEditorCamera() {
    editCam = new engine.MainCamera();
    editCam.start(canvas);
    editCam._sceneKey = '__editor_camera__';
    editCam.__editorOnly = true;
    // First in the list, so GameLoop.camera (first entity with a Camera component) is always ours,
    // even if the scene being edited carries its own game Camera entity.
    loop.entities = [editCam, ...loop.entities.filter(e => !e.__editorOnly)];
    applyEditorCamera();
}

async function boot() {
    engine = await loadEngine(params);
    if (entryModule) await import(entryModule); // registers the game's entity/component types

    canvas = document.getElementById('c');
    sizeCanvas();
    loop = new engine.GameLoop(canvas, new engine.Scene({ id: '__edit__', name: 'Edit view', backgroundColor: '#f0f0f0' }), { devTools: false });
    window.Piston = { gameLoop: loop };
    await loop.start(); // playState stays Edit: renders every frame, never updates
    installEditorCamera();
    window.addEventListener('resize', sizeCanvas);
    post({ type: 'ready', from: 'scene', bridge: BRIDGE_VERSION });
}

// ---- Helpers -------------------------------------------------------------------------------------
const liveEntities = () => loop.entities.filter(e => !e.destroyed && !e.__editorOnly);
const byKey = (key) => liveEntities().find(e => e._sceneKey === key);

function summary(e) {
    return {
        key: e._sceneKey,
        tag: e.tag,
        name: e.name,
        type: engine.EntityRegistry.nameOf(e.constructor),
        parentKey: e.parent?._sceneKey ?? null,
    };
}

function boundsOf(e) {
    const t = e.transform;
    const w = t.size?.x ?? 0, h = t.size?.y ?? 0;
    const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    return {
        key: e._sceneKey,
        world: { x: t.position.x, y: t.position.y, w, h, rotation: t.rotation ?? 0 },
        screen: {
            cx: (t.position.x - view.x) * view.zoom + cssW / 2,
            cy: (t.position.y - view.y) * view.zoom + cssH / 2,
            w: w * view.zoom, h: h * view.zoom, rotation: t.rotation ?? 0,
        },
    };
}

function hitTest(x, y) {
    const wx = (x - canvas.clientWidth / 2) / view.zoom + view.x;
    const wy = (y - canvas.clientHeight / 2) / view.zoom + view.y;
    const ordered = liveEntities()
        .map((e, i) => ({ e, i, order: e.getSortingOrder?.() ?? 0 }))
        .sort((a, b) => (b.order - a.order) || (b.i - a.i)); // topmost first
    for (const { e } of ordered) {
        const t = e.transform;
        const w = t.size?.x ?? 0, h = t.size?.y ?? 0;
        if (!w || !h) continue;
        const r = -(t.rotation ?? 0) * Math.PI / 180;
        const dx = wx - t.position.x, dy = wy - t.position.y;
        const lx = dx * Math.cos(r) - dy * Math.sin(r);
        const ly = dx * Math.sin(r) + dy * Math.cos(r);
        if (Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2) return e._sceneKey;
    }
    return null;
}

// Timeline scrubbing: shows a clip at time `t` on the entity WITHOUT touching the document. The first preview
// remembers each animated property's real value so endPreview puts it back exactly.
let preview = null; // { key, originals: { path: value } }
function endPreview() {
    if (!preview) return;
    const e = byKey(preview.key);
    if (e) engine.Tracks.applyValues(e, preview.originals);
    preview = null;
}

const fieldsOf = (C) => (C.fields ?? []).map(f => ({ ...f }));

// ---- Request handlers ----------------------------------------------------------------------------
setupReceiver({
    ping: () => 'pong',

    loadScene({ data }) {
        preview = null; // the entities it referred to are gone
        const entities = engine.SceneIO.buildEntitiesFromLevelData(loop, data);
        entities.forEach((e, i) => { if (!e._sceneKey) e._sceneKey = `${e.tag}#${i}`; });
        loop.entities = entities;
        installEditorCamera();
        return { entities: entities.map(summary) };
    },

    getEntities: () => ({ entities: liveEntities().map(summary) }),

    // Discovered from the registries, not hand-written: the editor builds its Inspector from this.
    getSchemas() {
        return {
            bridge: BRIDGE_VERSION,
            entities: engine.EntityRegistry.entries.map(e => ({ name: e.name, group: e.group, description: e.EntityClass.description ?? '', fields: fieldsOf(e.EntityClass) })),
            components: engine.ComponentRegistry.entries.map(c => ({ name: c.name, category: c.category, description: c.ComponentClass.description ?? '', fields: fieldsOf(c.ComponentClass) })),
        };
    },

    // Builds a new entity of a registered type, exactly as the Add menu does, and returns its saved form so the
    // editor's document gets the runtime's own defaults (sizes, components) instead of guessing them.
    createEntity({ entityType, x, y }) {
        // NOTE: not named `type`: that key carries the request name in every bridge message.
        const EntityClass = engine.EntityRegistry.get(entityType);
        if (!EntityClass) throw new Error(`Unknown entity type: ${entityType}`);
        const entity = new EntityClass();
        entity._sceneKey = `added:${entity.id}`;
        entity.start(canvas);
        entity.transform.position.x = x;
        entity.transform.position.y = y;
        loop.entities.push(entity);
        return engine.SceneIO.serializeEntity(entity);
    },

    // Copy of an entity (components, fields, transform) offset a little so it doesn't hide the original.
    duplicateEntity({ key }) {
        const src = byKey(key);
        if (!src) throw new Error(`No entity ${key}`);
        const saved = engine.SceneIO.serializeEntity(src);
        saved.sceneKey = `added:dup:${Math.random().toString(36).slice(2, 10)}`;
        saved.transform.position.x += 24;
        saved.transform.position.y += 24;
        const copy = engine.SceneIO.buildEntityFromData(loop, saved);
        if (!copy) throw new Error('Entity type is not registered');
        loop.entities.push(copy);
        return engine.SceneIO.serializeEntity(copy);
    },

    getEntityData({ key }) {
        const e = byKey(key);
        return e ? engine.SceneIO.serializeEntity(e) : null;
    },

    getBounds({ keys }) {
        return { bounds: keys.map(byKey).filter(Boolean).map(boundsOf) };
    },

    hitTest: ({ x, y }) => ({ key: hitTest(x, y) }),

    // Union of every WORLD-space entity's extent (polygon vertices when it has them, else its size
    // box), so the editor can frame the scene. HUD (Screen space) and cameras don't count.
    getSceneBounds() {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const add = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
        for (const e of liveEntities()) {
            if ((e.space ?? 'World') !== 'World' || e.tag === 'MainCamera' || e.getComponent(engine.Camera)) continue;
            const t = e.transform;
            const r = (t.rotation ?? 0) * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r);
            const poly = e.components.find(k => Array.isArray(k.vertices) && k.vertices.length);
            const local = poly
                ? poly.vertices.map(v => [v.x, v.y])
                : [[-(t.size?.x ?? 0) / 2, -(t.size?.y ?? 0) / 2], [(t.size?.x ?? 0) / 2, (t.size?.y ?? 0) / 2]];
            for (const [lx, ly] of local) add(t.position.x + lx * c - ly * sn, t.position.y + lx * sn + ly * c);
        }
        return minX === Infinity ? { empty: true } : { empty: false, minX, minY, maxX, maxY };
    },

    setEditorCamera({ x, y, zoom }) {
        view = { x, y, zoom };
        applyEditorCamera();
        return true;
    },

    // What the Animation panel can keyframe on this entity, with current (real, not previewed) values.
    animationProperties({ key }) {
        endPreview();
        const e = byKey(key);
        return { properties: e ? engine.Tracks.listProperties(e) : [] };
    },

    previewAnimation({ key, clip, time }) {
        const e = byKey(key);
        if (!e) return false;
        if (preview && preview.key !== key) endPreview();
        preview ??= { key, originals: {} };
        for (const track of clip.tracks ?? []) {
            if (!(track.path in preview.originals)) preview.originals[track.path] = engine.Tracks.readProperty(e, track.path);
        }
        engine.Tracks.applyValues(e, engine.Tracks.sampleClip(clip, time));
        return true;
    },

    // Checks scene data against the engine contract (EditorDocs/13-engine-contract.md): { errors, warnings }, each { entity, path, message }.
    validateScene({ data }) {
        const schemas = {
            entities: engine.EntityRegistry.entries.map(e => ({ name: e.name, fields: fieldsOf(e.EntityClass) })),
            components: engine.ComponentRegistry.entries.map(c => ({ name: c.name, fields: fieldsOf(c.ComponentClass) })),
        };
        return engine.validateScene(data, schemas);
    },

    // Pure: every track of a clip sampled at a time (no entity needed). Used to seed new keys with the curve's own value.
    sampleAnimation({ clip, time }) { return { values: engine.Tracks.sampleClip(clip, time) }; },

    endPreview() { endPreview(); return true; },

    applyPatch({ ops }) {
        endPreview();
        for (const op of ops) {
            const e = byKey(op.key);
            if (!e) continue;
            if (op.op === 'setTransform') {
                const t = e.transform;
                if (op.x !== undefined) t.position.x = op.x;
                if (op.y !== undefined) t.position.y = op.y;
                if (op.rotation !== undefined) t.rotation = op.rotation;
                if (op.w !== undefined) t.size.x = op.w;
                if (op.h !== undefined) t.size.y = op.h;
            } else if (op.op === 'setField') {
                e[op.field] = op.value;
            } else if (op.op === 'removeEntity') {
                e.destroy();
            }
        }
        loop.entities = loop.entities.filter(e => !e.destroyed);
        return true;
    },

    // Component edits. `index` is the position in entity.components, which matches the saved `components`
    // array only for registered types (the same filter serializeEntity applies), so we resolve against that.
    // Always returns the entity's saved components so the editor mirrors the runtime's own defaults.
    editComponent({ key, action, componentType, index, field, value }) {
        endPreview();
        const e = byKey(key);
        if (!e) throw new Error(`No entity ${key}`);
        const registered = () => e.components.filter(c => engine.ComponentRegistry.nameOf(c.constructor) !== null);
        if (action === 'add') {
            const C = engine.ComponentRegistry.get(componentType);
            if (!C) throw new Error(`Unknown component type: ${componentType}`);
            e.addComponent(new C());
        } else if (action === 'remove') {
            const c = registered()[index];
            if (c) e.components = e.components.filter(x => x !== c);
        } else if (action === 'setField') {
            const c = registered()[index];
            if (c) c[field] = value;
        }
        return { components: engine.SceneIO.serializeEntity(e).components };
    },

    setDebugFlags({ colliders }) {
        if (colliders !== undefined) engine.Debug.showColliders = !!colliders;
        return true;
    },

    getGameCameras() {
        return {
            cameras: liveEntities()
                .filter(e => e.getComponent(engine.Camera))
                .map(e => ({ key: e._sceneKey, x: e.transform.position.x, y: e.transform.position.y, zoom: e.getComponent(engine.Camera).zoom })),
        };
    },

    emitTestLog: ({ text }) => { console.warn(text); return true; },
});

boot().catch((error) => post({ type: 'error', from: 'scene', message: `Boot failed: ${error?.message ?? error}`, fatal: true }));
