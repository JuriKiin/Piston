import { Entity } from "../engine/Entity.js";
import { Vector2 } from "../engine/Physics/Vector2.js";
import { Rigidbody } from "../engine/Physics/Rigidbody.js";
import { BoxCollider } from "../engine/Physics/Colliders/BoxCollider.js";
import { Input } from "../engine/Input.js";

export class Paddle extends Entity {
    constructor(size) {
        super();
        this.size = size ?? new Vector2(200, 20);
        this.tag = "Paddle";
        this.moveSpeed = 200;
    }

    start(canvas) {
        this.startPosition = new Vector2(canvas.width / 2, canvas.height - 30);
        this.transform.position = this.startPosition;
        this.transform.size = this.size;

        this.rigidbody = new Rigidbody();
        this.rigidbody.useGravity = false;
        this.rigidbody.isStatic = true;
        this.rigidbody.collider = new BoxCollider(this, this.size.x, this.size.y);

        this.input = new Input();
    }

    update(ctx) {
        super.update(ctx);

        if (this.input && this.input instanceof Input) {
            this.rigidbody.velocity = new Vector2(0, 0); // Reset velocity each frame
            if (this.input.getKeyDown('ArrowLeft') || this.input.getKeyDown('KeyA')) {
                this.rigidbody.addForce(Vector2.Left.scale(this.moveSpeed));
            }
            if (this.input.getKeyDown('ArrowRight') || this.input.getKeyDown('KeyD')) {
                this.rigidbody.addForce(Vector2.Right.scale(this.moveSpeed));
            }
        }

        this.input.lateUpdate();

    }

    draw(ctx) {
        ctx.beginPath();
        ctx.fillStyle = "black"
        ctx.fillRect(
            this.transform.position.x - this.size.x / 2, // Corrected X
            this.transform.position.y - this.size.y / 2, // Corrected Y
            this.size.x,
            this.size.y
        );
        ctx.closePath();
    }
}