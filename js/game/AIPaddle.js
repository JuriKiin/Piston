import { Entity } from "../engine/Entity.js";
import { BoxCollider } from "../engine/Physics/Colliders/BoxCollider.js";
import { Rigidbody } from "../engine/Physics/Rigidbody.js";
import { Vector2 } from "../engine/Physics/Vector2.js";

export class AIPaddle extends Entity{
    constructor(paddle, ball) {
        super();
        this.paddle = paddle;
        this.ball = ball;
        this.speed = 5; // Speed of the AI paddle
        this.tag = "Paddle";
    }

    start(canvas) {
        this.transform.position = new Vector2(
            canvas.width / 2,
            30
        );
        
        this.maxWidth = canvas.width;

        this.rigidbody = new Rigidbody();
        this.rigidbody.useGravity = false;
        this.rigidbody.isStatic = true;
        this.rigidbody.collider = new BoxCollider(this, this.paddle.size.x, this.paddle.size.y);
    }

    update(ctx) {
        super.update(ctx);

        this.transform.position.x = this.ball.transform.position.x
    }

    draw(ctx) {
        ctx.beginPath();
        ctx.fillStyle = "#ead543"; // Color for the AI paddle
        ctx.fillRect(
            this.transform.position.x - this.paddle.size.x / 2, // Corrected X
            this.transform.position.y - this.paddle.size.y / 2, // Corrected Y
            this.paddle.size.x,
            this.paddle.size.y
        );
        ctx.closePath();
    }
}