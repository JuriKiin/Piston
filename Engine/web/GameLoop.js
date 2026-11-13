import { Entity } from "./Entity.js";
import { Camera } from "./Camera.js";
import { MainCamera } from "./MainCamera.js";
import { InputController } from "./Input/InputController.js";
import { SpatialGrid } from "./Physics/Colliders/SpacialGrid.js";
import Constants from "./static/Constants.js";
import { PhysicsEngine } from "./Physics/PhysicsEngine.js";
import { FixedStep } from "./FixedStep.js";
import { PlayState } from "./PlayState.js";
import { DevToolbar } from "./Debug/DevToolbar.js";
import { Vector2 } from "./Physics/Vector2.js";
import input from "./static/Input.js";
import { serializeScene, serializeEntity, applySceneData, buildEntitiesFromLevelData, buildEntityFromData, linkParent, levelPath } from "./SceneIO.js";
import { PrefabRegistry } from "./PrefabRegistry.js";
import { getHandle as getSavedFileHandle, setHandle as setSavedFileHandle } from "./FileHandleStore.js";
import { setLastSceneId } from "./LastSceneStore.js";
// Both register themselves (with EntityRegistry/ComponentRegistry respectively) on load - neither
// is scene-specific the way Wall/Ball/ShapeRenderer/etc are, which only register because the
// active scene happens to import them, so each needs an always-loaded anchor to import it for
// that side effect. GameLoop is instantiated regardless of which scene is active, so it's as good
// a place as any - without this, SceneIO would silently drop a SpriteRenderer on save (an
// unregistered component's type comes back null, which serializeEntity treats as "can't be
// reconstructed" and filters out), the same way a Polygon entity wouldn't survive a reload before.
import "./Polygon.js";
import "./SpriteRenderer.js";
import "./SpriteAnimator.js";
import "./Animator.js";
import "./ParticleEmitter.js";
import "./CollisionLayerComponent.js";
import { SceneManager } from "./SceneManager.js";
import "./Audio/AudioSource.js";
import { audio } from "./Audio/AudioService.js";
import { SceneRegistry } from "./SceneRegistry.js";
import "./PhysicsMaterialComponent.js";
import "./TrailRenderer.js";
import "./BeamRenderer.js";
import { PostProcess } from "./PostProcess.js";
import { Light2D } from "./Light2D.js";
import "./LevelFlow.js";
import "./UIElement.js";
import "./UI/Text.js";
import "./UI/Button.js";
import "./UI/UIContainer.js";
import "./Audio/AudioSource.js";
import "./Input/InputBindingLayer.js";
import "./Empty.js";

const DRAFT_INTERVAL_MS = 60000;

/**
 * The main game loop responsible for updating and rendering entities,
 * and handling the physics simulation including collision detection and resolution.
 */
export default class GameLoop {

    /**
     * @param {HTMLCanvasElement} canvas
     * @param {import('./Scene.js').Scene} scene
     * @param {object} [options]
     * @param {boolean} [options.devTools=true] Set false to omit the Play/Pause/Stop toolbar
     *   and the `window.Piston` bridge the Inspector popup relies on (e.g. for a shipped build).
     * @param {number} [options.fixedHz=60] Simulation steps per second (see `fixedHz`).
     */
    constructor(canvas, scene, options = {}) {
        this.canvas = canvas;
        this.ctx = this.canvas.getContext('2d');
        this.scene = scene;
        SceneRegistry.syncFromProject(); // the project's scene files are the source of truth for which scenes exist
        this.audio = audio; // platform service: Piston.audio.play(path, { bus, volume, pitch })
        audio.installAutoUnlock();
        this.scenes = new SceneManager(this); // scene flow: Piston.scenes.next() / load(id) / restart()
        this.entities = [];
        this.spatialGrid = new SpatialGrid(canvas.width, canvas.height, 128, false, this.ctx); // 128 px cells. Was 10000 (one cell for the whole world = O(n^2) broadphase) with debug-grid drawing always on.
        this.lastTime = null;
        this.physicsEngine = new PhysicsEngine(this.spatialGrid);

        // Multiplies the simulated time of every step (DELTA_TIME): 1 = normal, 0 = frozen (hit-stop), 0.3 = slow motion. Animators, particles and trails follow it;
        // rigidbody velocities are per-step (a "pixels per frame" value means pixels per fixed step), so physics bodies are not scaled by it. Reset to 1 whenever a scene loads.
        this.timeScale = 1;

        // The simulation runs in fixed steps (default 60 per second) driven by an accumulator, so game speed does not depend on the display refresh rate.
        // Rendering still happens once per display frame. `simSteps` counts the steps run while Playing (the editor's Step button advances it by exactly one).
        this.stepper = new FixedStep({ hz: options.fixedHz ?? 60 });
        this.simSteps = 0;
        this.stepCostMs = 0; // smoothed wall-clock cost of one simulation step; limits catch-up (see update())
        // Bumped whenever the entity list is rebuilt wholesale (scene load, Stop's restore): anything holding entities across that (EntityPool) must forget them.
        this.generation = 0;

        this.playState = PlayState.Edit;
        this._editSnapshot = null;
        // The Scene that was active when Play was pressed (set in play(), only on the Edit->Playing
        // transition) - a level transition mid-Play (see Hole#onSunk -> loadScene) moves `this.scene`
        // on without touching this, so Stop can always find its way back to where testing started
        // even after several transitions, instead of leaving you stranded in Edit on whatever hole
        // you happened to be standing on when you hit Stop.
        this._playStartScene = null;
        // sceneKey ("Tag#N", by creation order) of every entity deliberately removed in Edit -
        // Play-mode destruction (a ball sinking, a lifetime expiring) is transient and already
        // reverted by Stop's snapshot, so it's excluded; this is only for edits meant to stick.
        this.deletedSceneKeys = new Set();

        input.setCanvas(canvas);

        if (options.devTools !== false) {
            this.devToolbar = new DevToolbar(this);
        }
    }

    /**
     * The active camera, or null if the scene genuinely has none (mid-load, or every camera
     * entity was deleted) - whichever live entity happens to carry a Camera component, found by a
     * plain scan rather than tracked as its own field. That's what lets a Camera be "just a
     * component" (see Camera.js's own doc comment): nothing here hardcodes which entity that is,
     * so a custom camera behavior is just a different entity with a Camera component on it, same
     * as swapping out any other component. Entity/component counts are small enough (tens, not
     * thousands) that a fresh scan on every access is simpler than caching one with invalidation
     * to keep in sync, for a genuinely negligible cost.
     */
    get camera() {
        for (const entity of this.entities) {
            if (entity.destroyed || entity.active === false) continue;
            const camera = entity.getComponent(Camera);
            if (camera) return camera;
        }
        return null;
    }

    /**
     * The active InputController, or null - the same "just scan for the component" pattern as
     * `camera` above (see its own doc comment), and deliberately NOT auto-injected the way
     * MainCamera is: not every game needs named input actions, so this stays null (game code that
     * wants one just adds an InputBindingLayer via the Add menu) rather than every scene silently
     * growing one it never asked for.
     */
    get input() {
        for (const entity of this.entities) {
            if (entity.destroyed || entity.active === false) continue;
            const controller = entity.getComponent(InputController);
            if (controller) return controller;
        }
        return null;
    }

    /**
     * Every scene needs a working default view, but nothing should have to hand-author a camera
     * entity into every level file just to get one - so if #loadLevel just built a scene with no
     * Camera-component entity anywhere in it, one is added here, positioned so world (0,0) sits at
     * the canvas's own top-left corner at 1:1 scale: pixel-for-pixel what rendering looked like
     * before cameras existed at all, so every pre-existing level file keeps rendering exactly
     * where it always did without needing a single position changed. Once it's been panned/zoomed
     * and Saved, it round-trips through the level file like any other entity from then on (see
     * MainCamera.js) - this only ever fires for a scene that's never had one.
     */
    #ensureCamera() {
        if (this.camera) return;
        this.addEntityFromRegistry(MainCamera); // already positions it at the canvas center
    }

    /**
     * Starts the game loop. Entities load (from the scene's level file, or its create() bootstrap
     * default - see #loadLevel) before the first frame, and render every frame, but simulation
     * (update()/physics) stays frozen in Edit mode until play() is called.
     */
    async start() {
        await this.#loadLevel();

        this.lastTime = performance.now();

        const loop = () => {
            this.update();
            requestAnimationFrame(loop);
        };

        requestAnimationFrame(loop);
        setInterval(() => this.#draftTick(), DRAFT_INTERVAL_MS);
    }

    /**
     * Switches the running page to a different Scene without a page reload - used both by the top
     * bar's File menu (New Scene, switching to any other registered one) and by game code doing a
     * level transition mid-Play (see Hole#onSunk). Tears down whatever the current scene left
     * behind (its entities, any Play/Stop snapshot, the Inspector's selection - all of which belong
     * to the scene being left) and boots the new one exactly the way start() boots the very first
     * one.
     *
     * Resumes in whatever state it was called from rather than always dropping to Edit: a level
     * transition during Play is the game continuing, not the game stopping, so it plays on
     * straight into the new scene's freshly-loaded entities (with a fresh snapshot taken for them,
     * so Stop afterwards still reverts to how *this* scene loaded, not the previous one's state).
     * Called from the editor's File menu, playState is already Edit, so this is a no-op there and
     * behavior is unchanged.
     */
    async loadScene(scene) {
        const resumeState = this.playState;

        this.scene = scene;
        this.timeScale = 1; // a new scene never starts frozen or in slow motion
        setLastSceneId(scene.id); // so a page refresh resumes here instead of main.js's hardcoded default
        this.stepper.reset();
        this.entities = [];
        this.generation++;
        this.playState = PlayState.Edit;
        this._editSnapshot = null;
        this.deletedSceneKeys = new Set();

        const inspector = this.devToolbar?.inspector;
        if (inspector) {
            inspector.select(null);
            inspector.editingVerticesFor = null;
        }

        await this.#loadLevel();

        if (resumeState !== PlayState.Edit) {
            this._editSnapshot = this.captureSnapshot();
            this.playState = resumeState;
        }
    }

    /**
     * Fetches this scene's canonical level file (js/game/scenes/<scene.id>.json) and rebuilds every
     * entity from it - the file is the source of truth once one exists (see SceneIO.js's top
     * comment). Falls back to the scene's own create() factory only when there's no file yet (a
     * brand new scene) or the fetch/parse fails for some other reason, so a typo'd id or a network
     * hiccup degrades to *something playable* rather than a blank scene.
     */
    async #loadLevel() {
        // Release builds compile scene data into the bundle (globalThis.__PISTON_DATA__); there is no file to fetch.
        const inlined = globalThis.__PISTON_DATA__?.scenes?.[this.scene?.id];
        if (inlined) {
            this.replaceEntitiesFromData(inlined);
            this.deletedSceneKeys = new Set(inlined.deletedKeys ?? []);
            this.loadedFromFile = true;
            this.#ensureCamera();
            return;
        }
        try {
            const res = await fetch(levelPath(this.scene));
            if (res.ok) {
                const data = await res.json();
                this.replaceEntitiesFromData(data);
                this.deletedSceneKeys = new Set(data.deletedKeys ?? []);
                this.loadedFromFile = true;
                this.#ensureCamera();
                return;
            }
        } catch (e) {
            console.error(`Failed to load level file for "${this.scene?.name}" - falling back to its create() defaults:`, e);
        }
        this.#instantiateScene();
        this.loadedFromFile = false;
        this.#ensureCamera();
    }

    /**
     * Replaces the entity list with the entities saved in `data` (a level file's contents) and returns it. While the scene is being built the
     * live list is an empty sink, so an entity that spawns more entities from its own start() (`loop.entities.push(...)`, `loop.add(...)`) is
     * kept: those land after the saved entities. Before this, such entities were pushed onto the list that was about to be replaced and silently lost.
     */
    replaceEntitiesFromData(data) {
        const spawned = [];
        this.entities = spawned;
        let built;
        try {
            built = buildEntitiesFromLevelData(this, data);
        } catch (e) {
            this.entities = spawned; // keep whatever was spawned; the caller sees the error
            throw e;
        }
        this.entities = built.concat(spawned.filter(e => !built.includes(e)));
        this.generation++;
        return this.entities;
    }

    #instantiateScene() {
        this.entities = this.scene.instantiate(this.canvas);
        this.generation++;
        // Assigned once, right here, rather than recomputed from array position later - that stays
        // correct even after entities are deleted or reordered, since it's fixed at creation time.
        const tagCounts = new Map();
        this.entities.forEach(entity => {
            if (!(entity instanceof Entity)) return;
            const index = tagCounts.get(entity.tag) ?? 0;
            tagCounts.set(entity.tag, index + 1);
            // An entity built by scene code normally gets "Tag#N" by creation order; setting `sceneId` in its constructor pins a
            // permanent key instead, so reordering or inserting entities in create() can't shuffle which saved data it matches.
            entity._sceneKey = entity.sceneId ?? `${entity.tag}#${index}`;
            entity.start(this.canvas);
        });
    }

    #draftKey() {
        return `piston:draft:${this.scene?.id ?? this.scene?.name ?? 'default'}`;
    }

    /** Edits (Inspector tweaks, dragged positions) auto-persist to localStorage every few seconds
     * while not Playing, so a page refresh mid-edit doesn't silently discard them - Playing is
     * excluded since that's live simulation churn, not an edit worth remembering. Unlike the old
     * autosave this replaced, this is never applied automatically (see SceneIO.js's top comment for
     * why that was a problem) - it just sits there until restoreDraft() is explicitly called. */
    #draftTick() {
        if (this.playState === PlayState.Playing) return;
        try {
            localStorage.setItem(this.#draftKey(), JSON.stringify(serializeScene(this)));
            this.lastAutosaveAt = new Date();
        } catch (e) {
            console.error('Draft save failed:', e);
        }
    }

    /** Whether an unsaved draft exists for this scene - lets the File menu only offer to restore
     * one when there's actually something to restore. */
    hasDraft() {
        try {
            return !!localStorage.getItem(this.#draftKey());
        } catch (e) {
            return false;
        }
    }

    /** Explicitly, on request only, overlays the last draft onto whatever's currently loaded (a
     * diff via applySceneData, same as the old automatic behavior - just no longer automatic). For
     * recovering from an accidental reload/crash right after editing but before saving. */
    restoreDraft() {
        let raw;
        try {
            raw = localStorage.getItem(this.#draftKey());
        } catch (e) {
            console.error('Draft read failed:', e);
            return;
        }
        if (!raw) return;
        try {
            applySceneData(this, JSON.parse(raw));
        } catch (e) {
            console.error('Failed to apply draft - it may be from an older, incompatible version:', e);
        }
    }

    #discardDraft() {
        try {
            localStorage.removeItem(this.#draftKey());
        } catch (e) { /* ignore - nothing to discard if storage is unavailable */ }
    }

    /**
     * Writes the current state directly to this scene's canonical level file - the actual save, not
     * a copy of one: the exact file #loadLevel fetches every time the page loads gets overwritten in
     * place. Three tiers, each only tried if the previous one isn't available:
     *
     *  1. A PUT to the dev server (see dev_server.py) - silent, no prompt, the normal path whenever
     *     the page is served through that script.
     *  2. A "Save As" dialog (File System Access API), defaulting to this exact file's name -
     *     for a plain static server (a different port, no PUT support) that can't take writes at
     *     all. The chosen location is remembered (see FileHandleStore.js) so this only prompts
     *     once per scene, ever, in a given browser - every save after the first is silent again,
     *     the same as tier 1. Not "the folder we desire" *by default* on the very first save
     *     (browsers won't let a page force-set a starting directory, for obvious security reasons)
     *     - but it does suggest the right filename, and browsers generally remember whatever
     *     directory you last saved a file into and reopen there next time, so pointing it at
     *     js/game/scenes/ once tends to stick for future new-scene saves too.
     *  3. A plain browser download, landing whereever the browser's own downloads go - only if
     *     neither of the above worked (an older browser with no File System Access API, or the
     *     picker was denied outright, not just cancelled).
     */
    async saveSceneToFile() {
        const data = serializeScene(this);
        const json = JSON.stringify(data, null, 2);
        const path = levelPath(this.scene);
        const filename = path.split('/').pop();

        try {
            const res = await fetch(path, { method: 'PUT', body: json });
            if (!res.ok) throw new Error(`PUT ${path} -> HTTP ${res.status}`);
            this.#discardDraft();
            this.lastSavedAt = new Date();
            return;
        } catch (e) {
            // Expected whenever the page isn't served through dev_server.py (e.g. VS Code's Live
            // Server on 5500, which has no PUT support and 405s) - not a real error, just this
            // scene's first save falling through to the Save As tier below.
            console.info(`Direct save to ${path} isn't available here (${e.message}) - falling back to a Save As dialog.`);
        }

        if (window.showSaveFilePicker) {
            try {
                const handle = await this.#getSaveHandle(filename);
                const writable = await handle.createWritable();
                await writable.write(json);
                await writable.close();
                this.#discardDraft();
                this.lastSavedAt = new Date();
                return;
            } catch (e) {
                if (e?.name === 'AbortError') return; // the user cancelled the picker - not a failure
                console.error('Save As failed - falling back to a plain download:', e);
            }
        }

        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        this.#discardDraft();
    }

    /** A FileSystemFileHandle for this scene's save-as destination - reused (after confirming
     * permission is still granted) if one was already picked, otherwise prompts once via the native
     * picker and remembers the choice for next time. */
    async #getSaveHandle(filename) {
        const key = `scene:${this.scene.id}`;
        const existing = await getSavedFileHandle(key);
        if (existing) {
            const granted = 'granted';
            const permission = (await existing.queryPermission?.({ mode: 'readwrite' }))
                ?? (await existing.requestPermission?.({ mode: 'readwrite' }));
            if (permission === granted) return existing;
        }

        const handle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: 'Piston level file', accept: { 'application/json': ['.json'] } }],
        });
        await setSavedFileHandle(key, handle);
        return handle;
    }

    /** Loads a chosen .json file as this scene's entities outright - a full rebuild, the same as
     * what #loadLevel does at boot, not a diff onto what's currently there. For pulling in a level
     * file you didn't just fetch automatically (one shared by someone else, an older export). */
    async loadSceneFromFile(file) {
        const text = await file.text();
        const data = JSON.parse(text);
        this.replaceEntitiesFromData(data);
        this.deletedSceneKeys = new Set(data.deletedKeys ?? []);
        this.#discardDraft();
    }

    /**
     * Adds an entity to the running scene from the top bar's Add menu (constructed with no
     * arguments - see EntityRegistry). Dropped at the center of the current view so it's
     * immediately visible, and given a stable key so it persists across a reload like any other
     * scene-authored entity, rather than vanishing the moment the page refreshes.
     */
    addEntityFromRegistry(EntityClass) {
        const entity = new EntityClass();
        entity._sceneKey = `added:${entity.id}`;
        entity.start(this.canvas);
        entity.transform.position.x = this.canvas.width / 2;
        entity.transform.position.y = this.canvas.height / 2;
        this.entities.push(entity);
        return entity;
    }

    /** Drops an instance of a saved prefab (see PrefabRegistry.js) into the running scene, at the
     * center of the current view - same placement convention as addEntityFromRegistry above, just
     * built from saved data (SceneIO.buildEntityFromData) instead of a bare `new EntityClass()`. */
    async addPrefabInstance(prefabId) {
        const data = await PrefabRegistry.getData(prefabId);
        return this.#spawnFromData(data, { x: this.canvas.width / 2, y: this.canvas.height / 2 });
    }

    /** A copy of `entity`, offset slightly so it doesn't land exactly on top of the original -
     * round-trips through the same serialize/build pair a save/load does (see SceneIO.js), so
     * whatever's on the original (components, field edits, a custom polygon shape) comes along too. */
    duplicateEntity(entity) {
        const data = serializeEntity(entity);
        return this.#spawnFromData(data, { x: entity.transform.position.x + 24, y: entity.transform.position.y + 24 });
    }

    /** Rebuilds an entity from a previously-copied data blob (see Inspector's Cmd/Ctrl+C) - offset
     * the same way duplicateEntity is, since a paste with no cursor context to place it at has the
     * same "don't land exactly on top of something" problem a duplicate does. */
    pasteEntityData(data) {
        return this.#spawnFromData(data, { x: data.transform.position.x + 24, y: data.transform.position.y + 24 });
    }

    /** Shared by addPrefabInstance/duplicateEntity/pasteEntityData above: build a live entity from
     * saved data, give it a fresh runtime-added scene key (so it persists across a reload like any
     * other Add-menu entity), and drop it at `position`. */
    #spawnFromData(data, position) {
        const entity = buildEntityFromData(this, data);
        if (!entity) return null;
        // Before the sceneKey gets overwritten below - a duplicated/pasted CHILD should stay under
        // its original parent if that parent is still live in this same scene (the common case:
        // duplicating one member of a group), so this has to match against `data.parentKey` (the
        // original sceneKey) while it's still meaningful. A prefab's parentKey almost never matches
        // anything here (it names an entity from whatever scene the prefab was originally saved
        // from) - linkParent already no-ops safely when nothing matches.
        linkParent(entity, data, this.entities);
        entity._sceneKey = `added:${entity.id}`;
        entity.transform.position.x = position.x;
        entity.transform.position.y = position.y;
        this.entities.push(entity);
        return entity;
    }

    /** Discards this session's in-memory edits and reloads straight from the canonical level file
     * (or the create() bootstrap default, if this scene doesn't have one yet) - "Reset" now means
     * "back to what's actually saved," since that file, not browser storage, is the source of
     * truth (see SceneIO.js's top comment). Safe to click without fear of losing anything that was
     * ever actually saved - only unsaved in-session edits and any pending draft are discarded. */
    async revertToSavedLevel() {
        this.#discardDraft();
        this.deletedSceneKeys = new Set();
        await this.#loadLevel();
        this.playState = PlayState.Edit;
        this._editSnapshot = null;
        this._playStartScene = null;
    }

    /** Enters Playing state. Snapshots current entity state first if coming from Edit (not Paused),
     * and immediately persists that same state as a draft - otherwise it only lives in memory until
     * the next periodic tick (DRAFT_INTERVAL_MS away), and a reload or crash before then would lose
     * it entirely (the draft is a recovery copy, not the real save - see restoreDraft/saveSceneToFile).
     * The camera needs no special handling here: it's just another entity in this.entities, so
     * #captureSnapshot already includes its position (Entity.captureEditState) and zoom
     * (Camera.captureState) the same as anything else on it - panning around, or a Camera.follow()
     * tracking the ball, during Play reverts on Stop below without this needing to know that. */
    play() {
        if (this.playState === PlayState.Edit) {
            this._editSnapshot = this.captureSnapshot();
            this._playStartScene = this.scene;
            this.#draftTick();
        }
        this.playState = PlayState.Playing;
    }

    /** Freezes simulation without losing state - play() resumes rather than re-snapshotting. */
    pause() {
        if (this.playState === PlayState.Playing) {
            this.playState = PlayState.Paused;
        }
    }

    /**
     * Freezes simulation and returns to Edit. If a level transition happened during this Play
     * session (see loadScene), `this.scene` is no longer the one Play started on, and there's no
     * in-memory snapshot of *that* scene left to restore (loadScene replaced it with a fresh one
     * for wherever Play ended up) - so instead of leaving the editor stuck on whatever hole you
     * happened to be standing on, this reloads the original scene from its saved level file, the
     * same way switching scenes from the File menu does. No transition at all (the common case,
     * testing one scene start to finish) just restores the in-memory snapshot in place as before -
     * cheaper, and preserves any unsaved edits made right before pressing Play.
     */
    async stop() {
        const startScene = this._playStartScene;
        this._playStartScene = null;
        this.playState = PlayState.Edit;

        if (startScene && startScene !== this.scene) {
            this._editSnapshot = null;
            await this.loadScene(startScene); // reads the now-Edit playState above, so this won't resume Play
            return;
        }

        if (this._editSnapshot) {
            this.restoreSnapshot(this._editSnapshot);
            this._editSnapshot = null;
        }
    }

    /** A full record of every current entity's live/destroyed state and edit-state (transform,
     * rigidbody, components), plus `deletedSceneKeys` - restoreSnapshot below is the exact inverse.
     * Originally only used for this file's own Play<->Stop revert; now public because the
     * Inspector's undo/redo (see Debug/UndoStack.js) reuses the exact same mechanism rather than a
     * second, parallel one - "undo" and "stop reverting a Play session" are really the same
     * operation (go back to a recorded state), just triggered from different places.
     * `deletedSceneKeys` has to be included too, not just each entity's own destroyed flag: it's
     * separate, longer-lived bookkeeping (see its own field doc above) that a plain entity-list
     * snapshot wouldn't touch - without capturing/restoring it here as well, undoing a delete would
     * bring the entity back but leave its key stuck in deletedSceneKeys forever, quietly bloating
     * the next real Save with a phantom deleted-key entry for something that's actually still there. */
    captureSnapshot() {
        return {
            entities: this.entities.map(entity => ({
                entity,
                wasDestroyed: entity.destroyed,
                state: entity.captureEditState(),
            })),
            deletedSceneKeys: new Set(this.deletedSceneKeys),
        };
    }

    restoreSnapshot(snapshot) {
        // Entities created after the snapshot was taken (Play-mode instantiation, or an Add/
        // duplicate/paste since an undo point - see UndoStack.js) aren't in it, so this also drops
        // them - matching Unity's "anything created in Play mode disappears on Stop" behavior, and
        // giving undo a "remove what was added" effect for free with no separate bookkeeping.
        this.entities = snapshot.entities.map(({ entity, wasDestroyed, state }) => {
            entity.destroyed = wasDestroyed;
            entity.restoreEditState(state);
            return entity;
        });
        this.deletedSceneKeys = new Set(snapshot.deletedSceneKeys);
        this.generation++;
    }

    /** Simulation steps per second. Setting it changes the step length (`fixedDelta`); every `Constants.DELTA_TIME` the game reads is one step. Default 60. */
    get fixedHz() { return this.stepper.hz; }
    set fixedHz(hz) { this.stepper.setRate(hz); }

    /** Length of one simulation step in seconds (1 / fixedHz), before `timeScale`. */
    get fixedDelta() { return this.stepper.step; }

    /** Removes entities destroyed since the last sweep and refreshes the active-collider list. Deferred (rather than done in destroy()) so destroy() is safe mid-iteration, e.g. from a collision callback. */
    #sweep(recordDeletions) {
        if (this.entities.some(e => e.destroyed)) {
            // A deletion made in Edit (Inspector's Delete Entity, the Delete key) is meant to stick; one that happens during Play (a ball sinking,
            // a lifetime running out) is transient simulation state that Stop() already reverts, so it's deliberately not recorded.
            if (recordDeletions) {
                for (const e of this.entities) {
                    if (e.destroyed && e._sceneKey) this.deletedSceneKeys.add(e._sceneKey);
                }
            }
            this.entities = this.entities.filter(e => !e.destroyed);
        }
        this.activeColliders = this.entities.filter(e => e.active !== false && e.rigidbody && e.rigidbody.collider && e.rigidbody.collider.enabled);
    }

    /** One fixed simulation step: update every entity, resolve collisions, settle rest state. `DELTA_TIME` is the step length times `timeScale`. */
    #simulate() {
        Constants.DELTA_TIME = this.fixedDelta * Math.max(0, this.timeScale);
        this.#sweep(false);

        if (this.activeColliders.length > 0) {
            this.spatialGrid.update(this.activeColliders);
        }

        for (const entity of this.entities) {
            if (entity instanceof Entity && entity.active !== false) {
                entity.update();
            }
        }

        this.physicsEngine.handleCollisions(this.activeColliders);

        for (const entity of this.entities) {
            if (entity.active !== false) entity.rigidbody?.updateRestState();
        }

        this.simSteps++;
        input.endStep();
    }

    /** #simulate() timed, feeding `stepCostMs` (a smoothed average). */
    #timedSimulate() {
        const t0 = performance.now();
        this.#simulate();
        const cost = performance.now() - t0;
        this.stepCostMs = this.stepCostMs === 0 ? cost : this.stepCostMs * 0.8 + cost * 0.2;
    }

    /**
     * Advances the simulation by exactly one fixed step and redraws, regardless of the play state: what the editor's Step button uses, so it
     * moves the world by one step (1/60 s by default) instead of by however long the last display frame happened to take.
     */
    stepOnce() {
        this.stepper.reset();
        this.lastTime = performance.now();
        this.#simulate();
        this.#render();
    }

    /** One display frame: runs however many fixed steps the elapsed real time owes (while Playing), then renders once. */
    update(nowMs = performance.now()) {
        // --- Time Management ---
        if (!this.lastTime) this.lastTime = nowMs;
        const rawDeltaTime = (nowMs - this.lastTime) / 1000;
        this.lastTime = nowMs;

        const isPlaying = this.playState === PlayState.Playing;
        // DELTA_TIME is 0 while not playing so anything reading it during Edit/Paused sees no elapsed time.
        Constants.DELTA_TIME = isPlaying ? this.fixedDelta * Math.max(0, this.timeScale) : 0;

        if (isPlaying) {
            // Catching up after a hitch is only worth it while steps are cheap: allow as many extra steps as fit in one step's length of wall-clock time.
            // When a single step costs as much as the step itself (a very heavy scene), the game slows down instead of spiralling into longer and longer frames.
            this.stepper.maxSteps = Math.max(1, Math.min(5, Math.floor(this.fixedDelta * 1000 / Math.max(0.01, this.stepCostMs))));
            const steps = this.stepper.advance(rawDeltaTime);
            if (steps === 0) this.#sweep(false);
            for (let i = 0; i < steps; i++) this.#timedSimulate();
            Constants.DELTA_TIME = this.fixedDelta * Math.max(0, this.timeScale);
        } else {
            // Frozen in Edit/Paused so a scene can be positioned before Play. Presses made while frozen must not fire on the first step after resuming.
            this.stepper.reset();
            this.#sweep(true);
            input.endStep();
        }

        this.#render();
    }

    #render() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (this.scene?.backgroundColor) {
            this.ctx.fillStyle = this.scene.backgroundColor;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        // --- Rendering --- (always runs, so Edit/Paused still show the current scene state)
        // Two passes, not one: a 'Screen'-space entity (a HUD label - see UIElement's `space`
        // field) needs to render in raw, un-transformed canvas pixels so it stays fixed regardless
        // of where the camera's looking, while everything else ('World', the default - true for
        // any entity that doesn't declare `space` at all) renders inside the camera transform so
        // it pans/zooms with the rest of the world. Sorted within each pass by sortingOrder (see
        // Entity.getSortingOrder) rather than plain array order, so an "Order" set on a renderer
        // component actually controls what's drawn in front of what - Array.sort is stable, so
        // entities that tie keep their existing relative order instead of jittering between frames.
        const byOrder = (a, b) => a.getSortingOrder() - b.getSortingOrder();
        const worldEntities = this.entities.filter(e => e instanceof Entity && e.active !== false && (e.space ?? 'World') === 'World').sort(byOrder);
        const screenEntities = this.entities.filter(e => e instanceof Entity && e.active !== false && e.space === 'Screen').sort(byOrder);

        const post = this.#activePostProcess();
        if (post) {
            // World -> offscreen scene canvas -> lights, bloom, grade, vignette -> main canvas. Screen-space UI is drawn afterwards, unaffected.
            const { scene } = post.surfaces(this.canvas.width, this.canvas.height);
            const sctx = scene.ctx;
            sctx.setTransform(1, 0, 0, 1, 0, 0);
            sctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            if (this.scene?.backgroundColor) { sctx.fillStyle = this.scene.backgroundColor; sctx.fillRect(0, 0, this.canvas.width, this.canvas.height); }
            Light2D.collected.length = 0; Light2D.collecting = true;
            sctx.save();
            if (this.camera) this.camera.apply(sctx, this.canvas.width, this.canvas.height);
            for (const entity of worldEntities) entity.render(sctx);
            sctx.restore();
            Light2D.collecting = false;
            post.render(this.ctx, { width: this.canvas.width, height: this.canvas.height, lights: Light2D.collected, applyCamera: (c) => this.camera?.apply(c, this.canvas.width, this.canvas.height) });
            this.ctx.save();
            if (this.camera) this.camera.apply(this.ctx, this.canvas.width, this.canvas.height);
            this.devToolbar?.inspector?.renderGizmo(this.ctx, 'World');
            this.ctx.restore();
        } else {
            this.ctx.save();
            if (this.camera) {
                this.camera.apply(this.ctx, this.canvas.width, this.canvas.height);
            }
            for (const entity of worldEntities) {
                entity.render(this.ctx);
            }
            this.devToolbar?.inspector?.renderGizmo(this.ctx, 'World');
            this.ctx.restore();
        }

        this.ctx.save();
        for (const entity of screenEntities) {
            entity.render(this.ctx);
        }
        this.devToolbar?.inspector?.renderGizmo(this.ctx, 'Screen');
        this.ctx.restore();
    }

    /** The first enabled PostProcess component in the scene that would change the picture, or null (then the plain, cheaper render path is used). */
    #activePostProcess() {
        for (const entity of this.entities) {
            if (entity.destroyed) continue;
            for (const c of entity.components ?? []) if (c instanceof PostProcess && c.enabled && c.active) return c;
        }
        return null;
    }

    /** The current mouse position in world space, accounting for the active camera (if any). */
    getMouseWorldPosition() {
        const screenPos = input.getCanvasMousePosition();
        if (!this.camera) return new Vector2(screenPos.x, screenPos.y);
        return this.camera.screenToWorld(screenPos, this.canvas.width, this.canvas.height);
    }

    /**
     * Adds an entity to the game loop.
     * @param {Entity} entity The entity to add.
     */
    add(entity) {
        if (entity && entity instanceof Entity) {
            this.entities.push(entity);
        } else {
            console.error("Attempted to add an invalid object to the GameLoop. Must be an Entity.", entity);
        }
    }

    /**
     * Removes an entity from the game loop. Equivalent to calling entity.destroy() directly;
     * provided so callers that hold the GameLoop but not the entity's own reference can do it too.
     * @param {Entity} entity The entity to remove.
     */
    remove(entity) {
        if (entity instanceof Entity) {
            entity.destroy();
        }
    }

    /**
     * Finds the first entity with a given tag.
     * @param {string} tag The tag to search for.
     * @returns {Entity|undefined} The found entity, or undefined.
     */
    findObjectWithTag(tag) {
        return this.entities.find(entity => entity.tag === tag);
    }
}
