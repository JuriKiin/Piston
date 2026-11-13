import { Component } from './Component.js';
import { ComponentRegistry } from './ComponentRegistry.js';
import { parseColor, formatColor } from './Animation/Tracks.js';
import Constants from './static/Constants.js';
import { ImageCache } from './ImageCache.js';
import { BLEND_MODES, compositeOp } from './Rendering/Blend.js';
import { tintedImage, quantizeColor } from './Rendering/Surface.js';

/**
 * Emits short-lived particles from its entity: dust puffs, sparks, confetti, smoke. Put it on any entity.
 *
 *  - Continuous: tick `Emitting`, particles spawn at `Rate` per second.
 *  - Bursts: call `entity.getComponent(ParticleEmitter).burst()` (or `burst(40)`) from code, or from an animation event.
 *
 * Each particle flies from the entity's position along `Angle` (degrees, 0 = right, relative to the entity's rotation) fanned by
 * `Spread`, at `Speed`, pulled by `Gravity` and slowed by `Drag`, and shrinks/changes color/fades over its `Lifetime`. Set `Image` to draw a
 * soft glow, smoke puff or spark texture instead of a plain shape (it is tinted by the start/end colors; use a white texture), and `Blend mode`
 * to `additive` to make particles add light instead of covering what is behind them. With `World space` on, particles stay
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
        { key: 'imagePath', label: 'Image (replaces Shape)', type: 'text', accept: 'image' },
        { key: 'blendMode', label: 'Blend mode', type: 'select', options: BLEND_MODES },
        { key: 'drag', label: 'Drag (per second)', type: 'number' },
        { key: 'spin', label: 'Spin (deg/s)', type: 'number' },
        { key: 'spinVariation', label: 'Spin variation (0-1)', type: 'number' },
        { key: 'randomRotation', label: 'Random start rotation', type: 'checkbox' },
        { key: 'sizeVariation', label: 'Size variation (0-1)', type: 'number' },
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
        worldSpace = true, maxParticles = 300, sortingOrder = 5, imagePath = '', blendMode = 'normal', drag = 0, spin = 0, spinVariation = 0,
        randomRotation = false, sizeVariation = 0,
    } = {}) {
        super();
        Object.assign(this, { emitting, rate, burstCount, lifetime, speed, speedVariation, angle, spread, gravity, shape, startSize, endSize,
            startColor, endColor, fade, worldSpace, maxParticles, sortingOrder, blendMode, drag, spin, spinVariation, randomRotation, sizeVariation });
        this._imagePath = '';
        this._entry = null;
        this.imagePath = imagePath;
        this.particles = [];
        this.random = Math.random;   // tests swap in a seeded generator
        this.owed = 0;               // fractional particles carried between frames
    }

    get imagePath() { return this._imagePath; }
    set imagePath(path) { this._imagePath = path || ''; this._entry = path ? ImageCache.get(path) : null; }

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
                rot: this.randomRotation ? this.random() * Math.PI * 2 : 0,
                spin: ((this.spin * Math.PI) / 180) * (1 + (this.random() * 2 - 1) * this.spinVariation),
                sizeMul: 1 + (this.random() * 2 - 1) * this.sizeVariation,
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
        const damp = this.drag > 0 ? Math.exp(-this.drag * dt) : 1;
        for (const p of this.particles) {
            p.age += dt;
            if (damp !== 1) { p.vx *= damp; p.vy *= damp; }
            p.vy += this.gravity * dt;
            p.rot += p.spin * dt;
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
        const baseAlpha = ctx.globalAlpha, previousOp = ctx.globalCompositeOperation;
        if (this.blendMode !== 'normal') ctx.globalCompositeOperation = compositeOp(this.blendMode);
        const image = this._entry?.loaded ? this._entry.image : null;
        const sameColor = a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
        if (image) ctx.imageSmoothingEnabled = true;
        for (const p of this.particles) {
            const k = Math.min(1, p.age / p.life);
            let x = p.x, y = p.y;
            if (this.worldSpace) { // particles hold world positions; the entity draws in its own (translated, rotated) space
                const dx = x - t.position.x, dy = y - t.position.y;
                x = dx * cos - dy * sin; y = dx * sin + dy * cos;
            }
            const size = Math.max(0, (this.startSize + (this.endSize - this.startSize) * k) * p.sizeMul);
            ctx.globalAlpha = baseAlpha * (this.fade ? 1 - k : 1) * (a[3] + (b[3] - a[3]) * k);
            if (image) {
                const tex = sameColor ? tintedImage(image, quantizeColor(a)) : tintedImage(image, quantizeColor([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]));
                if (p.rot) { ctx.translate(x, y); ctx.rotate(p.rot); ctx.drawImage(tex, -size / 2, -size / 2, size, size); ctx.rotate(-p.rot); ctx.translate(-x, -y); }
                else ctx.drawImage(tex, x - size / 2, y - size / 2, size, size);
                continue;
            }
            ctx.fillStyle = formatColor([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, 1]);
            if (this.shape === 'square') {
                if (p.rot) { ctx.translate(x, y); ctx.rotate(p.rot); ctx.fillRect(-size / 2, -size / 2, size, size); ctx.rotate(-p.rot); ctx.translate(-x, -y); }
                else ctx.fillRect(x - size / 2, y - size / 2, size, size);
            } else { ctx.beginPath(); ctx.arc(x, y, size / 2, 0, Math.PI * 2); ctx.fill(); }
        }
        ctx.globalAlpha = baseAlpha;
        ctx.globalCompositeOperation = previousOp;
    }

    restoreState() { this.particles = []; this.owed = 0; }
}

ComponentRegistry.register('ParticleEmitter', ParticleEmitter, 'engine');
