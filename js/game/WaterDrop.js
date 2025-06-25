import { Entity } from "../engine/Entity.js";
import { BoxCollider } from "../engine/Physics/Colliders/BoxCollider.js";
import { PhysicsMaterial } from "../engine/Physics/PhysicsMaterial.js";
import { Rigidbody } from "../engine/Physics/Rigidbody.js";
import { Vector2 } from "../engine/Physics/Vector2.js";
import Const from "../engine/static/Constants.js";

export class WaterDrop extends Entity {
    constructor(speed = 50, size = new Vector2(10, 10)) {
        super();
        this.tag = 'WaterDrop';
        this.speed = speed;
        this.transform.size = size;
        this.wanderTimer = 0;
        this.wanderDirection = new Vector2(0, 0);

        this.canvas = null; // Will be set in start method
    }

    start(canvas) {
        this.canvas = canvas;
        this.setRandomStartPosition(canvas);

        let rb = new Rigidbody();
        rb.mass = 1;
        rb.useGravity = true;
        rb.physicsMaterial = PhysicsMaterial.Frictionless;
        rb.collider = new BoxCollider(this, this.transform.size.x, this.transform.size.y);
        rb.isStatic = false;

        this.rigidbody = rb;
    }

    update(ctx) {
        super.update(ctx);
    }

    onCollisionEnter(other) {
        // if (other.tag === 'Wall') {
        //     this.rigidbody.velocity = new Vector2(0, -1);
        //     this.setRandomStartPosition(this.canvas, 30);
        // }
    }

    setRandomStartPosition(canvas, yPos) {
        this.transform.position = new Vector2(
            20 + Math.random() * (canvas.width - this.transform.size.x - 20) + this.transform.size.x / 2,
            yPos ?? Math.random() * (canvas.height - this.transform.size.y) + this.transform.size.y / 2
        );
    }

    draw(ctx) {
        ctx.fillStyle = 'blue';
        ctx.fillRect(
            -this.transform.size.x / 2,
            -this.transform.size.y / 2,
            this.transform.size.x,
            this.transform.size.y
        );
    }
}
