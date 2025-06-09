import { Transform } from "./Transform.js";

export class Entity {
    constructor(transform, rigidbody, tag) {
        this.id = (+new Date()).toString(16) + (Math.random() * 100000000 | 0).toString(16);
        this.transform = transform ?? new Transform(null, 20);
        this.rigidbody = rigidbody ?? null;
        this.tag = tag ?? "Entity";
    }

    update(ctx) {
        if (this.rigidbody) {
            this.rigidbody.update(this.transform);
        }

        //These should always be last in this order.
        this.transform.update(this.rigidbody);
        this.draw(ctx);
    }

    start(canvas) {
        throw new Error("isColliding method must be implemented in subclasses.");
    }

    draw(ctx) {
        throw new Error("draw method must be implemented in subclasses.");
    }

    onCollisionEnter(other) {}
}