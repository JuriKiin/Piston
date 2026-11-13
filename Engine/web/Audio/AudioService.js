/**
 * The engine's audio platform service. Game code and components never touch the browser's audio API directly: they
 * go through this, so another platform (Android, iOS) can supply its own implementation of the same interface.
 *
 *   Piston.audio.play('./assets/hit.wav', { volume: 0.8, bus: 'sfx', pitch: 1.2 })   -> Voice
 *   Piston.audio.setBusVolume('music', 0.5)      Piston.audio.stopAll('sfx')
 *
 * Every play() starts its own voice, so many sounds (and many copies of the same clip) overlap without cutting
 * each other off. Clips are fetched and decoded once, then shared. A clip is capped at `maxVoices` simultaneous
 * copies; past that the oldest copy is stopped, so a machine-gun of hits can't pile up forever.
 *
 * Buses: 'master' (everything) with 'sfx', 'music' and 'ui' beneath it, each with its own volume and mute.
 *
 * Interface a platform must provide (JS names; other platforms mirror them):
 *   play(path, options) -> Voice { stop(), setVolume(v), playing }   stopAll(bus?)   load(path) -> Promise
 *   setBusVolume(bus, v)   setBusMuted(bus, muted)   unlock()
 */
export const BUSES = ['sfx', 'music', 'ui'];

export class Voice {
    constructor(service, path, bus) {
        this.service = service;
        this.path = path;
        this.bus = bus;
        this.playing = true;
        this.source = null;
        this.gain = null;
        this.volume = 1;
    }

    stop() {
        if (!this.playing) return;
        this.playing = false;
        try { this.source?.stop(); } catch { /* already stopped */ }
        this.service._forget(this);
    }

    setVolume(v) {
        this.volume = v;
        if (this.gain) this.gain.gain.value = v;
    }
}

export class AudioService {
    /**
     * @param {object} [deps] injection points (tests, other platforms)
     * @param {() => AudioContext} [deps.createContext]
     * @param {(path: string) => Promise<ArrayBuffer>} [deps.fetchBytes]
     */
    constructor({ createContext, fetchBytes, maxVoicesPerClip = 16 } = {}) {
        this.createContext = createContext ?? (() => new (globalThis.AudioContext ?? globalThis.webkitAudioContext)());
        this.fetchBytes = fetchBytes ?? (async (path) => {
            const res = await fetch(path);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.arrayBuffer();
        });
        this.maxVoicesPerClip = maxVoicesPerClip;
        this.ctx = null;
        this.buses = {};
        this.volumes = { master: 1, sfx: 1, music: 1, ui: 1 };
        this.muted = {};
        this.buffers = new Map();   // path -> Promise<AudioBuffer>
        this.voices = new Set();
        this.unlockInstalled = false;
    }

    /** Creates the context lazily (browsers only allow audio after a user gesture) and wires the bus graph. */
    #context() {
        if (this.ctx) return this.ctx;
        this.ctx = this.createContext();
        const master = this.ctx.createGain();
        master.connect(this.ctx.destination);
        this.buses.master = master;
        for (const name of BUSES) {
            const g = this.ctx.createGain();
            g.connect(master);
            this.buses[name] = g;
        }
        for (const name of ['master', ...BUSES]) this.#applyBus(name);
        return this.ctx;
    }

    #applyBus(name) {
        const node = this.buses[name];
        if (node) node.gain.value = this.muted[name] ? 0 : this.volumes[name];
    }

    /** Call from a user gesture (a click or key press) so the browser allows sound. Installed automatically. */
    unlock() {
        const ctx = this.#context();
        if (ctx.state === 'suspended') ctx.resume?.();
    }

    installAutoUnlock(target = globalThis) {
        if (this.unlockInstalled || !target.addEventListener) return;
        this.unlockInstalled = true;
        const handler = () => this.unlock();
        for (const type of ['pointerdown', 'keydown', 'touchstart']) target.addEventListener(type, handler, { passive: true });
    }

    load(path) {
        if (!this.buffers.has(path)) {
            const ctx = this.#context();
            const promise = this.fetchBytes(path).then(bytes => ctx.decodeAudioData(bytes));
            promise.catch(() => this.buffers.delete(path)); // a failed load can be retried
            this.buffers.set(path, promise);
        }
        return this.buffers.get(path);
    }

    /**
     * Starts a sound now (it begins as soon as the clip is decoded) and returns its Voice.
     * @param {string} path
     * @param {{volume?: number, loop?: boolean, bus?: string, pitch?: number}} [options]
     */
    play(path, { volume = 1, loop = false, bus = 'sfx', pitch = 1 } = {}) {
        if (!path) return null;
        const ctx = this.#context();
        const voice = new Voice(this, path, BUSES.includes(bus) ? bus : 'sfx');
        voice.volume = volume;
        this.voices.add(voice);
        this.#enforceLimit(path, voice);

        this.load(path).then((buffer) => {
            if (!voice.playing) return; // stopped while loading
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.loop = loop;
            source.playbackRate.value = pitch;
            const gain = ctx.createGain();
            gain.gain.value = voice.volume;
            source.connect(gain);
            gain.connect(this.buses[voice.bus]);
            source.onended = () => { voice.playing = false; this._forget(voice); };
            voice.source = source;
            voice.gain = gain;
            source.start(0);
        }).catch((error) => {
            voice.playing = false;
            this._forget(voice);
            console.warn(`Audio: couldn't play "${path}": ${error?.message ?? error}`);
        });
        return voice;
    }

    #enforceLimit(path, newest) {
        const same = [...this.voices].filter(v => v.path === path && v !== newest);
        while (same.length >= this.maxVoicesPerClip) same.shift().stop();
    }

    _forget(voice) { this.voices.delete(voice); }

    voiceCount(path) { return [...this.voices].filter(v => !path || v.path === path).length; }

    stopAll(bus) {
        for (const v of [...this.voices]) if (!bus || v.bus === bus) v.stop();
    }

    setBusVolume(bus, v) {
        this.volumes[bus] = Math.max(0, v);
        this.#applyBus(bus);
    }

    setBusMuted(bus, muted) {
        this.muted[bus] = !!muted;
        this.#applyBus(bus);
    }
}

/** The one shared instance (the engine and games use this). */
export const audio = new AudioService();
