import { Entity } from "@piston/Entity.js";
import { PolygonCollider } from "@piston/Physics/Colliders/PolygonCollider.js";
import { Rigidbody } from "@piston/Physics/Rigidbody.js";
import { Vector2 } from "@piston/Physics/Vector2.js";
import { ShapeRenderer } from "@piston/ShapeRenderer.js";
import { EntityRegistry } from "@piston/EntityRegistry.js";

export class Wall extends Entity {
    /**
     * @param {Vector2} [position]
     * @param {Vector2} [size]
     * @param {object} [options]
     * @param {boolean} [options.isInverse=false] Solid obstacle (default) vs. a containment
     *   boundary - see Collider's own isInverse doc for what that means.
     * @param {string} [options.color='#333333'] Fill color. A containment boundary sized to the
     *   whole play area usually wants this transparent - a solid fill that size would otherwise
     *   paint over everything else in the scene.
     * @param {string|null} [options.strokeColor=null] Outline color.
     * @param {number} [options.strokeWidth=0] Outline width.
     */
    constructor(position, size, options = {}) {
        super();
        this.position = position || new Vector2(0, 0);
        this.size = size || new Vector2(20, 20);
        this.tag = 'Wall';
        this.isInverse = options.isInverse ?? false;
        this.color = options.color ?? '#333333';
        this.strokeColor = options.strokeColor ?? null;
        this.strokeWidth = options.strokeWidth ?? 0;
    }

    start(canvas) {
        this.transform.position = this.position;
        this.transform.size = this.size;

        let rb = new Rigidbody();
        rb.mass = 0;
        rb.useGravity = false;
        rb.collider = new PolygonCollider(this, 4, this.size.x, this.size.y);
        rb.collider.enabled = true;
        rb.collider.isInverse = this.isInverse;
        rb.isStatic = true;

        this.rigidbody = rb;

        this.renderer = this.addComponent(new ShapeRenderer({
            shape: 'rect', color: this.color, strokeColor: this.strokeColor, strokeWidth: this.strokeWidth,
        }));
    }

    update() {
        super.update();
    }
}

EntityRegistry.register('Wall', Wall, 'Golf');