import { SceneRegistry } from './SceneRegistry.js';

/**
 * Scene flow, owned by the engine (not by any one game): which scene is running, what comes next, and how to go
 * there. Reachable from game code as `window.Piston.scenes` (or `gameLoop.scenes`).
 *
 * Scene ORDER is the order scenes are registered in the project's scenes/index.js. A level can also name its
 * successor explicitly with a LevelInfo component's `nextScene`.
 *
 *   Piston.scenes.next()          // load the next scene; resolves false when there is none
 *   Piston.scenes.load('hole3')   // load a scene by id
 *   Piston.scenes.restart()       // reload the current scene
 *   Piston.scenes.nextScene       // the Scene object that would load next (or null)
 */
export class SceneManager {
    constructor(loop) {
        this.loop = loop;
    }

    list() { return SceneRegistry.list(); }

    get current() { return this.loop.scene; }

    get index() { return this.list().findIndex(s => s.id === this.loop.scene?.id); }

    /** The scene after the current one in registration order, or null at the end of the list. */
    get nextScene() {
        const all = this.list(), i = this.index;
        return i >= 0 && i + 1 < all.length ? all[i + 1] : null;
    }

    async load(sceneOrId) {
        const scene = typeof sceneOrId === 'string' ? SceneRegistry.get(sceneOrId) : sceneOrId;
        if (!scene) { console.error(`SceneManager: no scene "${sceneOrId}" is registered (scenes are the .json files in your scenes folder).`); return false; }
        await this.loop.loadScene(scene);
        return true;
    }

    async next() {
        const scene = this.nextScene;
        if (!scene) return false;
        return this.load(scene);
    }

    restart() { return this.load(this.loop.scene); }
}
