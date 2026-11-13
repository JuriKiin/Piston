import { Component } from './Component.js';
import { ComponentRegistry } from './ComponentRegistry.js';
import { parseColor, formatColor } from './Animation/Tracks.js';
import { Surface, tintedImage, quantizeColor } from './Rendering/Surface.js';

/** Filter values that turn "keep only pixels brighter than `threshold` (0-1)" into a brightness() then contrast() pair, so the bloom only picks up bright things. */
export function brightPassParams(threshold) {
    const t = Math.max(0, Math.min(0.98, threshold));
    return { brightness: 1 / (1 + t), contrast: (1 + t) / (1 - t) };
}

/** The `ctx.filter` string for exposure/contrast/saturation, or 'none' when all are neutral (so the common case costs nothing). */
export function gradeFilter({ exposure = 1, contrast = 1, saturation = 1 }) {
    const parts = [];
    if (Math.abs(exposure - 1) > 1e-3) parts.push(`brightness(${+exposure.toFixed(3)})`);
    if (Math.abs(contrast - 1) > 1e-3) parts.push(`contrast(${+contrast.toFixed(3)})`);
    if (Math.abs(saturation - 1) > 1e-3) parts.push(`saturate(${+saturation.toFixed(3)})`);
    return parts.length ? parts.join(' ') : 'none';
}

let lightSprite = null; // white radial falloff, shared
function lightTexture() {
    if (lightSprite) return lightSprite;
    const size = 256, c = Surface.create(size, size), g = c.getContext('2d');
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (let i = 0; i <= 8; i++) { const r = i / 8; gr.addColorStop(r, `rgba(255,255,255,${+Math.pow(1 - r, 2).toFixed(4)})`); } // quadratic falloff: bright core, long soft tail
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    return (lightSprite = c);
}

/**
 * Whole-screen effects applied after the world is drawn and before screen-space UI (HUD): lighting (darken the world, then add `Light2D`s),
 * bloom (bright things glow), colour grading (exposure, contrast, saturation, tint), vignette, chromatic aberration and a full-screen flash.
 * Put one on any entity (usually the camera's). Everything defaults to "off" and costs nothing until you turn it on. Animate the number and
 * colour fields (from the Animation panel or code) for hit flashes, damage vignettes and fade-ins.
 *
 * This is the Canvas2D implementation: 8-bit, no HDR (a pixel cannot be "brighter than white"), no shaders. Bloom uses a half/quarter/eighth/sixteenth
 * resolution chain with the browser's blur filter; lighting is a half-resolution light map multiplied over the scene.
 */
export class PostProcess extends Component {
    static description = 'Whole-screen effects: bloom, lighting (with Light2D), colour grading, vignette, chromatic aberration and screen flash. Applied to the world, not the HUD.';

    static fields = [
        { key: 'bloom', label: 'Bloom intensity', type: 'number', animatable: true },
        { key: 'bloomThreshold', label: 'Bloom threshold (0-1)', type: 'number' },
        { key: 'bloomRadius', label: 'Bloom radius', type: 'number' },
        { key: 'ambient', label: 'Ambient light (white = unlit look)', type: 'color', animatable: true },
        { key: 'lightStrength', label: 'Light glow strength', type: 'number', animatable: true },
        { key: 'exposure', label: 'Exposure', type: 'number', animatable: true },
        { key: 'contrast', label: 'Contrast', type: 'number', animatable: true },
        { key: 'saturation', label: 'Saturation', type: 'number', animatable: true },
        { key: 'tintColor', label: 'Tint color', type: 'color', animatable: true },
        { key: 'tintAmount', label: 'Tint amount (0-1)', type: 'number', animatable: true },
        { key: 'vignette', label: 'Vignette (0-1)', type: 'number', animatable: true },
        { key: 'vignetteColor', label: 'Vignette color', type: 'color', animatable: true },
        { key: 'chromatic', label: 'Chromatic aberration (px)', type: 'number', animatable: true },
        { key: 'flashColor', label: 'Flash color', type: 'color', animatable: true },
        { key: 'flashAmount', label: 'Flash amount (0-1)', type: 'number', animatable: true },
    ];

    constructor({ bloom = 0, bloomThreshold = 0.55, bloomRadius = 3, ambient = '#ffffff', lightStrength = 0.6, exposure = 1, contrast = 1, saturation = 1,
        tintColor = '#ffffff', tintAmount = 0, vignette = 0, vignetteColor = '#000000', chromatic = 0, flashColor = '#ffffff', flashAmount = 0 } = {}) {
        super();
        Object.assign(this, { bloom, bloomThreshold, bloomRadius, ambient, lightStrength, exposure, contrast, saturation, tintColor, tintAmount, vignette, vignetteColor, chromatic, flashColor, flashAmount });
        this._buffers = null;
        this._vignetteKey = '';
        this._vignette = null;
    }

    /** Offscreen canvases for a frame size (re-made if the size changes). `scene` is where the world is drawn. */
    surfaces(width, height) {
        const b = this._buffers;
        if (b && b.width === width && b.height === height) return b;
        const make = (w, h) => { const canvas = Surface.create(w, h); return { canvas, ctx: canvas.getContext('2d') }; };
        this._buffers = {
            width, height, scene: make(width, height), light: make(width / 2, height / 2), lightMul: make(width / 2, height / 2),
            half: make(width / 2, height / 2), quarter: make(width / 4, height / 4), eighth: make(width / 8, height / 8), sixteenth: make(width / 16, height / 16),
            channel: make(width, height),
        };
        this._vignetteKey = '';
        return this._buffers;
    }

    /** True when this component would change the picture at all (otherwise the loop can skip the offscreen pass entirely). */
    get active() {
        return this.bloom > 0.001 || this.vignette > 0.001 || this.chromatic > 0.05 || this.flashAmount > 0.001 || this.tintAmount > 0.001
            || gradeFilter(this) !== 'none' || !this.#ambientIsWhite();
    }

    #ambientIsWhite() { const a = parseColor(this.ambient); return !a || (a[0] >= 254.5 && a[1] >= 254.5 && a[2] >= 254.5); }

    /**
     * Finishes a frame. `scene` holds the already drawn world (it is modified: lit, then used for bloom); the result goes to `dst`.
     * @param {object} opts { width, height, lights: Light2D.collected, applyCamera: (ctx) => void }
     */
    render(dst, { width, height, lights = [], applyCamera = null }) {
        const b = this.surfaces(width, height);
        if (!this.#ambientIsWhite() || lights.length) this.#lighting(b, lights, width, height, applyCamera);
        if (this.bloom > 0.001) this.#buildBloom(b);

        // Composite: colour grade + optional chromatic aberration.
        dst.save();
        dst.setTransform(1, 0, 0, 1, 0, 0);
        dst.globalAlpha = 1; dst.globalCompositeOperation = 'source-over';
        const filter = gradeFilter(this);
        if (this.chromatic > 0.05) {
            const s = this.chromatic / (width / 2), cc = b.channel;
            dst.fillStyle = '#000'; dst.fillRect(0, 0, width, height);
            dst.globalCompositeOperation = 'lighter';
            for (const [color, scale] of [['#ff0000', 1 + s], ['#00ff00', 1], ['#0000ff', 1 - s]]) {
                cc.ctx.globalCompositeOperation = 'copy'; cc.ctx.drawImage(b.scene.canvas, 0, 0);
                cc.ctx.globalCompositeOperation = 'multiply'; cc.ctx.fillStyle = color; cc.ctx.fillRect(0, 0, width, height);
                dst.filter = filter;
                dst.drawImage(cc.canvas, (width - width * scale) / 2, (height - height * scale) / 2, width * scale, height * scale);
            }
            dst.filter = 'none'; dst.globalCompositeOperation = 'source-over';
        } else {
            dst.filter = filter;
            dst.drawImage(b.scene.canvas, 0, 0);
            dst.filter = 'none';
        }

        if (this.bloom > 0.001) {
            dst.globalCompositeOperation = 'lighter';
            dst.imageSmoothingEnabled = true; dst.imageSmoothingQuality = 'high';
            dst.globalAlpha = Math.min(1, this.bloom); dst.drawImage(b.quarter.canvas, 0, 0, width, height);   // the whole chain was folded into this one in #buildBloom
            dst.globalAlpha = 1; dst.globalCompositeOperation = 'source-over';
        }
        if (this.tintAmount > 0.001) {
            dst.globalCompositeOperation = 'soft-light'; dst.globalAlpha = Math.min(1, this.tintAmount);
            dst.fillStyle = this.tintColor; dst.fillRect(0, 0, width, height);
            dst.globalAlpha = 1; dst.globalCompositeOperation = 'source-over';
        }
        if (this.vignette > 0.001) dst.drawImage(this.#vignetteCanvas(width, height), 0, 0);
        if (this.flashAmount > 0.001) {
            dst.globalAlpha = Math.min(1, this.flashAmount); dst.fillStyle = this.flashColor; dst.fillRect(0, 0, width, height); dst.globalAlpha = 1;
        }
        dst.restore();
    }

    #lighting(b, lights, width, height, applyCamera) {
        const L = b.light.ctx, M = b.lightMul.ctx, tex = lightTexture();
        L.setTransform(1, 0, 0, 1, 0, 0); L.globalCompositeOperation = 'source-over'; L.clearRect(0, 0, width / 2, height / 2);
        L.save(); L.scale(0.5, 0.5); if (applyCamera) applyCamera(L);
        L.globalCompositeOperation = 'lighter'; L.imageSmoothingEnabled = true;
        for (const l of lights) {
            const img = tintedImage(tex, quantizeColor(l.rgb, 16)), d = l.radius * 2;
            let remaining = l.intensity;
            while (remaining > 0.01) { L.globalAlpha = Math.min(1, remaining); L.drawImage(img, l.x - l.radius, l.y - l.radius, d, d); remaining -= 1; }
        }
        L.restore();
        // Darken the scene by (ambient + lights), then add a faint additive glow of the lights themselves.
        M.setTransform(1, 0, 0, 1, 0, 0); M.globalAlpha = 1; M.globalCompositeOperation = 'source-over';
        M.fillStyle = this.ambient; M.fillRect(0, 0, width / 2, height / 2);
        M.globalCompositeOperation = 'lighter'; M.drawImage(b.light.canvas, 0, 0);
        const S = b.scene.ctx; S.save(); S.setTransform(1, 0, 0, 1, 0, 0);
        S.imageSmoothingEnabled = true; S.globalAlpha = 1;
        S.globalCompositeOperation = 'multiply'; S.drawImage(b.lightMul.canvas, 0, 0, width, height);
        if (this.lightStrength > 0.001 && lights.length) { S.globalCompositeOperation = 'lighter'; S.globalAlpha = Math.min(1, this.lightStrength); S.drawImage(b.light.canvas, 0, 0, width, height); }
        S.restore();
    }

    #buildBloom(b) {
        const { brightness, contrast } = brightPassParams(this.bloomThreshold);
        const step = (from, to, filter) => { to.ctx.save(); to.ctx.setTransform(1, 0, 0, 1, 0, 0); to.ctx.globalCompositeOperation = 'copy'; to.ctx.imageSmoothingEnabled = true; to.ctx.imageSmoothingQuality = 'high'; to.ctx.filter = filter; to.ctx.drawImage(from.canvas, 0, 0, to.canvas.width, to.canvas.height); to.ctx.filter = 'none'; to.ctx.restore(); };
        step(b.scene, b.half, `brightness(${+brightness.toFixed(3)}) contrast(${+contrast.toFixed(3)})`);
        step(b.half, b.quarter, 'none');
        step(b.quarter, b.eighth, 'none');
        step(b.eighth, b.sixteenth, 'none');
        const r = Math.max(0, this.bloomRadius);
        if (r > 0) { // blur in place through a copy so the source and destination never alias
            this.#blur(b.eighth, b.channel, r); this.#blur(b.sixteenth, b.channel, r); this.#blur(b.quarter, b.channel, r * 1.5);
        }
        // Fold the small levels upward in 2x steps (a single 16x upscale shows its blocky texels): 1/16 into 1/8, then 1/8 into 1/4.
        const up = (from, to, alpha) => { const c = to.ctx; c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'lighter'; c.globalAlpha = alpha; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.drawImage(from.canvas, 0, 0, to.canvas.width, to.canvas.height); c.restore(); };
        up(b.sixteenth, b.eighth, 0.8);
        up(b.eighth, b.quarter, 0.9);
    }

    #blur(target, scratch, radius) {
        // Draws `target` onto itself through a blur filter via the scratch canvas (which is larger, so only its top-left corner is used).
        const w = target.canvas.width, h = target.canvas.height, s = scratch.ctx;
        s.save(); s.setTransform(1, 0, 0, 1, 0, 0); s.globalCompositeOperation = 'copy'; s.globalAlpha = 1; s.filter = 'none'; s.drawImage(target.canvas, 0, 0); s.restore();
        const t = target.ctx; t.save(); t.setTransform(1, 0, 0, 1, 0, 0); t.globalCompositeOperation = 'copy'; t.filter = `blur(${+radius.toFixed(2)}px)`;
        t.drawImage(scratch.canvas, 0, 0, w, h, 0, 0, w, h); t.filter = 'none'; t.restore();
    }

    #vignetteCanvas(width, height) {
        const c = parseColor(this.vignetteColor) ?? [0, 0, 0, 1];
        const key = `${width}x${height}:${this.vignette.toFixed(2)}:${formatColor(c)}`;
        if (this._vignette && this._vignetteKey === key) return this._vignette;
        const canvas = this._vignette && this._vignette.width === width && this._vignette.height === height ? this._vignette : Surface.create(width, height), g = canvas.getContext('2d');
        g.clearRect(0, 0, width, height);
        const r = Math.hypot(width, height) / 2, gr = g.createRadialGradient(width / 2, height / 2, r * (1 - Math.min(1, this.vignette) * 0.75), width / 2, height / 2, r);
        gr.addColorStop(0, formatColor([c[0], c[1], c[2], 0]));
        gr.addColorStop(1, formatColor([c[0], c[1], c[2], Math.min(1, 0.35 + this.vignette * 0.75)]));
        g.fillStyle = gr; g.fillRect(0, 0, width, height);
        this._vignetteKey = key; this._vignette = canvas;
        return canvas;
    }
}

ComponentRegistry.register('PostProcess', PostProcess, 'engine');
