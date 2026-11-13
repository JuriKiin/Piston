import { Entity } from "@piston/Entity.js";
import { CircleCollider } from "@piston/Physics/Colliders/CircleCollider.js";
import { PolygonCollider } from "@piston/Physics/Colliders/PolygonCollider.js";
import { Rigidbody } from "@piston/Physics/Rigidbody.js";
import { Vector2 } from "@piston/Physics/Vector2.js";
import Constants from "@piston/static/Constants.js";
import Input from "@piston/static/Input.js";
import { ShapeRenderer } from "@piston/ShapeRenderer.js";

const DEFAULT_COLOR = '#333333';
const HIT_COLOR = '#ba3e0d';

export class Player extends Entity {
    constructor() {
        super();
        this.tag = 'Player';
        this.speed = 500;
    }

    start(canvas) {
        this.transform.size = new Vector2(200, 50);
        this.transform.position = new Vector2(canvas.width / 2, canvas.height / 2);

        let rb = new Rigidbody();
        rb.mass = 1;
        rb.useGravity = false;
        rb.collider = new PolygonCollider(this, 4, this.transform.size.x, this.transform.size.y);
        rb.isStatic = true;

        this.rigidbody = rb;

        this.renderer = this.addComponent(new ShapeRenderer({ shape: 'rect', color: DEFAULT_COLOR }));

        this.rigidbody.collider.onCollisionEnter = ((other) => {
            if (other.entity.tag === 'Gruff') { this.renderer.color = HIT_COLOR; }
        });
        this.rigidbody.collider.onCollisionExit = ((other) => {
            console.log("Exit");
            if (other.entity.tag === 'Gruff') { this.renderer.color = DEFAULT_COLOR; }
        });
    }

    update() {
        super.update();

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
            this.rigidbody.velocity = moveDirection.normalize().scale(this.speed * Constants.DELTA_TIME);
        } else {
            this.rigidbody.velocity = new Vector2(0, 0);
        }
    }
}
