import { Entity } from "../engine/Entity.js";
import { PolygonCollider } from "../engine/Physics/Colliders/PolygonCollider.js";
import { PhysicsMaterial } from "../engine/Physics/PhysicsMaterial.js";
import { Rigidbody } from "../engine/Physics/Rigidbody.js";
import { Vector2 } from "../engine/Physics/Vector2.js";
import { SpriteRenderer } from "../engine/SpriteRenderer.js";
import input from "../engine/static/Input.js";

export class Gruff extends Entity {
    constructor() {
        super();
        this.tag = "Gruff";
        this.spriteRenderer = new SpriteRenderer("js/game/assets/gruff.png");
        this.rigidbody = new Rigidbody();
        this.rigidbody.useGravity = true;
        this.rigidbody.physicsMaterial = PhysicsMaterial.Bouncy;
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

        if (input.getKeyUp('Space')) {
            this.rigidbody.addForce(new Vector2(0, -5)); // Apply an upward force when space is pressed   
        }
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
