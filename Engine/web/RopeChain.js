import { Component } from './Component.js';
import { ComponentRegistry } from './ComponentRegistry.js';
import { solveDistance } from './Physics/DistanceConstraint.js';

/**
 * A chain of entities joined end to end by distance constraints: a rope, a snake, a boss's body, a hanging bridge. Give it the links in order from a
 * script, `chain.setLinks([head, seg1, seg2, ...])`, and every simulation step it pulls consecutive links to `Segment length` apart (Gauss-Seidel, `Iterations`
 * sweeps per step, so the result is stable and identical every run). Links are ordinary entities with whatever sprites, colliders and Rigidbodies you like.
 *
 * `Pin first link` keeps the first link where it is (it is moved by script, like a boss head, or it is a fixed anchor). `Rope` lets the chain go slack:
 * links only pull toward each other when stretched, so a chain of links stacked on one point unfurls as its head moves away. With Rope off the links also
 * push apart to exactly `Segment length`. `Draw line` strokes a polyline through the links (put the component on the first link, or any entity). If a link
 * is destroyed or switched off the chain closes up around it on the next step; call `setLinks` again to change the membership.
 */
export class RopeChain extends Component {
    static description = 'Joins a list of entities end to end with distance constraints (rope, snake, chained boss). Give it the links from a script.';

    static fields = [
        { key: 'segmentLength', label: 'Segment length (px)', type: 'number', animatable: true },
        { key: 'stiffness', label: 'Stiffness (0-1)', type: 'number', animatable: true },
        { key: 'iterations', label: 'Iterations', type: 'number' },
        { key: 'damping', label: 'Damping (0-1)', type: 'number' },
        { key: 'rope', label: 'Rope (only pulls)', type: 'checkbox' },
        { key: 'pinFirst', label: 'Pin first link', type: 'checkbox' },
        { key: 'drawLine', label: 'Draw line', type: 'checkbox' },
        { key: 'lineWidth', label: 'Line width', type: 'number', animatable: true },
        { key: 'lineColor', label: 'Line color', type: 'color', animatable: true },
        { key: 'sortingOrder', label: 'Order', type: 'number' },
    ];

    constructor({ segmentLength = 40, stiffness = 1, iterations = 6, damping = 0, rope = false, pinFirst = true, drawLine = false, lineWidth = 4, lineColor = '#ffffff', sortingOrder = 0 } = {}) {
        super();
        Object.assign(this, { segmentLength, stiffness, iterations, damping, rope, pinFirst, drawLine, lineWidth, lineColor, sortingOrder });
        this.links = [];
    }

    start() { if (this.entity) this.entity._hasJoints = true; }

    /** Sets the chain's entities, first (head) to last. Replaces the previous list. */
    setLinks(entities) { this.links = [...entities]; return this; }

    /** The links that still exist and are switched on, in order. */
    get liveLinks() { return this.links.filter(e => e && !e.destroyed && e.active !== false); }

    /** One solve pass (called by GameLoop each step). Returns the largest stretch (px beyond Segment length) seen in the first sweep. */
    solve() {
        const links = this.liveLinks;
        let worst = 0;
        for (let it = 0; it < Math.max(1, this.iterations | 0); it++) {
            for (let i = 0; i + 1 < links.length; i++) {
                const err = solveDistance(links[i], links[i + 1], this.segmentLength, { stiffness: this.stiffness, maxOnly: this.rope, pinA: this.pinFirst && i === 0, damping: this.damping });
                if (it === 0 && err > worst) worst = err;
            }
        }
        return worst;
    }

    draw(ctx) {
        if (!this.drawLine) return;
        const links = this.liveLinks, t = this.entity?.transform;
        if (links.length < 2 || !t) return;
        const rot = -((t.rotation ?? 0) * Math.PI) / 180, cos = Math.cos(rot), sin = Math.sin(rot);
        ctx.strokeStyle = this.lineColor; ctx.lineWidth = this.lineWidth; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath();
        links.forEach((e, i) => {
            const dx = e.transform.position.x - t.position.x, dy = e.transform.position.y - t.position.y, x = dx * cos - dy * sin, y = dx * sin + dy * cos;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
    }
}

ComponentRegistry.register('RopeChain', RopeChain, 'engine');
