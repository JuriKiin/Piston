import { Entity } from "@piston/Entity.js";
import { CircleCollider } from "@piston/Physics/Colliders/CircleCollider.js";
import { Rigidbody } from "@piston/Physics/Rigidbody.js";
import { Vector2 } from "@piston/Physics/Vector2.js";
import { SpriteRenderer } from "@piston/SpriteRenderer.js";
import { EntityRegistry } from "@piston/EntityRegistry.js";

/**
 * A tunnel mouth. (When the two ends are in separate sections, give each section's fairway a CollisionLayer so the ball is only held in by the
 * section it is in, and set `ballLayer` on the exit to the layer that section expects.) Two Tunnels with the same `linkId` are the two ends of one tunnel: a ball that rolls into an "entrance" (or "both")
 * reappears out of the other end, travelling the way that end points. At rotation 0 a mouth opens downward; rotate it to aim it.
 */
export class Tunnel extends Entity {
    static fields = [
        { key: 'linkId', label: 'Link id (pairs two mouths)', type: 'text' },
        { key: 'role', label: 'Role', type: 'select', options: ['entrance', 'exit', 'both'] },
        { key: 'exitSpeed', label: 'Exit speed', type: 'number' },
        { key: 'radius', label: 'Trigger radius', type: 'number' },
        { key: 'ballLayer', label: 'Ball layer when it comes out here', type: 'select', options: ['Player', 'Enemy', 'Default'] },
    ];

    constructor(position, radius = 20) {
        super();
        this.tag = 'Tunnel';
        this.position = position ?? new Vector2(0, 0);
        this._radius = radius;
        this._role = 'entrance';
        this.linkId = 'a';
        this.exitSpeed = 260;
        this.ballLayer = 'Player';
    }

    get radius() { return this._radius; }
    set radius(r) { this._radius = r; if (this.rigidbody?.collider) this.rigidbody.collider.radius = r; }

    get role() { return this._role; }
    set role(r) { this._role = r; if (this.renderer) this.renderer.currentFrame = r === 'entrance' ? 0 : 1; }

    start() {
        this.transform.position = this.position.clone();
        this.transform.size = new Vector2(92, 92);

        const rb = new Rigidbody();
        rb.isStatic = true;
        rb.useGravity = false;
        rb.collider = new CircleCollider(this, this._radius);
        rb.collider.isTrigger = true;
        rb.collider.onCollisionEnter = (other) => {
            const ball = other.entity;
            if (ball.tag !== 'Ball' || this.role === 'exit') return;
            const partner = window.Piston.gameLoop.entities.find(e => e instanceof Tunnel && e !== this && e.linkId === this.linkId && e.role !== 'entrance');
            if (partner) ball.enterTunnel(this, partner);
        };
        this.rigidbody = rb;

        this.renderer = this.addComponent(new SpriteRenderer({
            imagePath: './assets/art/tunnel.png', frameWidth: 48, frameHeight: 48, frameCount: 2, columns: 2, fps: 0, sortingOrder: 2,
        }));
        this.renderer.pixelArt = true;
        this.renderer.playing = false;
        this.renderer.currentFrame = this._role === 'entrance' ? 0 : 1;
    }
}

EntityRegistry.register('Tunnel', Tunnel, 'Golf');
