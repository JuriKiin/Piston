import { Component } from '../Component.js';
import { ComponentRegistry } from '../ComponentRegistry.js';
import { ImageCache } from '../ImageCache.js';

/**
 * A background panel for whatever else is on the same entity (typically a Text and/or Button
 * alongside it) - a solid/translucent color, or an image if `imagePath` is set (image wins once
 * it's loaded). Sized to the entity's own transform.size and drawn centered on it, the same
 * rect convention ShapeRenderer already uses, so it's a drop-in "give this entity a backing panel"
 * rather than its own separate positioning scheme.
 */
export class UIContainer extends Component {
    static description = "A rectangle of screen-space UI that holds other UI, with a background colour or image.";

    static fields = [
        { key: 'color', label: 'Background Color', type: 'color', animatable: true },
        { key: 'imagePath', label: 'Background Image', type: 'text', accept: 'image' },
        { key: 'cornerRadius', label: 'Corner Radius', type: 'number', animatable: true },
        { key: 'sortingOrder', label: 'Order', type: 'number' },
    ];

    constructor({ color = '#222222', imagePath = '', cornerRadius = 6, sortingOrder = 0 } = {}) {
        super();
        this.color = color;
        this.cornerRadius = cornerRadius;
        this.sortingOrder = sortingOrder;
        this.imagePath = imagePath; // getter/setter below - same lazy ImageCache load as SpriteRenderer
    }

    get imagePath() { return this._imagePath; }
    set imagePath(path) {
        this._imagePath = path;
        this._entry = path ? ImageCache.get(path) : null;
    }

    get loaded() { return !!this._entry?.loaded; }

    draw(ctx) {
        const size = this.entity.transform.size;
        const w = size?.x || 120;
        const h = size?.y || 40;
        const x = -w / 2;
        const y = -h / 2;

        if (this.loaded) {
            ctx.drawImage(this._entry.image, x, y, w, h);
            return;
        }
        if (!this.color) return;

        ctx.fillStyle = this.color;
        this.#roundedRectPath(ctx, x, y, w, h, this.cornerRadius);
        ctx.fill();
    }

    #roundedRectPath(ctx, x, y, w, h, r) {
        const radius = Math.max(0, Math.min(r, w / 2, h / 2));
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + w, y, x + w, y + h, radius);
        ctx.arcTo(x + w, y + h, x, y + h, radius);
        ctx.arcTo(x, y + h, x, y, radius);
        ctx.arcTo(x, y, x + w, y, radius);
        ctx.closePath();
    }
}

ComponentRegistry.register('UIContainer', UIContainer, 'engine');
