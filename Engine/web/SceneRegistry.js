import { Scene } from './Scene.js';
/**
 * Every Scene the running page knows about, so the top bar's File menu can offer "New Scene" and a
 * way to switch back to one already built - the same self-registration pattern EntityRegistry and
 * ComponentRegistry already use (a Scene registers itself at import time; GameLoop only ever needs
 * to know this registry exists, not any specific scene). A scene created at runtime via "New Scene"
 * only lives here for the current page session unless it's also given a real .js file that imports
 * (and thus re-registers) it - see DevToolbar's own "New Scene" doc comment for that caveat.
 */
class SceneRegistryImpl {
    constructor() {
        this.scenes = []; // Scene[]
    }

    register(scene) {
        if (this.scenes.some(s => s.id === scene.id)) {
            console.error(`A scene with id "${scene.id}" is already registered - ignoring the duplicate.`);
            return;
        }
        this.scenes.push(scene);
    }

    list() {
        return [...this.scenes];
    }

    /**
     * Makes the registry match the project's scene files, so a game never has to hand-maintain scenes/index.js just
     * to be able to switch scenes. `globalThis.__PISTON_PROJECT__.sceneIds` is the ordered list of scene ids the host
     * found (editor: the scenes/ folder; build: the files it compiled). Scenes already registered by game code keep
     * their object (name, background, create()); missing ones are created. The project's order wins, so
     * Piston.scenes.next() follows it; anything registered but not listed stays at the end.
     */
    syncFromProject() {
        const ids = globalThis.__PISTON_PROJECT__?.sceneIds;
        if (!Array.isArray(ids) || ids.length === 0) return;
        const byId = new Map(this.scenes.map(s => [s.id, s]));
        const ordered = ids.map(id => byId.get(id) ?? new Scene({ id, name: id }));
        for (const s of this.scenes) if (!ids.includes(s.id)) ordered.push(s);
        this.scenes = ordered;
    }

    get(id) {
        return this.scenes.find(s => s.id === id) ?? null;
    }

    /** A filename-safe id guaranteed not to collide with anything already registered - "hole 2!"
     * becomes "hole_2", then "hole_2_2" etc. if that's somehow already taken. */
    uniqueId(fromName) {
        const base = fromName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'scene';
        let id = base;
        let n = 2;
        while (this.get(id)) {
            id = `${base}_${n}`;
            n++;
        }
        return id;
    }
}

export const SceneRegistry = new SceneRegistryImpl();
