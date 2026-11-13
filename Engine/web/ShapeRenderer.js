import { Component } from './Component.js';
import { ComponentRegistry } from './ComponentRegistry.js';

/**
 * Draws the entity as a filled rect (sized from transform.size) or circle (sized from its own
 * `radius`, since not every circle-shaped entity's gameplay radius belongs on the transform).
 * Covers every entity in the game so far (Wall, Bumper, Hole, Player, Gruff, WaterDrop, Ball's
 * body) - previously each one hand-rolled the same fillRect/arc calls in its own draw() override,
 * which is also why none of them showed anything under "Renderer" in the Inspector.
 */
export class ShapeRenderer extends Component {
    static description = "Draws a circle or rectangle with a fill and an outline. The simplest way to give an entity a look.";

    static fields = [
        // 'shape' has to be listed here even though it's rarely hand-edited in the Inspector -
        // SceneIO's save/restore only round-trips whatever's declared in `fields` (it rebuilds a
        // component from scratch via `new ComponentClass()` + these field values), so leaving it
        // out meant every reload silently reset every circle-shaped renderer back to the
        // constructor's 'rect' default.
        { key: 'shape', label: 'Shape', type: 'text' },
        { key: 'color', label: 'Color', type: 'color', animatable: true },
        { key: 'strokeColor', label: 'Stroke Color', type: 'color', animatable: true },
        { key: 'strokeWidth', label: 'Stroke Width', type: 'number', animatable: true },
        { key: 'radius', label: 'Radius (circle)', type: 'number', animatable: true },
        { key: 'opacity', label: 'Opacity', type: 'number', animatable: true },
        // Lower draws first (further back); entities tie-break by their insertion order. Read by
        // Entity.getSortingOrder(), which GameLoop's render pass sorts entities with - any
        // renderer component can opt into this ordering just by having this same field name.
        { key: 'sortingOrder', label: 'Order', type: 'number' },
    ];

    constructor({ shape = 'rect', color = '#333333', strokeColor = null, strokeWidth = 0, radius = 10, opacity = 1, sortingOrder = 0 } = {}) {
        super();
        this.shape = shape; // 'rect' | 'circle'
        this.color = color;
        this.strokeColor = strokeColor;
        this.strokeWidth = strokeWidth;
        this.radius = radius; // only used when shape === 'circle'
        this.opacity = opacity; // 0..1
        this.sortingOrder = sortingOrder;
    }

    draw(ctx) {
        ctx.globalAlpha *= this.opacity; // the entity's draw pass saves/restores the context around this
        ctx.fillStyle = this.color;
        if (this.shape === 'circle') {
            ctx.beginPath();
            ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
            ctx.fill();
            if (this.strokeColor && this.strokeWidth > 0) {
                ctx.strokeStyle = this.strokeColor;
                ctx.lineWidth = this.strokeWidth;
                ctx.stroke();
            }
        } else {
            const size = this.entity.transform.size;
            ctx.fillRect(-size.x / 2, -size.y / 2, size.x, size.y);
            if (this.strokeColor && this.strokeWidth > 0) {
                ctx.strokeStyle = this.strokeColor;
                ctx.lineWidth = this.strokeWidth;
                ctx.strokeRect(-size.x / 2, -size.y / 2, size.x, size.y);
            }
        }
    }

    // Color is sometimes changed at runtime (e.g. Player flashing on collision) - without this,
    // that change would survive a Stop back to Edit instead of reverting like everything else.
    captureState() {
        return { color: this.color };
    }

    restoreState(state) {
        if (state) this.color = state.color;
    }
}

ComponentRegistry.register('ShapeRenderer', ShapeRenderer, 'engine');
