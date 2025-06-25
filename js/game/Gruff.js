import { Entity } from "../engine/Entity.js";
import { BoxCollider } from "../engine/Physics/Colliders/BoxCollider.js";
import { CircleCollider } from "../engine/Physics/Colliders/CircleCollider.js";
import { Rigidbody } from "../engine/Physics/Rigidbody.js";
import { Vector2 } from "../engine/Physics/Vector2.js";
import { SpriteRenderer } from "../engine/SpriteRenderer.js";

export class Gruff extends Entity {
    constructor() {
        super();
        this.tag = "Gruff";
        this.spriteRenderer = new SpriteRenderer("js/game/assets/gruff.png");
        this.rigidbody = new Rigidbody();
        this.rigidbody.collider = new CircleCollider(this, 22.5); // Assuming Gruff is a circle with radius 22.5
    }

    start(canvas) {
        this.transform.position = new Vector2(canvas.width / 2, canvas.height / 2 - 200);
        this.transform.size = new Vector2(45, 45); // Set size of Gruff
    }

    update(ctx) {
        super.update(ctx);
        this.rigidbody.collider.drawCollider(ctx);
        this.rigidbody.collider.drawNormal(ctx);
    }

    draw(ctx) {
        if (this.spriteRenderer) {
            this.spriteRenderer.draw(ctx, this.transform);
        }
    }
}
