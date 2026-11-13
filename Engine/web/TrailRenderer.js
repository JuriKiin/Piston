import { Component } from './Component.js';
import { ComponentRegistry } from './ComponentRegistry.js';
import { parseColor, formatColor } from './Animation/Tracks.js';
import { BLEND_MODES, compositeOp } from './Rendering/Blend.js';
import Constants from './static/Constants.js';

/**
 * Builds the outline of a ribbon along `points` ({x, y, w} per point, head first): each point is pushed out by half its width along the
 * local normal. Returns { left: [...], right: [...] } point lists (tail-to-head order matches `points`). Pure geometry, no drawing.
 */
export function buildRibbon(points) {
    const left = [], right = [];
    for (let i = 0; i < points.length; i++) {
        const prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
        let dx = next.x - prev.x, dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const nx = -dy, ny = dx, hw = points[i].w / 2;
        left.push({ x: points[i].x + nx * hw, y: points[i].y + ny * hw });
        right.push({ x: points[i].x - nx * hw, y: points[i].y - ny * hw });
    }
    return { left, right };
}

/**
 * Draws a fading, tapering ribbon behind a moving entity: bolt streaks, dash afterimages, engine contrails, sword swooshes.
 * It samples the entity's world position every `Min distance` pixels, keeps each sample for `Lifetime` seconds, and fills one ribbon through them
 * (width `Start width` at the head, `End width` at the tail; colour from `Start color` to `End color`, fading out if `Fade out` is on).
 * Use `Blend mode: additive` for glowing streaks. The colour ramp runs straight from the head to the tail, so very curly trails shade by distance, not by path length.
 */
export class TrailRenderer extends Component {
    static description = 'Draws a fading, tapering ribbon behind a moving entity (bolt streaks, dash trails, contrails).';

    static fields = [
        { key: 'emitting', label: 'Emitting', type: 'checkbox' },
        { key: 'lifetime', label: 'Lifetime (s)', type: 'number' },
        { key: 'minDistance', label: 'Min distance (px)', type: 'number' },
        { key: 'maxPoints', label: 'Max points', type: 'number' },
        { key: 'startWidth', label: 'Start width', type: 'number', animatable: true },
        { key: 'endWidth', label: 'End width', type: 'number', animatable: true },
        { key: 'startColor', label: 'Start color', type: 'color', animatable: true },
        { key: 'endColor', label: 'End color', type: 'color', animatable: true },
        { key: 'fade', label: 'Fade out', type: 'checkbox' },
        { key: 'opacity', label: 'Opacity', type: 'number', animatable: true },
        { key: 'blendMode', label: 'Blend mode', type: 'select', options: BLEND_MODES },
        { key: 'sortingOrder', label: 'Order', type: 'number' },
    ];

    constructor({ emitting = true, lifetime = 0.4, minDistance = 4, maxPoints = 64, startWidth = 10, endWidth = 0, startColor = '#ffffff', endColor = '#ffffff',
        fade = true, opacity = 1, blendMode = 'normal', sortingOrder = 1 } = {}) {
        super();
        Object.assign(this, { emitting, lifetime, minDistance, maxPoints, startWidth, endWidth, startColor, endColor, fade, opacity, blendMode, sortingOrder });
        this.points = []; // { x, y, age }, oldest first, world space
    }

    /** Forgets the trail (call when an entity is teleported or reused so no streak jumps across the screen). */
    clear() { this.points = []; }

    update() {
        const dt = Constants.DELTA_TIME, p = this.entity?.transform?.position;
        for (const pt of this.points) pt.age += dt;
        while (this.points.length && this.points[0].age > this.lifetime) this.points.shift();
        if (!this.emitting || !p) return;
        const last = this.points[this.points.length - 1];
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= this.minDistance) {
            this.points.push({ x: p.x, y: p.y, age: 0 });
            if (this.points.length > this.maxPoints) this.points.shift();
        }
    }

    draw(ctx) {
        const t = this.entity?.transform;
        if (!t || this.points.length < 1 || this.opacity <= 0) return;
        const rot = -((t.rotation ?? 0) * Math.PI) / 180, cos = Math.cos(rot), sin = Math.sin(rot);
        const toLocal = (x, y) => { const dx = x - t.position.x, dy = y - t.position.y; return { x: dx * cos - dy * sin, y: dx * sin + dy * cos }; };
        const life = Math.max(1e-6, this.lifetime);
        const pts = [{ x: 0, y: 0, w: this.startWidth }]; // the head is the entity itself
        for (let i = this.points.length - 1; i >= 0; i--) { // newest to oldest
            const p = this.points[i], k = Math.min(1, p.age / life), l = toLocal(p.x, p.y);
            pts.push({ x: l.x, y: l.y, w: this.startWidth + (this.endWidth - this.startWidth) * k });
        }
        if (pts.length < 2) return;
        if (!pts.every(q => Number.isFinite(q.x) && Number.isFinite(q.y))) return; // a NaN position (bad aim input) must not throw out of the frame loop
        const { left, right } = buildRibbon(pts);
        const a = parseColor(this.startColor) ?? [255, 255, 255, 1], b = parseColor(this.endColor) ?? a;
        const tail = pts[pts.length - 1];
        const g = ctx.createLinearGradient(0, 0, tail.x, tail.y);
        g.addColorStop(0, formatColor(a));
        g.addColorStop(1, formatColor([b[0], b[1], b[2], this.fade ? 0 : b[3]]));
        const baseAlpha = ctx.globalAlpha, previousOp = ctx.globalCompositeOperation;
        ctx.globalAlpha = baseAlpha * this.opacity;
        if (this.blendMode !== 'normal') ctx.globalCompositeOperation = compositeOp(this.blendMode);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(left[0].x, left[0].y);
        for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
        for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = baseAlpha;
        ctx.globalCompositeOperation = previousOp;
    }

    captureState() { return null; }
    restoreState() { this.points = []; }
}

ComponentRegistry.register('TrailRenderer', TrailRenderer, 'engine');
