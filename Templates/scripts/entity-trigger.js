// @template: Trigger Zone
// @kind: entity
// @summary: An invisible-ish area that notices when another entity enters it (goals, pickups, hazards).
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

    constructor(position, radius = 32) {
        super();
        this.tag = '{{Class}}';
        this.position = position ?? new Vector2(0, 0);
        this.radius = radius;
        this.color = 'rgba(80, 200, 120, 0.35)';
        this.triggered = false;
    }

    start() {
        this.transform.position = this.position.clone();
        this.transform.size = new Vector2(this.radius * 2, this.radius * 2);

        const body = new Rigidbody();
        body.isStatic = true;
        body.useGravity = false;
        body.collider = new CircleCollider(this, this.radius);
        body.collider.isTrigger = true; // detects overlaps without physically blocking anything
        body.collider.onCollisionEnter = (otherCollider) => this.onTriggered(otherCollider.entity);
        this.rigidbody = body;

        this.renderer = this.addComponent(new ShapeRenderer({ shape: 'circle', color: this.color, radius: this.radius }));
    }

    /** Called when another entity enters the zone. */
    onTriggered(other) {
        if (this.triggered) return;
        this.triggered = true;
        console.log(`${other.tag} entered {{Class}}`);
    }

    // Anything that changes while playing and should reset when you press Stop belongs here.
    captureEditState() {
        const state = super.captureEditState();
        state.triggered = this.triggered;
        return state;
    }

    restoreEditState(state) {
        super.restoreEditState(state);
        this.triggered = state.triggered;
    }
}

EntityRegistry.register('{{Class}}', {{Class}}, 'Game');
