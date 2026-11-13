import { Entity } from "@piston/Entity.js";
import { CircleCollider } from "@piston/Physics/Colliders/CircleCollider.js";
import { PhysicsMaterial } from "@piston/Physics/PhysicsMaterial.js";
import { Rigidbody } from "@piston/Physics/Rigidbody.js";
import { Vector2 } from "@piston/Physics/Vector2.js";
import { SpriteRenderer } from "@piston/SpriteRenderer.js";
import { EntityRegistry } from "@piston/EntityRegistry.js";

/** A rock the ball bounces off: a solid, slightly bouncy circle drawn with one of three pixel-art rocks (`variant` 0-2). */
export class Rock extends Entity {
    static fields = [
        { key: 'radius', label: 'Radius', type: 'number' },
        { key: 'variant', label: 'Variant (0-2)', type: 'number' },
    ];

    constructor(position, radius = 18) {
        super();
        this.tag = 'Rock';
        this.position = position ?? new Vector2(0, 0);
        this._radius = radius;
        this._variant = 0;
    }

    // Saved fields are applied after start(), so these setters keep the collider, size and picture in step.
    get radius() { return this._radius; }
    set radius(r) {
        this._radius = r;
        if (this.transform?.size) this.transform.size = new Vector2(r * 2.3, r * 2.3);
        if (this.rigidbody?.collider) this.rigidbody.collider.radius = r;
    }

    get variant() { return this._variant; }
    set variant(v) {
        this._variant = v;
        if (this.renderer) { this.renderer.playing = false; this.renderer.currentFrame = Math.max(0, Math.min(2, Math.round(v))); }
    }

    start() {
        this.transform.position = this.position.clone();
        this.transform.size = new Vector2(this._radius * 2.3, this._radius * 2.3);

        const rb = new Rigidbody();
        rb.isStatic = true;
        rb.useGravity = false;
        rb.mass = 0;
        rb.physicsMaterial = new PhysicsMaterial(0.1, 0.55);
        rb.collider = new CircleCollider(this, this._radius);
        this.rigidbody = rb;

        this.renderer = this.addComponent(new SpriteRenderer({
            imagePath: './assets/art/rocks.png', frameWidth: 32, frameHeight: 32, frameCount: 3, columns: 3, fps: 0, sortingOrder: 2,
        }));
        this.renderer.pixelArt = true;
        this.renderer.playing = false;
        this.renderer.currentFrame = Math.max(0, Math.min(2, Math.round(this._variant)));
    }
}

EntityRegistry.register('Rock', Rock, 'Golf');
