import { Entity } from "@piston/Entity.js";
import { PhysicsMaterial } from "@piston/Physics/PhysicsMaterial.js";
import { Rigidbody } from "@piston/Physics/Rigidbody.js";
import { Vector2 } from "@piston/Physics/Vector2.js";
import { ShapeRenderer } from "@piston/ShapeRenderer.js";
import { Component } from "@piston/Component.js";
import { ComponentRegistry } from "@piston/ComponentRegistry.js";
import { PolygonCollider } from "@piston/Physics/Colliders/PolygonCollider.js";
import { EntityRegistry } from "@piston/EntityRegistry.js";

export class SandTrap extends Entity {
    constructor(position, radius = 20) {
        super();
        this.tag = 'SandTrap';
        this.position = position ?? new Vector2(0, 0);
        this.radius = radius;
    }

    start() {
        this.transform.position = this.position.clone();
        this.transform.size = new Vector2(this.radius * 2, this.radius * 2);

        const rb = new Rigidbody();
        rb.isStatic = true;
        rb.useGravity = false;
        rb.mass = 0;
        rb.physicsMaterial = PhysicsMaterial.Default;
        rb.collider = new PolygonCollider(this, 4, this.radius * 2, this.radius * 2);
        rb.collider.isTrigger = true;
        this.rigidbody = rb;

        this.addComponent(new ShapeRenderer({
            shape: 'rect', color: '#d1bc95', strokeColor: '#8a5a1a', strokeWidth: 3, radius: this.radius
        }));

        this.addComponent(new SlowZone({ slowFactor: 0.5 }));
        rb.collider.onCollisionEnter = (other) => {
            this.getComponent(SlowZone)?.onEnter(other);
        }
    }

    captureEditState() {
        const state = super.captureEditState();
        state.sunk = this.sunk;
        return state;
    }

    restoreEditState(state) {
        super.restoreEditState(state);
        this.sunk = state.sunk;
    }
}

EntityRegistry.register('SandTrap', SandTrap, 'Golf');


export class SlowZone extends Component {
    static fields = [
        { key: 'slowFactor', label: 'Slow Factor', type: 'number' },
    ];

    constructor({ slowFactor = 0.5 } = {}) {
        super();
        this.slowFactor = slowFactor;
    }

    onEnter(other) {
        if (other.entity.tag === "Ball") {
            other.entity.rigidbody.velocity.scale(this.slowFactor);
        }
    }
}




ComponentRegistry.register('SlowZone', SlowZone, 'game');