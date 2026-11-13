import { Component } from '../Component.js';
import { ComponentRegistry } from '../ComponentRegistry.js';
import { audio } from './AudioService.js';

/**
 * Plays sound from an entity. Sounds overlap freely: every play() starts its own voice, so several sources, and
 * several plays of the same clip, never cut each other off (see AudioService for limits and buses).
 *
 *   entity.getComponent(AudioSource).play();                 // the component's own clip
 *   entity.getComponent(AudioSource).playOneShot('./assets/pop.wav', { volume: 0.6, pitch: 1.3 });
 *   source.stop();                                           // stops every voice this source started
 *
 * Set "Allow overlap" off to make a source restart instead of layering (handy for a looping engine hum).
 */
export class AudioSource extends Component {
    static description = 'Plays sounds from an entity. Many sounds, and many copies of one clip, can play at once without cutting each other off. Choose a bus (sfx, music, ui) to control groups of sounds together.';

    static fields = [
        { key: 'clip', label: 'Clip', type: 'text', accept: 'audio' },
        { key: 'volume', label: 'Volume', type: 'number' },
        { key: 'pitch', label: 'Pitch (1 = normal)', type: 'number' },
        { key: 'bus', label: 'Bus', type: 'select', options: ['sfx', 'music', 'ui'] },
        { key: 'loop', label: 'Loop', type: 'checkbox' },
        { key: 'overlap', label: 'Allow overlap', type: 'checkbox' },
        { key: 'playOnStart', label: 'Play On Start', type: 'checkbox' },
    ];

    constructor({ clip = '', volume = 1, pitch = 1, bus = 'sfx', loop = false, overlap = true, playOnStart = false } = {}) {
        super();
        this.clip = clip;
        this.volume = volume;
        this.pitch = pitch;
        this.bus = bus;
        this.loop = loop;
        this.overlap = overlap;
        this.playOnStart = playOnStart;
        this.voices = new Set();
    }

    // Scenes build a component BEFORE applying its saved fields, so start() can't see `playOnStart` or `clip` yet:
    // whichever of start() or the first update() finds a clip begins it (and Stop → Play begins again).
    #begun = false;
    #begin() {
        if (this.#begun || !this.clip) return;
        this.#begun = true;
        if (this.playOnStart) this.play();
    }
    start() { this.#begin(); }
    update() { this.#begin(); }

    /** Plays this source's clip. Returns the Voice (or null if there is no clip). */
    play() {
        return this.#start(this.clip, {});
    }

    /** Plays another clip once through this source's bus and volume, without changing `clip`. */
    playOneShot(clip, { volume = 1, pitch = 1 } = {}) {
        return this.#start(clip, { volume: this.volume * volume, pitch: this.pitch * pitch, loop: false });
    }

    #start(clip, overrides) {
        if (!clip) return null;
        if (!this.overlap) this.stop();
        const voice = audio.play(clip, {
            volume: overrides.volume ?? this.volume,
            pitch: overrides.pitch ?? this.pitch,
            loop: overrides.loop ?? this.loop,
            bus: this.bus,
        });
        if (voice) this.voices.add(voice);
        return voice;
    }

    stop() {
        for (const v of this.voices) v.stop();
        this.voices.clear();
    }

    /** Sounds are runtime state, not authoring state: Stop in the editor silences them. */
    captureState() { return null; }
    restoreState() { this.stop(); this.#begun = false; }
}

ComponentRegistry.register('AudioSource', AudioSource, 'engine');
