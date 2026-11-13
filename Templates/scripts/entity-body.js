// @template: Physics Body
// @kind: entity
// @summary: A moving circle with a collider. Starts with no gravity (top-down); add velocity in code.
import { Entity } from "@piston/Entity.js";
import { CircleCollider } from "@piston/Physics/Colliders/CircleCollider.js";
import { Rigidbody } from "@piston/Physics/Rigidbody.js";
import { Vector2 } from "@piston/Physics/Vector2.js";
import { ShapeRenderer } from "@piston/ShapeRenderer.js";
import { EntityRegistry } from "@piston/EntityRegistry.js";

export class {{Class}} extends Entity {
    static fields = [
        { key: 'radius', label: 'Radius', type: 'number' },
        { key: 'color', label: 'Color', type: 'color' },
    ];

    constructor(position, radius = 14) {
        super();
        this.tag = '{{Class}}';
        this.position = position ?? new Vector2(0, 0);
        this.radius = radius;
        this.color = '#4aa3ff';
    }

    start() {
        this.transform.position = this.position.clone();
        this.transform.size = new Vector2(this.radius * 2, this.radius * 2);

        const body = new Rigidbody();
        body.mass = 1;
        body.useGravity = false; // top-down; turn on for side-on games
        body.collider = new CircleCollider(this, this.radius);
        this.rigidbody = body;

        this.renderer = this.addComponent(new ShapeRenderer({ shape: 'circle', color: this.color, radius: this.radius }));
    }

    update() {
        super.update();
        // Move it by changing the body's velocity, e.g. this.rigidbody.velocity = new Vector2(120, 0);
    }

    onCollisionEnter(other) {
        // Called when this body hits another one.
    }
}

EntityRegistry.register('{{Class}}', {{Class}}, 'Game');
