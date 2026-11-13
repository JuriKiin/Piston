import { Component } from './Component.js';
import { ComponentRegistry } from './ComponentRegistry.js';

/**
 * Draws an arbitrary convex polygon from its own vertex list (local space, relative to the
 * entity's transform), rather than ShapeRenderer's fixed rect/circle choices. A PolygonCollider
 * attached to the same entity reads its shape from here live (see PolygonCollider's constructor
 * comment) - there's deliberately only one vertex list, not a separate copy for rendering vs.
 * collision, so editing these vertices (with the pen tool) keeps both in sync automatically.
 *
 * Each vertex is `{x, y}`, optionally with a `curve: {x, y}` control point - when present, the edge
 * from that vertex to the next one is drawn as a quadratic Bezier through that control point
 * instead of a straight line (see `draw()`), for rounding off a corner rather than leaving it sharp.
 * A vertex with no `curve` behaves exactly as before, so existing straight-edged shapes need no
 * changes. The shape must still end up convex overall - PolygonCollider tessellates each curve into
 * short straight segments for collision (see its own `#tessellate`), and that collision math is a
 * hard convex-only requirement (see PolygonCollider's own doc comment); nothing here stops you from
 * curving your way into a concave shape, the same way nothing stops a straight-edge drag from doing
 * it today - it just won't collide correctly if you do.
 */
export class PolygonRenderer extends Component {
    static description = "Draws the entity's polygon, the same shape its collider uses. Holds the vertices.";

    static fields = [
        // Not a normal Inspector input - only ever meant to be edited with the pen tool (see
        // Inspector's 'vertices' field type) - but still listed here so SceneIO's generic
        // component-field save/restore round-trips it like any other field.
        { key: 'vertices', label: 'Vertices', type: 'vertices' },
        { key: 'color', label: 'Color', type: 'color', animatable: true },
        { key: 'strokeColor', label: 'Stroke Color', type: 'color', animatable: true },
        { key: 'strokeWidth', label: 'Stroke Width', type: 'number', animatable: true },
        { key: 'opacity', label: 'Opacity', type: 'number', animatable: true },
        // Lower draws first (further back); entities tie-break by their insertion order. Read by
        // Entity.getSortingOrder(), which GameLoop's render pass sorts entities with - any
        // renderer component can opt into this ordering just by having this same field name.
        { key: 'sortingOrder', label: 'Order', type: 'number' },
    ];

    constructor({ vertices, color = '#4a90d9', strokeColor = '#2c5a8a', strokeWidth = 2, sortingOrder = 0 } = {}) {
        super();
        this.vertices = (vertices ?? PolygonRenderer.defaultVertices()).map(v => ({ x: v.x, y: v.y }));
        this.color = color;
        this.strokeColor = strokeColor;
        this.strokeWidth = strokeWidth;
        this.sortingOrder = sortingOrder;
        this.opacity = 1; // 0..1
    }

    /** A small placeholder diamond, so a freshly-added Polygon entity is visible (and has a valid
     * convex shape to collide as) before the pen tool gives it a real one. */
    static defaultVertices() {
        return [{ x: 0, y: -25 }, { x: 25, y: 0 }, { x: 0, y: 25 }, { x: -25, y: 0 }];
    }

    draw(ctx) {
        if (this.vertices.length < 3) return;
        ctx.globalAlpha *= this.opacity;
        const n = this.vertices.length;
        ctx.beginPath();
        ctx.moveTo(this.vertices[0].x, this.vertices[0].y);
        for (let i = 0; i < n; i++) {
            const v = this.vertices[i];
            const next = this.vertices[(i + 1) % n];
            if (v.curve) ctx.quadraticCurveTo(v.curve.x, v.curve.y, next.x, next.y);
            else ctx.lineTo(next.x, next.y);
        }
        ctx.closePath();
        ctx.fillStyle = this.color;
        ctx.fill();
        if (this.strokeColor && this.strokeWidth > 0) {
            ctx.strokeStyle = this.strokeColor;
            ctx.lineWidth = this.strokeWidth;
            ctx.stroke();
        }
    }
}

ComponentRegistry.register('PolygonRenderer', PolygonRenderer, 'engine');
