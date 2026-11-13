import { Entity } from "@piston/Entity.js";
import { CircleCollider } from "@piston/Physics/Colliders/CircleCollider.js";
import { PhysicsMaterial } from "@piston/Physics/PhysicsMaterial.js";
import { Rigidbody } from "@piston/Physics/Rigidbody.js";
import { Vector2 } from "@piston/Physics/Vector2.js";
import { ShapeRenderer } from "@piston/ShapeRenderer.js";
import { EntityRegistry } from "@piston/EntityRegistry.js";

export class Bumper extends Entity {
    constructor(position, radius = 20) {
        super();
        this.tag = 'Bumper';
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
        rb.physicsMaterial = PhysicsMaterial.Bouncy;
        rb.collider = new CircleCollider(this, this.radius);
        this.rigidbody = rb;

        this.addComponent(new ShapeRenderer({
            shape: 'circle', color: '#e0a83e', strokeColor: '#8a5a1a', strokeWidth: 3, radius: this.radius
        }));
    }
}

EntityRegistry.register('Bumper', Bumper, 'Golf');
