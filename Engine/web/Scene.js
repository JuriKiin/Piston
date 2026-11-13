/**
 * A scene is just an id + a display name - see SceneIO.js's top comment. Its actual content (which
 * entities exist, where they are, everything) lives entirely in js/game/scenes/<id>.json, fetched
 * fresh by GameLoop on every load. Defining a scene is deliberately this thin: no per-scene .js file
 * or hand-written entity-building code is needed to add a level, only a manifest entry (see
 * js/game/scenes/index.js) and, once you've built something worth keeping, a Save.
 */
export class Scene {
    /**
     * @param {object} config
     * @param {string} config.id Stable filename-safe identifier (e.g. 'hole1') - this is what
     *   picks the scene's canonical level file, `js/game/scenes/<id>.json` (see SceneIO.levelPath).
     *   Kept separate from `name` so renaming a level's display name in the Inspector/UI later
     *   doesn't also silently repoint it at a different (or missing) save file.
     * @param {string} config.name Display name shown in the Inspector/status bar.
     * @param {string} [config.backgroundColor] CSS color GameLoop clears the canvas to each frame
     *   before its level file exists yet - once it does, the file's own saved color (see
     *   SceneIO's applySceneSettings) takes over, so this is only ever seen once, briefly.
     * @param {(canvas: HTMLCanvasElement) => import('./Entity.js').Entity[]} [config.create]
     *   Fallback used only when this scene has no level file yet (see GameLoop.start) - once one
     *   exists, the file is the source of truth and this is never called again. Defaults to an
     *   empty scene, which is normally exactly right: there's nothing to bootstrap by hand when
     *   you're about to build the level live in the Inspector and Save it anyway.
     */
    constructor({ id, name, backgroundColor = '#f0f0f0', create = () => [] }) {
        this.id = id;
        this.name = name;
        this.backgroundColor = backgroundColor;
        this.create = create;
    }

    /** Builds a fresh set of entities for this scene, sized/positioned against the given canvas. */
    instantiate(canvas) {
        return this.create(canvas);
    }
}
