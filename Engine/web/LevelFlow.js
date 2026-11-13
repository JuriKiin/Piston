import { Component } from './Component.js';
import { ComponentRegistry } from './ComponentRegistry.js';
import { SceneRegistry } from './SceneRegistry.js';

/**
 * Per-level results and ordering. Put a `LevelInfo` component on any entity in a scene (title, par, next scene),
 * then call `LevelFlow.complete(scene, strokes)` when the player finishes. It records the result, and either
 * returns the next scene (and loads it if you pass a game loop) or reports the run is over with totals.
 */
export class LevelInfo extends Component {
    static description = "Describes a level: title, par and which scene comes next. Put it on any entity in a scene; LevelFlow.finish reads it.";

    static fields = [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'par', label: 'Par', type: 'number' },
        { key: 'nextScene', label: 'Next scene id', type: 'text' },
    ];

    constructor({ title = '', par = 3, nextScene = '' } = {}) {
        super();
        this.title = title;
        this.par = par;
        this.nextScene = nextScene;
    }
}
ComponentRegistry.register('LevelInfo', LevelInfo, 'engine');

export const LevelFlow = {
    results: [],

    reset() { this.results = []; },

    /** First LevelInfo found among the loop's entities, or null. */
    infoOf(entities) {
        for (const e of entities ?? []) {
            const info = e.components?.find(c => c instanceof LevelInfo);
            if (info) return info;
        }
        return null;
    },

    /** Records a finished level. Returns { result, next, done, totals }. */
    complete(sceneId, strokes, info) {
        const result = { scene: sceneId, title: info?.title || sceneId, strokes, par: info?.par ?? null };
        this.results = this.results.filter(r => r.scene !== sceneId).concat(result);
        const next = info?.nextScene ? SceneRegistry.get(info.nextScene) ?? null : null;
        return { result, next, done: !next, totals: this.totals() };
    },

    /**
     * The one call a game makes when the player completes a level: records the result, then moves on, honouring the
     * level's LevelInfo `nextScene` first and the project's scene order after that. Resolves to
     * { result, totals, done } where `done` is true when there was nowhere left to go (the course is finished).
     * Pass `strokes` as your game's score for the level (any number).
     */
    async finish(gameLoop, strokes = 0) {
        const info = this.infoOf(gameLoop.entities);
        const { result, next, totals } = this.complete(gameLoop.scene?.id ?? '', strokes, info);
        let moved = false;
        if (next) moved = await gameLoop.scenes.load(next);
        else moved = await gameLoop.scenes.next();
        if (!moved) console.log(`Course complete! ${totals.strokes} strokes (par ${totals.par}).`);
        return { result, totals, done: !moved };
    },

    totals() {
        const strokes = this.results.reduce((n, r) => n + r.strokes, 0);
        const par = this.results.reduce((n, r) => n + (r.par ?? 0), 0);
        return { strokes, par, over: strokes - par, levels: this.results.length };
    },
};
