import { Component } from './Component.js';
import { ComponentRegistry } from './ComponentRegistry.js';
import { ImageCache } from './ImageCache.js';
import { parseColor, formatColor } from './Animation/Tracks.js';
import { BLEND_MODES, compositeOp } from './Rendering/Blend.js';

const DEG = Math.PI / 180;

/**
 * Where a beam starts, which way it points and how long it is, in the entity's local space (so it moves and turns with the entity).
 * `length-angle`: starts `startDistance` px out along `angle` degrees and runs `length` px. `from-to`: a straight segment between the two points.
 * Pure geometry, no drawing. Returns null for a beam that has no length.
 */
export function beamGeometry(b) {
    let x0, y0, angle, length;
    if (b.mode === 'from-to') {
        const dx = b.toX - b.fromX, dy = b.toY - b.fromY;
        x0 = b.fromX; y0 = b.fromY; length = Math.hypot(dx, dy); angle = Math.atan2(dy, dx);
    } else {
        angle = b.angle * DEG; length = b.length;
        x0 = Math.cos(angle) * b.startDistance; y0 = Math.sin(angle) * b.startDistance;
    }
    return Number.isFinite(length) && length > 0 && Number.isFinite(x0) && Number.isFinite(y0) && Number.isFinite(angle) ? { x0, y0, angle, length } : null;
}

/**
 * Draws a straight beam: a laser, an aim line, a tractor beam, a lightning bolt's trunk, a searchlight. It is a flat strip of `Width` px laid along a line, filled with
 * a texture (stretched along the beam; use a soft strip image for a nice laser) or, with no image, with `Color` fading to transparent across the width.
 * Add `Glow` for a wider, softer halo around it. Everything that changes in play (length, angle, width, colour, glow, opacity) is animatable.
 *
 * Two ways to aim it: `length-angle` (a ray from the entity: `Start distance` out, `Length` long, pointing `Angle` degrees from the entity's own rotation)
 * or `from-to` (a segment between two points, in the entity's local space). The beam draws only; damage, hit tests and impact effects are up to your game.
 */
export class BeamRenderer extends Component {
    static description = 'Draws a straight beam (laser, aim line, searchlight) from a texture or colour, with width, glow, opacity and a blend mode.';

    static fields = [
        { key: 'mode', label: 'Aim mode', type: 'select', options: ['length-angle', 'from-to'] },
        { key: 'length', label: 'Length (px)', type: 'number', animatable: true },
        { key: 'angle', label: 'Angle (deg)', type: 'number', animatable: true },
        { key: 'startDistance', label: 'Start distance (px)', type: 'number', animatable: true },
        { key: 'fromX', label: 'From X', type: 'number', animatable: true },
        { key: 'fromY', label: 'From Y', type: 'number', animatable: true },
        { key: 'toX', label: 'To X', type: 'number', animatable: true },
        { key: 'toY', label: 'To Y', type: 'number', animatable: true },
        { key: 'width', label: 'Width (px)', type: 'number', animatable: true },
        { key: 'imagePath', label: 'Texture', type: 'text', accept: 'image' },
        { key: 'color', label: 'Color (no texture)', type: 'color', animatable: true },
        { key: 'blendMode', label: 'Blend mode', type: 'select', options: BLEND_MODES },
        { key: 'glow', label: 'Glow (0-1)', type: 'number', animatable: true },
        { key: 'glowWidth', label: 'Glow width (x)', type: 'number' },
        { key: 'opacity', label: 'Opacity', type: 'number', animatable: true },
        { key: 'sortingOrder', label: 'Order', type: 'number' },
    ];

    constructor({ mode = 'length-angle', length = 300, angle = 0, startDistance = 0, fromX = 0, fromY = 0, toX = 300, toY = 0, width = 12, imagePath = '', color = '#ff3355',
        blendMode = 'additive', glow = 0, glowWidth = 3, opacity = 1, sortingOrder = 1 } = {}) {
        super();
        Object.assign(this, { mode, length, angle, startDistance, fromX, fromY, toX, toY, width, color, blendMode, glow, glowWidth, opacity, sortingOrder });
        this._imagePath = '';
        this._entry = null;
        this.imagePath = imagePath;
    }

    /** The texture path; setting it loads the image (shared through ImageCache). Empty means colour-filled. */
    get imagePath() { return this._imagePath; }
    set imagePath(path) { this._imagePath = path || ''; this._entry = this._imagePath ? ImageCache.get(this._imagePath) : null; }

    /** The beam's current line in the entity's local space: { x0, y0, angle (radians), length }, or null if it has no length. */
    geometry() { return beamGeometry(this); }

    draw(ctx) {
        const g = beamGeometry(this);
        if (!g || !(this.width > 0) || !(this.opacity > 0)) return;
        const textured = !!this._imagePath;
        if (textured && !this._entry?.loaded) return;
        const baseAlpha = ctx.globalAlpha, previousOp = ctx.globalCompositeOperation;
        if (this.blendMode !== 'normal') ctx.globalCompositeOperation = compositeOp(this.blendMode);
        ctx.save();
        ctx.translate(g.x0, g.y0);
        ctx.rotate(g.angle);
        if (this.glow > 0) this.#strip(ctx, g.length, this.width * Math.max(1, this.glowWidth), baseAlpha * this.opacity * Math.min(1, this.glow), textured);
        this.#strip(ctx, g.length, this.width, baseAlpha * this.opacity, textured);
        ctx.restore();
        ctx.globalAlpha = baseAlpha;
        ctx.globalCompositeOperation = previousOp;
    }

    #strip(ctx, length, width, alpha, textured) {
        ctx.globalAlpha = alpha;
        if (textured) {
            ctx.drawImage(this._entry.image, 0, -width / 2, length, width);
            return;
        }
        const c = parseColor(this.color) ?? [255, 255, 255, 1];
        const g = ctx.createLinearGradient(0, -width / 2, 0, width / 2);
        g.addColorStop(0, formatColor([c[0], c[1], c[2], 0]));
        g.addColorStop(0.5, formatColor(c));
        g.addColorStop(1, formatColor([c[0], c[1], c[2], 0]));
        ctx.fillStyle = g;
        ctx.fillRect(0, -width / 2, length, width);
    }
}

ComponentRegistry.register('BeamRenderer', BeamRenderer, 'engine');
