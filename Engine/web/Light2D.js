import { Component } from './Component.js';
import { ComponentRegistry } from './ComponentRegistry.js';
import { parseColor } from './Animation/Tracks.js';

/**
 * A soft round light. It does nothing on its own: while a `PostProcess` component exists in the scene (its `Ambient` darkens the world),
 * every enabled Light2D adds light around its entity: it brightens and tints the floor, props and enemies near it. Put one on a bullet, an
 * explosion, a torch or an engine flame. Lights add up. They cast no shadows and (being 8-bit) cannot push a surface brighter than its own colour
 * through the darkening pass; the `Light strength` on PostProcess adds a second, additive glow on top for that.
 */
export class Light2D extends Component {
    static description = 'A soft round light that brightens and tints the scene around it. Needs a PostProcess component in the scene (its Ambient sets how dark the world is).';

    static fields = [
        { key: 'color', label: 'Color', type: 'color', animatable: true },
        { key: 'radius', label: 'Radius (px)', type: 'number', animatable: true },
        { key: 'intensity', label: 'Intensity', type: 'number', animatable: true },
        { key: 'offsetX', label: 'Offset X', type: 'number' },
        { key: 'offsetY', label: 'Offset Y', type: 'number' },
    ];

    constructor({ color = '#ffffff', radius = 200, intensity = 1, offsetX = 0, offsetY = 0 } = {}) {
        super();
        Object.assign(this, { color, radius, intensity, offsetX, offsetY });
    }

    /** Lights seen by the render pass this frame (world space). Only filled while `Light2D.collecting` is on (PostProcess's pass turns it on). */
    static collected = [];
    static collecting = false;

    draw() {
        if (!Light2D.collecting || this.intensity <= 0 || this.radius <= 0) return;
        const p = this.entity?.transform?.position;
        if (!p) return;
        const c = parseColor(this.color) ?? [255, 255, 255, 1];
        Light2D.collected.push({ x: p.x + this.offsetX, y: p.y + this.offsetY, radius: this.radius, rgb: [c[0], c[1], c[2]], intensity: this.intensity * c[3] });
    }
}

ComponentRegistry.register('Light2D', Light2D, 'engine');
