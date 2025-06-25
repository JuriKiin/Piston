import { Entity } from "../engine/Entity.js";
import { BoxCollider } from "../engine/Physics/Colliders/BoxCollider.js";
import { Rigidbody } from "../engine/Physics/Rigidbody.js";
import { Vector2 } from "../engine/Physics/Vector2.js";

export class Wall extends Entity {
    constructor(position, size) {
        super();
        this.position = position || new Vector2(0, 0);
        this.size = size || new Vector2(20, 20);
        this.tag = 'Wall';
    }

    start(canvas) {
        this.transform.position = this.position;

        let rb = new Rigidbody();
        rb.mass = 0;
        rb.useGravity = false;
        rb.collider = new BoxCollider(this, this.size.x, this.size.y);
        rb.isStatic = true;

        this.rigidbody = rb;
    }

    draw(ctx) {
        ctx.fillStyle = '#333';
        ctx.fillRect(
            -this.size.x / 2,
            -this.size.y / 2,
            this.size.x,
            this.size.y
        );
    }
}