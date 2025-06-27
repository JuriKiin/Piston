import { Entity } from "../engine/Entity.js";
import { CircleCollider } from "../engine/Physics/Colliders/CircleCollider.js";
import { PolygonCollider } from "../engine/Physics/Colliders/PolygonCollider.js";
import { PhysicsMaterial } from "../engine/Physics/PhysicsMaterial.js";
import { Rigidbody } from "../engine/Physics/Rigidbody.js";
import { Vector2 } from "../engine/Physics/Vector2.js";
import Input from "../engine/static/Input.js";

export class Player extends Entity {
    constructor() {
        super();
        this.tag = 'Player';
        this.speed = 300;
        this.color = '#333';
    }

    start(canvas) {
        this.transform.size = new Vector2(200, 50);
        this.transform.position = new Vector2(canvas.width / 2, canvas.height / 2);

        let rb = new Rigidbody();
        rb.mass = 1;
        rb.useGravity = false;
        rb.collider = new PolygonCollider(this, 4, this.transform.size.x, this.transform.size.y);
        rb.physicsMaterial = PhysicsMaterial.Frictionless;
        rb.isStatic = true;

        this.rigidbody = rb;

        this.rigidbody.collider.onCollisionEnter = ((other) => {
            if (other.entity.tag === 'Gruff') { this.color = '#ba3e0d'; }
        });
        this.rigidbody.collider.onCollisionExit = ((other) => {
            if (other.entity.tag === 'Gruff') { this.color = '#333'; }
        });
    }

    update(ctx) {
        super.update(ctx);
        this.rigidbody.collider.drawCollider(ctx);

        let moveDirection = new Vector2(0, 0);
        if (Input.getKeyDown('KeyW') || Input.getKeyDown('ArrowUp')) {
            moveDirection.y = -1;
        }
        if (Input.getKeyDown('KeyS') || Input.getKeyDown('ArrowDown')) {
            moveDirection.y = 1;
        }
        if (Input.getKeyDown('KeyA') || Input.getKeyDown('ArrowLeft')) {
            moveDirection.x = -1;
        }
        if (Input.getKeyDown('KeyD') || Input.getKeyDown('ArrowRight')) {
            moveDirection.x = 1;
        }

        if (Input.getKeyDown('KeyK')) {
            this.transform.rotate(10, 10);
        } else if (Input.getKeyDown('KeyL')) {
            this.transform.rotate(-10, 10);
        }

        if (moveDirection.magnitude() > 0) {
            this.rigidbody.velocity = moveDirection.normalize().scale(this.speed);
        } else {
            this.rigidbody.velocity = new Vector2(0, 0);
        }
    }

    draw(ctx) {
        ctx.fillStyle = this.color;
        ctx.fillRect(
            -this.transform.size.x / 2,
            -this.transform.size.y / 2,
            this.transform.size.x,
            this.transform.size.y
        );
    }
}
