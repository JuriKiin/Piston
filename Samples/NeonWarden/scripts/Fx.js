import { Vector2 } from "@piston/Physics/Vector2.js";
import { ParticleEmitter } from "@piston/ParticleEmitter.js";
import { Animator } from "@piston/Animator.js";
import { Light2D } from "@piston/Light2D.js";
import Constants from "@piston/static/Constants.js";
import { Actor, Game, mkSprite, ART, rand } from "./Game.js";

const HOT = '#ffd070', RED = '#ff3010';

/** A one-shot sprite effect: plays a sheet once, optionally grows, fades, and carries a light that fades with it. */
export class FxSprite extends Actor {
    constructor(o) { super(); this.o = o; this.tag = 'Fx'; this.order = o.order ?? 60; this.age = 0; }
    start() {
        const o = this.o;
        this.transform.position = new Vector2(o.x, o.y);
        this.transform.rotation = o.rot ?? 0;
        this.transform.size = new Vector2(o.w, o.h ?? o.w);
        this.lifetime = o.life ?? ((o.frames ?? 1) / (o.fps ?? 30));
        this.sprite = this.addComponent(mkSprite(o.sheet, { fw: o.fw, fh: o.fh, frames: o.frames, cols: o.cols, fps: o.fps, loop: false, ax: o.ax, ay: o.ay, blend: o.blend ?? 'additive' }));
        if (o.light) this.light = this.addComponent(new Light2D({ color: o.light.color, radius: o.light.radius, intensity: o.light.intensity }));
        if (o.clips) this.addComponent(new Animator({ clips: o.clips, defaultClip: o.clips[0].name, playOnStart: true }));
    }
    update() {
        super.update();
        this.age += Constants.DELTA_TIME;
        const k = Math.min(1, this.age / Math.max(0.001, this.lifetime));
        const o = this.o;
        if (o.scaleTo) { const s = 1 + (o.scaleTo - 1) * (1 - (1 - k) * (1 - k)); this.transform.size = new Vector2(o.w * s, (o.h ?? o.w) * s); }
        if (o.fade) this.sprite.opacity = (1 - k) ** o.fade;
        if (this.light) this.light.intensity = o.light.intensity * (1 - k) ** 1.5;
    }
}

/** Fires particle bursts the moment it appears, then removes itself. `emitters` is a list of ParticleEmitter option bags. */
export class FxBurst extends Actor {
    constructor(x, y, emitters, rot = 0) { super(); this.px = x; this.py = y; this.emitters = emitters; this.rot = rot; this.tag = 'Fx'; this.order = 70; this.fired = false; }
    start() {
        this.transform.position = new Vector2(this.px, this.py);
        this.transform.rotation = this.rot;
        let life = 0;
        this.ems = this.emitters.map((e) => { const p = this.addComponent(new ParticleEmitter({ maxParticles: 80, ...e })); life = Math.max(life, (e.lifetime ?? 0.6) * 1.3); return p; });
        this.lifetime = life + 0.05;
    }
    update() {
        super.update();
        if (!this.fired) { this.fired = true; for (const p of this.ems) p.burst(); }
    }
}

const sheet = (name, frames, fw, fh, cols) => ({ sheet: name, frames, fw, fh, cols: cols ?? frames });
const S = {
    explosion: sheet('explosion.png', 16, 256, 256, 4), explosionBig: sheet('explosion_big.png', 16, 512, 512, 4),
    muzzle: sheet('muzzle.png', 4, 128, 96), sparkAmb: sheet('spark_amb.png', 6, 128, 128), sparkCyan: sheet('spark_cyan.png', 6, 128, 128),
};

const sparks = (n, color0, color1, speed = 380, life = 0.6) => ({ imagePath: ART + 'glow.png', blendMode: 'additive', burstCount: n, lifetime: life, speed, speedVariation: 0.6, spread: 360, drag: 2.6,
    startSize: 22, endSize: 2, startColor: color0, endColor: color1, fade: true, sortingOrder: 72, sizeVariation: 0.4 });
const smoke = (n, size) => ({ imagePath: ART + 'smoke.png', blendMode: 'normal', burstCount: n, lifetime: 1.3, speed: 70, speedVariation: 0.7, spread: 360, drag: 1.2, startSize: size * 0.5, endSize: size,
    startColor: '#6a5a86', endColor: '#14101e', fade: true, spin: 40, spinVariation: 1, randomRotation: true, sortingOrder: 68, sizeVariation: 0.3 });
const debris = (n) => ({ imagePath: ART + 'shard.png', blendMode: 'normal', burstCount: n, lifetime: 1.0, speed: 340, speedVariation: 0.7, spread: 360, drag: 1.6, gravity: 0, startSize: 22, endSize: 8,
    startColor: '#ffffff', endColor: '#aab4e0', fade: true, spin: 540, spinVariation: 1, randomRotation: true, sortingOrder: 69, sizeVariation: 0.5 });

export const Fx = {
    sprite(o) { return Game.spawn(new FxSprite(o)); },
    burst(x, y, emitters, rot) { return Game.spawn(new FxBurst(x, y, emitters, rot)); },

    /** A shockwave ring that expands and fades (driven by an Animator clip, so it is editable data). */
    ring(x, y, { color = 'amb', from = 30, to = 420, time = 0.55, light = true } = {}) {
        const clips = [{ name: 'ring', duration: time, loop: false, tracks: [
            { path: 'transform.size.x', keys: [{ t: 0, v: from, ease: 'easeOut' }, { t: time, v: to }] },
            { path: 'transform.size.y', keys: [{ t: 0, v: from, ease: 'easeOut' }, { t: time, v: to }] },
            { path: 'SpriteRenderer.opacity', keys: [{ t: 0, v: 1, ease: 'easeIn' }, { t: time, v: 0 }] }], events: [] }];
        const lc = { amb: '#ffb02e', cyan: '#33e6ff', mag: '#ff2e88' }[color];
        return this.sprite({ x, y, w: from, sheet: `ring_${color}.png`, life: time, clips, order: 62, light: light ? { color: lc, radius: Math.min(to * 0.6, 260), intensity: 0.9 } : null });
    },

    explosion(x, y, { big = false, scale = 1 } = {}) {
        const sp = big ? S.explosionBig : S.explosion;
        this.sprite({ x, y, w: (big ? 520 : 210) * scale, ...sp, fps: big ? 22 : 32, order: 64, rot: rand(0, 360), light: { color: '#ffa040', radius: (big ? 620 : 300) * scale, intensity: big ? 2.4 : 1.7 } });
        this.ring(x, y, { color: 'amb', from: 40 * scale, to: (big ? 760 : 300) * scale, time: big ? 0.8 : 0.5 });
        this.burst(x, y, [sparks(big ? 60 : 24, HOT, RED, big ? 620 : 420, big ? 0.9 : 0.6), smoke(big ? 14 : 6, (big ? 220 : 110) * scale), debris(big ? 22 : 9)]);
    },

    hitSpark(x, y, rot = 0, cyan = false) {
        this.sprite({ x, y, w: 88, ...(cyan ? S.sparkCyan : S.sparkAmb), fps: 40, rot: rot + rand(-20, 20), order: 66, light: { color: cyan ? '#33e6ff' : '#ffb02e', radius: 110, intensity: 0.8 } });
        this.burst(x, y, [{ ...sparks(5, cyan ? '#aef6ff' : HOT, cyan ? '#1090c0' : RED, 260, 0.35), angle: rot, spread: 90 }], rot);
    },

    muzzle(x, y, rot) { this.sprite({ x, y, w: 84, h: 62, ...S.muzzle, fps: 56, rot, ax: 0.0, order: 66, light: { color: '#33e6ff', radius: 150, intensity: 1.0 } }); },

    /** Drone/segment wreck puff: smaller than a full explosion. */
    pop(x, y, color = 'mag') {
        this.sprite({ x, y, w: 120, ...S.explosion, fps: 36, rot: rand(0, 360), order: 64, light: { color: '#ff4090', radius: 220, intensity: 1.3 } });
        this.ring(x, y, { color, from: 20, to: 200, time: 0.4 });
        this.burst(x, y, [sparks(14, '#ffb0d8', '#ff2e88', 360, 0.5), debris(5)]);
    },
};
