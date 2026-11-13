import { Component } from './Component.js';
import { ComponentRegistry } from './ComponentRegistry.js';
import { parseColor, formatColor } from './Animation/Tracks.js';
import Constants from './static/Constants.js';

/**
 * Emits short-lived particles from its entity: dust puffs, sparks, confetti, smoke. Put it on any entity.
 *
 *  - Continuous: tick `Emitting`, particles spawn at `Rate` per second.
 *  - Bursts: call `entity.getComponent(ParticleEmitter).burst()` (or `burst(40)`) from code, or from an animation event.
 *
 * Each particle flies from the entity's position along `Angle` (degrees, 0 = right, relative to the entity's rotation) fanned by
 * `Spread`, at `Speed`, pulled by `Gravity`, and shrinks/changes color/fades over its `Lifetime`. With `World space` on, particles stay
 * where they were emitted when the entity moves (a trail); off, they travel with the entity.
 */
export class ParticleEmitter extends Component {
    static description = "Emits short-lived particles (dust, sparks, confetti). Tick Emitting for a stream, or call burst() from code for a one-off puff.";

    static fields = [
        { key: 'emitting', label: 'Emitting', type: 'checkbox' },
        { key: 'rate', label: 'Rate (per second)', type: 'number', animatable: true },
        { key: 'burstCount', label: 'Burst count', type: 'number' },
        { key: 'lifetime', label: 'Lifetime (s)', type: 'number' },
        { key: 'speed', label: 'Speed', type: 'number' },
        { key: 'speedVariation', label: 'Speed variation (0-1)', type: 'number' },
        { key: 'angle', label: 'Angle (deg)', type: 'number' },
        { key: 'spread', label: 'Spread (deg)', type: 'number' },
        { key: 'gravity', label: 'Gravity (down)', type: 'number' },
        { key: 'shape', label: 'Shape', type: 'select', options: ['circle', 'square'] },
        { key: 'startSize', label: 'Start size', type: 'number' },
        { key: 'endSize', label: 'End size', type: 'number' },
        { key: 'startColor', label: 'Start color', type: 'color', animatable: true },
        { key: 'endColor', label: 'End color', type: 'color', animatable: true },
        { key: 'fade', label: 'Fade out', type: 'checkbox' },
        { key: 'worldSpace', label: 'World space', type: 'checkbox' },
        { key: 'maxParticles', label: 'Max particles', type: 'number' },
        { key: 'sortingOrder', label: 'Order', type: 'number' },
    ];

    constructor({
        emitting = false, rate = 20, burstCount = 12, lifetime = 0.6, speed = 120, speedVariation = 0.4, angle = -90, spread = 360,
        gravity = 0, shape = 'circle', startSize = 6, endSize = 0, startColor = '#ffffff', endColor = '#ffffff', fade = true,
        worldSpace = true, maxParticles = 300, sortingOrder = 5,
    } = {}) {
        super();
        Object.assign(this, { emitting, rate, burstCount, lifetime, speed, speedVariation, angle, spread, gravity, shape, startSize, endSize,
            startColor, endColor, fade, worldSpace, maxParticles, sortingOrder });
        this.particles = [];
        this.random = Math.random;   // tests swap in a seeded generator
        this.owed = 0;               // fractional particles carried between frames
    }

    /** Spawns `count` particles right now (default: the Burst count field). */
    burst(count = this.burstCount) { this.emit(count); }

    emit(count) {
        const t = this.entity?.transform;
        const base = ((this.angle + (t?.rotation ?? 0)) * Math.PI) / 180;
        const spread = (this.spread * Math.PI) / 180;
        for (let i = 0; i < count && this.particles.length < this.maxParticles; i++) {
            const dir = base + (this.random() - 0.5) * spread;
            const speed = this.speed * (1 + (this.random() * 2 - 1) * this.speedVariation);
            this.particles.push({
                x: this.worldSpace ? (t?.position.x ?? 0) : 0, y: this.worldSpace ? (t?.position.y ?? 0) : 0,
                vx: Math.cos(dir) * speed, vy: Math.sin(dir) * speed, age: 0, life: Math.max(0.01, this.lifetime * (0.8 + this.random() * 0.4)),
            });
        }
    }

    update() {
        const dt = Constants.DELTA_TIME;
        if (this.emitting && this.rate > 0) {
            this.owed += this.rate * dt;
            const n = Math.floor(this.owed);
            this.owed -= n;
            if (n > 0) this.emit(n);
        }
        for (const p of this.particles) {
            p.age += dt;
            p.vy += this.gravity * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
        }
        this.particles = this.particles.filter(p => p.age < p.life);
    }

    draw(ctx) {
        if (!this.particles.length) return;
        const a = parseColor(this.startColor) ?? [255, 255, 255, 1], b = parseColor(this.endColor) ?? a;
        const t = this.entity?.transform;
        const rot = this.worldSpace ? -((t?.rotation ?? 0) * Math.PI) / 180 : 0, cos = Math.cos(rot), sin = Math.sin(rot);
        const baseAlpha = ctx.globalAlpha;
        for (const p of this.particles) {
            const k = Math.min(1, p.age / p.life);
            let x = p.x, y = p.y;
            if (this.worldSpace) { // particles hold world positions; the entity draws in its own (translated, rotated) space
                const dx = x - t.position.x, dy = y - t.position.y;
                x = dx * cos - dy * sin; y = dx * sin + dy * cos;
            }
            const size = Math.max(0, this.startSize + (this.endSize - this.startSize) * k);
            ctx.globalAlpha = baseAlpha * (this.fade ? 1 - k : 1);
            ctx.fillStyle = formatColor(a.map((v, i) => v + (b[i] - v) * k));
            if (this.shape === 'square') ctx.fillRect(x - size / 2, y - size / 2, size, size);
            else { ctx.beginPath(); ctx.arc(x, y, size / 2, 0, Math.PI * 2); ctx.fill(); }
        }
        ctx.globalAlpha = baseAlpha;
    }

    restoreState() { this.particles = []; this.owed = 0; }
}

ComponentRegistry.register('ParticleEmitter', ParticleEmitter, 'engine');
