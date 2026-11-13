import { Component } from './Component.js';
import { ComponentRegistry } from './ComponentRegistry.js';
import { Layers, CollisionMatrix } from './Physics/CollisionMatrix.js';

const NAMES = Object.keys(Layers);

/**
 * Puts the entity's collider on a named collision layer and, optionally, makes that layer ignore others. Layers let some things pass
 * through each other: a ball that is "in" one section of a hole shouldn't be held in by another section's boundary, a ghost can
 * walk through walls, a bullet skips the shooter.
 *
 * `Ignores` is a comma-separated list of layer names ("Enemy, Pickup"). Ignoring is symmetric and applies to the whole game.
 */
export class CollisionLayerComponent extends Component {
    static description = "Puts this entity's collider on a collision layer and lists layers it should not collide with.";

    static fields = [
        { key: 'layer', label: 'Layer', type: 'select', options: NAMES },
        { key: 'ignores', label: 'Ignores (comma-separated layers)', type: 'text' },
    ];

    constructor({ layer = 'Default', ignores = '' } = {}) {
        super();
        this.layer = layer;
        this.ignores = ignores;
        this.applied = false;
    }

    // A scene builds a component before applying its saved fields, so the layer is applied on the first update(), when the values are known
    // (never in start(): that would apply the defaults and mark it done).
    update() { this.#apply(); }
    restoreState() { this.applied = false; }

    #apply() {
        if (this.applied) return;
        const collider = this.entity?.rigidbody?.collider;
        const mine = Layers[this.layer];
        if (!collider || mine === undefined) return;
        this.applied = true;
        collider.layer = mine;
        for (const name of String(this.ignores).split(',').map(s => s.trim()).filter(Boolean)) {
            if (Layers[name] !== undefined) CollisionMatrix.ignore(mine, Layers[name]);
        }
    }
}

ComponentRegistry.register('CollisionLayer', CollisionLayerComponent, 'engine');
