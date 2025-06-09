import { Entity } from "../engine/Entity.js";
import { Input } from "../engine/Input.js";

export class Pong extends Entity {
    constructor(ball) {
        super(null, null, "Pong");
        this.started = false;
        this.ball = ball;
        this.input = new Input();
    }

    start(canvas) {}

    update(ctx) {
        super.update(ctx);
        if (this.input.getKeyUp('Space') && !this.started) {
            this.ball.launch();
            this.started = true;
        }
    }

    draw(ctx) {

    }
}