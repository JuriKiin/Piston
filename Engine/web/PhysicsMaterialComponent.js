import { Component } from './Component.js';
import { ComponentRegistry } from './ComponentRegistry.js';
import { PhysicsMaterial } from './Physics/PhysicsMaterial.js';
import Constants from './static/Constants.js';

/**
 * The "PhysicsMaterial" component: gives an entity a physics material (friction + bounce) from the Inspector,
 * the same PhysicsMaterial the engine already puts on rigidbodies in code.
 *
 *  - Solid collider: the entity's own rigidbody gets the material (a bouncy bumper, a slick wall).
 *  - Zone (a trigger collider, or "Zone" ticked): bodies INSIDE it get the material while they are in it, and get it
 *    back to normal when they leave (sand, ice, mud). "boost" additionally pushes them along the entity's facing.
 *
 * Presets fill in friction/restitution/boost; kind "custom" uses your numbers as-is. A blank friction or bounce
 * means "leave that value alone".
 */
export class PhysicsMaterialComponent extends Component {
    static description = "Gives an entity friction and bounce. On a solid it sets the entity's own material; as a zone (trigger) it changes bodies passing through it (sand, ice, mud, boost).";

    static fields = [
        { key: 'kind', label: 'Preset', type: 'select', options: ['turf', 'sand', 'ice', 'mud', 'bouncy', 'boost', 'custom'] },
        { key: 'friction', label: 'Friction', type: 'number' },
        { key: 'restitution', label: 'Bounce', type: 'number' },
        { key: 'boost', label: 'Boost (speed/s)', type: 'number' },
        { key: 'zone', label: 'Zone (affects bodies inside)', type: 'checkbox' },
        { key: 'affectTag', label: 'Zone affects tag', type: 'text' },
    ];

    static PRESETS = {
        turf: { friction: 0.02, restitution: 0.4, boost: 0 },
        sand: { friction: 0.25, restitution: 0.1, boost: 0 },
        ice: { friction: 0.0, restitution: 0.3, boost: 0 },
        mud: { friction: 0.6, restitution: 0.0, boost: 0 },
        bouncy: { friction: 0.1, restitution: 0.9, boost: 0 },
        boost: { friction: null, restitution: null, boost: 400 },
    };

    constructor({ kind = 'turf', friction = null, restitution = null, boost = null, zone = false, affectTag = 'Ball' } = {}) {
        super();
        this.kind = kind;
        // Blank means "use the preset": copying the preset's numbers in here would freeze them, so a scene that later sets `kind`
        // (saved files and the Inspector both do this AFTER the component is built) would keep the old kind's values.
        this.friction = friction;
        this.restitution = restitution;
        this.boost = boost;
        this.zone = zone;
        this.affectTag = affectTag;
        this.inside = new Set();
        this.hooked = false;
    }

    /** Effective numbers: a preset's values apply unless the kind is "custom". */
    resolved() {
        if (this.kind === 'custom') return { friction: this.friction, restitution: this.restitution, boost: this.boost ?? 0 };
        const p = PhysicsMaterialComponent.PRESETS[this.kind] ?? {};
        return { friction: this.friction ?? p.friction ?? null, restitution: this.restitution ?? p.restitution ?? null, boost: this.boost ?? p.boost ?? 0 };
    }

    #materialFor(base) {
        const { friction, restitution } = this.resolved();
        return new PhysicsMaterial(friction ?? base?.friction ?? 0.1, restitution ?? base?.restitution ?? 0.2);
    }

    #hook() {
        const collider = this.entity?.rigidbody?.collider;
        if (!collider) return;
        this.hooked = true;
        if (!(this.zone || collider.isTrigger)) { // solid: it is this entity's own material
            this.entity.rigidbody.physicsMaterial = this.#materialFor(this.entity.rigidbody.physicsMaterial);
            return;
        }
        collider.isTrigger = true;
        const enter = collider.onCollisionEnter?.bind(collider);
        const exit = collider.onCollisionExit?.bind(collider);
        collider.onCollisionEnter = (other) => { enter?.(other); this.onEnter(other); };
        collider.onCollisionExit = (other) => { exit?.(other); this.onExit(other); };
    }

    onEnter(otherCollider) {
        const rb = otherCollider?.entity?.rigidbody;
        if (!rb || (this.affectTag && otherCollider.entity.tag !== this.affectTag) || this.inside.has(rb)) return;
        this.inside.add(rb);
        const { friction, restitution } = this.resolved();
        if (friction != null || restitution != null) {
            rb._surfaceOriginal ??= rb.physicsMaterial;
            rb._surfaceDepth = (rb._surfaceDepth ?? 0) + 1;
            rb.physicsMaterial = this.#materialFor(rb._surfaceOriginal);
        }
    }

    onExit(otherCollider) {
        const rb = otherCollider?.entity?.rigidbody;
        if (!rb || !this.inside.delete(rb)) return;
        const { friction, restitution } = this.resolved();
        if ((friction != null || restitution != null) && --rb._surfaceDepth <= 0) {
            rb.physicsMaterial = rb._surfaceOriginal;
            rb._surfaceOriginal = undefined;
            rb._surfaceDepth = 0;
        }
    }

    update() {
        if (!this.hooked) this.#hook();
        const { boost } = this.resolved();
        if (!boost || this.inside.size === 0) return;
        const a = (this.entity.transform.rotation ?? 0) * Math.PI / 180;
        const dt = Constants.DELTA_TIME || 1 / 60;
        for (const rb of this.inside) {
            rb.velocity.x += Math.cos(a) * boost * dt;
            rb.velocity.y += Math.sin(a) * boost * dt;
        }
    }
}

ComponentRegistry.register('PhysicsMaterial', PhysicsMaterialComponent, 'engine');
