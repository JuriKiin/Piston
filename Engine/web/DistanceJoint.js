import { Component } from './Component.js';
import { ComponentRegistry } from './ComponentRegistry.js';
import { solveDistance } from './Physics/DistanceConstraint.js';

/**
 * Keeps its entity a fixed distance from another entity, or from a fixed point: a rod, a tether, a pendulum arm, a leash. The loop solves it once per
 * simulation step after every entity has moved and before collisions, so it is deterministic under the fixed step.
 *
 * Aim it from a script: `joint.target = otherEntity` (a reference cannot be an Inspector field), or leave `target` empty and set `Anchor X/Y`, a fixed world point.
 * Bodies without a Rigidbody (moved by script), static bodies and `Pin this entity` are never moved by the joint; a dynamic Rigidbody is moved in proportion
 * to its inverse mass and keeps the correction as velocity, so it swings. `Rope` makes the joint only pull when stretched (a slack rope). Lower `Stiffness`
 * for a springy joint; raise `Iterations` for a stiffer result when several joints share a body.
 */
export class DistanceJoint extends Component {
    static description = 'Keeps this entity a fixed distance from another entity or a fixed point (rod, tether, pendulum). Set `target` from a script.';

    static fields = [
        { key: 'length', label: 'Length (px)', type: 'number', animatable: true },
        { key: 'stiffness', label: 'Stiffness (0-1)', type: 'number', animatable: true },
        { key: 'damping', label: 'Damping (0-1)', type: 'number' },
        { key: 'rope', label: 'Rope (only pulls)', type: 'checkbox' },
        { key: 'pinSelf', label: 'Pin this entity', type: 'checkbox' },
        { key: 'iterations', label: 'Iterations', type: 'number' },
        { key: 'anchorX', label: 'Anchor X (no target)', type: 'number', animatable: true },
        { key: 'anchorY', label: 'Anchor Y (no target)', type: 'number', animatable: true },
    ];

    constructor({ length = 100, stiffness = 1, damping = 0, rope = false, pinSelf = false, iterations = 4, anchorX = 0, anchorY = 0 } = {}) {
        super();
        Object.assign(this, { length, stiffness, damping, rope, pinSelf, iterations, anchorX, anchorY });
        this.target = null; // the other entity; set from code
    }

    start() { if (this.entity) this.entity._hasJoints = true; }

    /** Sets `length` to the current distance to the target (or anchor), so the joint starts relaxed. */
    useCurrentLength() {
        const p = this.entity.transform.position, q = this.target ? this.target.transform.position : { x: this.anchorX, y: this.anchorY };
        this.length = Math.hypot(q.x - p.x, q.y - p.y);
        return this.length;
    }

    /** One solve pass (called by GameLoop each step; `iterations` times). Returns the distance error before the last pass. */
    solve() {
        if (!this.entity || (this.target && (this.target.destroyed || this.target.active === false))) return 0;
        let err = 0;
        for (let i = 0; i < Math.max(1, this.iterations | 0); i++) {
            err = solveDistance(this.entity, this.target, this.length, { anchor: { x: this.anchorX, y: this.anchorY }, stiffness: this.stiffness, maxOnly: this.rope, pinA: this.pinSelf, damping: this.damping });
        }
        return err;
    }
}

ComponentRegistry.register('DistanceJoint', DistanceJoint, 'engine');
