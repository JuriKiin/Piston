import { Entity } from './Entity.js';
import { PolygonCollider } from './Physics/Colliders/PolygonCollider.js';
import { Rigidbody } from './Physics/Rigidbody.js';
import { Vector2 } from './Physics/Vector2.js';
import { PolygonRenderer } from './PolygonRenderer.js';
import { EntityRegistry } from './EntityRegistry.js';

/**
 * A generic custom-shaped entity: whatever convex polygon its PolygonRenderer currently holds is
 * both what gets drawn AND what it collides as (PolygonCollider reads that renderer's vertices
 * live - see its constructor comment). This is the shape the pen tool sculpts, rather than a
 * fixed-purpose gameplay entity like Wall or Bumper.
 */
export class Polygon extends Entity {
    static description = "A custom-shaped solid. Its polygon is both what is drawn and what collides. Edit its points with the vertex tool in the Scene view.";

    constructor(position, vertices) {
        super();
        this.tag = 'Polygon';
        this.startPosition = position ?? new Vector2(0, 0);
        this.startVertices = vertices ?? null;
    }

    start() {
        this.transform.position = this.startPosition.clone();

        this.renderer = this.addComponent(new PolygonRenderer({ vertices: this.startVertices }));

        const rb = new Rigidbody();
        rb.mass = 0;
        rb.useGravity = false;
        rb.isStatic = true;
        rb.collider = new PolygonCollider(this);
        this.rigidbody = rb;
    }
}

EntityRegistry.register('Polygon', Polygon, 'Shapes');
