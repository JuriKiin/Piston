import { Component } from './Component.js';
import { ComponentRegistry } from './ComponentRegistry.js';
import { sampleClip, eventsBetween, applyValues } from './Animation/Tracks.js';
import Constants from './static/Constants.js';

/**
 * Animates properties over time with keyframes. A clip is:
 *   { name, duration, loop, tracks: [{ path, keys: [{ t, v, ease }] }], events: [{ t, name }] }
 * A track's `path` is `transform.position.x`, `transform.rotation`, `transform.size.y`, or `Component.field` for any number
 * or color field (e.g. `ShapeRenderer.color`). A key's `ease` shapes the movement from that key to the next.
 *
 * Clips live either inline on the component or, when `asset` is set, in a shared `.anim.json` file ({ clips: [...] }) that every
 * entity pointing at it uses. The file wins only while the inline list is empty.
 *
 * From code:  entity.getComponent(Animator).play('bounce');   .stop();   .isPlaying;   .current
 * The entity gets `onAnimationEvent(name, clip)` for each event the playhead passes and `onAnimationFinished(clip)`
 * when a non-looping clip ends. Author clips in the editor's Animation panel.
 */
export class Animator extends Component {
    static description = 'Animates position, rotation, size and any number or color field over time with keyframes.';

    static fields = [
        { key: 'clips', label: 'Animations', type: 'animation' },
        { key: 'asset', label: 'Animation file', type: 'text', accept: 'any' },
        { key: 'defaultClip', label: 'Default clip', type: 'text' },
        { key: 'playOnStart', label: 'Play on start', type: 'checkbox' },
        { key: 'speed', label: 'Speed', type: 'number' },
    ];

    constructor({ clips = [], asset = '', defaultClip = '', playOnStart = true, speed = 1 } = {}) {
        super();
        this.clips = clips;
        this.asset = asset;
        this.defaultClip = defaultClip;
        this.playOnStart = playOnStart;
        this.speed = speed;
        this.current = '';
        this.time = 0;
        this.isPlaying = false;
    }

    /** Scenes build a component BEFORE applying its saved fields, so `start()` can't see the clips yet. Whichever of start() or the
     * first update() finds clips begins "play on start" (and Stop → Play begins again, see restoreState). */
    start() { this.#begin(); }

    /** How an animation file is read (overridable for tests and other platforms). */
    static loadJSON = (path) => fetch(path).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });

    #begun = false;
    #loading = false;
    #begin() {
        if (!this.clips.length && this.asset && !this.#loading) { // linked to a shared file: fetch it, then begin on a later frame
            this.#loading = true;
            Animator.loadJSON(this.asset)
                .then((data) => { this.clips = data.clips ?? []; })
                .catch((e) => console.warn(`Animator: couldn't load ${this.asset}: ${e.message ?? e}`));
            return;
        }
        if (this.#begun || !this.clips.length) return;
        this.#begun = true;
        if (this.playOnStart && !this.isPlaying) this.play(this.defaultClip || this.clips[0]?.name);
    }

    play(name, { restart = false } = {}) {
        const clip = this.clips.find(c => c.name === name);
        if (!clip) return false;
        if (this.isPlaying && this.current === name && !restart) return true;
        this.current = name;
        this.time = 0;
        this.isPlaying = true;
        this.#apply(clip, 0);
        return true;
    }

    /** Plays a clip and returns a promise that resolves when it finishes (a looping clip never does). Resolves false if there is no such clip. */
    playAsync(name, options) {
        if (!this.play(name, { restart: true, ...options })) return Promise.resolve(false);
        return new Promise((resolve) => { this.#waiters.push({ name, resolve }); });
    }

    /** Jumps to a moment in a clip and holds there without playing (e.g. start a slide-in card hidden: seek('slideIn', 0)). */
    seek(name, t = 0) {
        const clip = this.clips.find(c => c.name === name);
        if (!clip) return false;
        this.current = name;
        this.time = t;
        this.isPlaying = false;
        this.#apply(clip, t);
        return true;
    }

    #waiters = [];
    #notify(name) {
        const done = this.#waiters.filter(w => w.name === name);
        this.#waiters = this.#waiters.filter(w => w.name !== name);
        for (const w of done) w.resolve(true);
    }

    stop() { this.isPlaying = false; }

    update() {
        this.#begin();
        if (!this.isPlaying) return;
        const clip = this.clips.find(c => c.name === this.current);
        if (!clip) { this.isPlaying = false; return; }

        const duration = Math.max(0.0001, clip.duration ?? 1);
        const before = this.time;
        this.time += Constants.DELTA_TIME * this.speed;
        const entity = this.entity;

        if (this.time >= duration) {
            for (const e of eventsBetween(clip, before, duration)) entity?.onAnimationEvent?.(e.name, clip.name);
            if (clip.loop !== false) {
                this.time %= duration;
                for (const e of eventsBetween(clip, -1e-9, this.time)) entity?.onAnimationEvent?.(e.name, clip.name);
            } else {
                this.time = duration;
                this.isPlaying = false;
                this.#apply(clip, duration);
                entity?.onAnimationFinished?.(clip.name);
                this.#notify(clip.name);
                return;
            }
        } else {
            for (const e of eventsBetween(clip, before, this.time)) entity?.onAnimationEvent?.(e.name, clip.name);
        }
        this.#apply(clip, this.time);
    }

    #apply(clip, t) {
        if (this.entity) applyValues(this.entity, sampleClip(clip, t));
    }

    captureState() { return { current: this.current, time: this.time, isPlaying: this.isPlaying }; }

    restoreState(state) {
        if (!state) return;
        this.current = state.current;
        this.time = state.time;
        this.isPlaying = state.isPlaying;
        this.#begun = false; // a fresh Play starts "play on start" again
    }
}

ComponentRegistry.register('Animator', Animator, 'engine');
