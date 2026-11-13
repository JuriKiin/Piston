import { Component } from './Component.js';
import { ComponentRegistry } from './ComponentRegistry.js';
import { SpriteRenderer } from './SpriteRenderer.js';
import Constants from './static/Constants.js';

/**
 * Plays named animation clips on the entity's SpriteRenderer. A clip is a range of frames on the sprite sheet:
 *   { name: 'run', from: 4, to: 9, fps: 12, loop: true }      (frame numbers are inclusive, counted left to right, top to bottom)
 *
 * From code:  entity.getComponent(SpriteAnimator).play('run');   .stop();   .isPlaying;   .current
 * The entity gets `onAnimationFinished(name)` (if it defines one) when a non-looping clip ends.
 *
 * The animator owns the frame: it switches the renderer's own looping off so the two never fight.
 */
export class SpriteAnimator extends Component {
    static description = "Plays named animation clips (ranges of frames) on the SpriteRenderer next to it.";

    static fields = [
        { key: 'clips', label: 'Animations', type: 'clips' },
        { key: 'defaultClip', label: 'Default clip', type: 'text' },
        { key: 'playOnStart', label: 'Play on start', type: 'checkbox' },
        { key: 'speed', label: 'Speed', type: 'number' },
    ];

    constructor({ clips = [], defaultClip = '', playOnStart = true, speed = 1 } = {}) {
        super();
        this.clips = clips;
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

    #begun = false;
    #begin() {
        if (this.#begun || !this.clips.length) return;
        this.#begun = true;
        if (this.playOnStart && !this.isPlaying) this.play(this.defaultClip || this.clips[0]?.name);
    }

    /** Starts a clip by name. Playing the clip that's already running does nothing unless `restart` is set. */
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

    stop() {
        this.isPlaying = false;
    }

    update() {
        this.#begin();
        if (!this.isPlaying) return;
        const clip = this.clips.find(c => c.name === this.current);
        if (!clip) { this.isPlaying = false; return; }

        const count = Math.max(1, clip.to - clip.from + 1);
        this.time += Constants.DELTA_TIME * this.speed;
        let index = Math.floor(this.time * (clip.fps || 12));
        if (index >= count) {
            if (clip.loop !== false) {
                index %= count;
            } else {
                index = count - 1;
                this.isPlaying = false;
                this.entity?.onAnimationFinished?.(clip.name);
            }
        }
        this.#apply(clip, index);
    }

    #apply(clip, index) {
        const renderer = this.entity?.getComponent(SpriteRenderer);
        if (!renderer) return;
        renderer.playing = false; // the animator drives the frame
        renderer.currentFrame = clip.from + index;
    }

    captureState() { return { current: this.current, time: this.time, isPlaying: this.isPlaying }; }

    restoreState(state) {
        if (!state) return;
        this.current = state.current;
        this.time = state.time;
        this.isPlaying = state.isPlaying;
        this.#begun = false;
        const clip = this.clips.find(c => c.name === this.current);
        if (clip) this.#apply(clip, 0);
    }
}

ComponentRegistry.register('SpriteAnimator', SpriteAnimator, 'engine');
