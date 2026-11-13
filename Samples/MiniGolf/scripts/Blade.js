import { Entity } from "@piston/Entity.js";
import { PolygonCollider } from "@piston/Physics/Colliders/PolygonCollider.js";
import { PhysicsMaterial } from "@piston/Physics/PhysicsMaterial.js";
import { Rigidbody } from "@piston/Physics/Rigidbody.js";
import { Vector2 } from "@piston/Physics/Vector2.js";
import { SpriteRenderer } from "@piston/SpriteRenderer.js";
import { EntityRegistry } from "@piston/EntityRegistry.js";

/**
 * One bar of a windmill: a solid rectangle with two sails, centred on its position. The spinning comes from an Animator on the same
 * entity (a "spin" clip animating rotation), which the editor shows in the Animation panel. Two blades at right angles make the windmill.
 */
export class Blade extends Entity {
    constructor(position, size) {
        super();
        this.tag = 'Blade';
        this.position = position ?? new Vector2(0, 0);
        this.size = size ?? new Vector2(220, 16);
    }

    start() {
        this.transform.position = this.position.clone();
        this.transform.size = this.size.clone();

        const rb = new Rigidbody();
        rb.isStatic = true;
        rb.useGravity = false;
        rb.mass = 0;
        rb.physicsMaterial = new PhysicsMaterial(0.1, 0.5);
        rb.collider = new PolygonCollider(this, 4, this.size.x, this.size.y);
        this.rigidbody = rb;

        this.renderer = this.addComponent(new SpriteRenderer({ imagePath: './assets/art/blade.png', sortingOrder: 5 }));
        this.renderer.pixelArt = true;
    }
}

EntityRegistry.register('Blade', Blade, 'Golf');
