import { Entity } from "../engine/Entity.js";
import { PolygonCollider } from "../engine/Physics/Colliders/PolygonCollider.js";
import { Rigidbody } from "../engine/Physics/Rigidbody.js";
import { Vector2 } from "../engine/Physics/Vector2.js";
import { SpriteRenderer } from "../engine/SpriteRenderer.js";

export class Gruff extends Entity {
    constructor() {
        super();
        this.tag = "Gruff";
        this.spriteRenderer = new SpriteRenderer("js/game/assets/gruff.png");
        this.rigidbody = new Rigidbody();
        this.rigidbody.useGravity = false;
        this.rigidbody.collider = new PolygonCollider(this, 4, this.transform.size.x, this.transform.size.y);
    }

    start(canvas) {
        this.transform.position = new Vector2(canvas.width / 2, canvas.height / 2 - 200);
        this.transform.size = new Vector2(45, 45); // Set size of Gruff
        this.rigidbody.collider = new PolygonCollider(this, 4, this.transform.size.x, this.transform.size.y);

    }

    update(ctx) {
        super.update(ctx);
        this.rigidbody.collider.drawCollider(ctx);
    }

    draw(ctx) {

        ctx.save();
        ctx.fillStyle = '#a2e036';
        ctx.fillRect(
            -this.transform.size.x / 2,
            -this.transform.size.y / 2,
            this.transform.size.x,
            this.transform.size.y
        );
        ctx.restore();

        // if (this.spriteRenderer) {
        //     this.spriteRenderer.draw(ctx, this.transform);
        // }
    }
}
