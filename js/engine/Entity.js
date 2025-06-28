import { Transform } from "./Transform.js";
import MathLib from "./static/Math.js";

export class Entity {
    constructor(transform, rigidbody, tag) {
        this.id = (+new Date()).toString(16) + (Math.random() * 100000000 | 0).toString(16);
        this.transform = transform ?? new Transform(null, 0, 20);
        this.rigidbody = rigidbody ?? null;
        this.tag = tag ?? "Entity";
    }

    update(ctx) {
        if (this.rigidbody) {
            this.rigidbody.update(this.transform);
        }
        this.transform.update(this.rigidbody);

        if (this.rigidbody && this.rigidbody.collider) {
            this.rigidbody.collider.getBounds(); // Ensure collider is updated after transform
        }

        ctx.save();
        ctx.translate(this.transform.position.x, this.transform.position.y);
        
        const s = this.transform.rotation;
        const r = MathLib.degreesToRadians(this.transform.rotation);

        ctx.rotate(MathLib.degreesToRadians(this.transform.rotation));
        this.draw(ctx);
        ctx.restore();
    }

    start(canvas) {
        throw new Error("isColliding method must be implemented in subclasses.");
    }

    draw(ctx) {
        throw new Error("draw method must be implemented in subclasses.");
    }

    onCollisionEnter(other) {}
    onCollisionExit(other) {}
}