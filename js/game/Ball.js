import { Entity } from '../engine/Entity.js';
import { Rigidbody } from '../engine/Physics/Rigidbody.js';
import { Vector2 } from '../engine/Physics/Vector2.js';
import { Input } from '../engine/Input.js';
import { CircleCollider } from '../engine/Physics/Colliders/CircleCollider.js';
import { PhysicsMaterial } from '../engine/Physics/PhysicsMaterial.js';

export class Ball extends Entity {
    constructor(transform, renderer, rigidbody) {
        super(transform, renderer, rigidbody);
        
        this.input = new Input();
        this.moveSpeed = 300;
        this.size = 20;
    }

    start(canvas) {
        this.tag = 'Ball';
        let t = this.transform;
        t.size = this.size;
        this.transform = t;
    
        this.transform.position = new Vector2(canvas.width / 2, canvas.height / 2);

        let rb = new Rigidbody();
        rb.mass = 1;

        rb.useGravity = false;
        rb.collider = new CircleCollider(this, this.size);
        rb.physicsMaterial = PhysicsMaterial.Frictionless;

        this.rigidbody = rb;
    }

    draw(ctx) {
        ctx.beginPath();
        ctx.arc(this.transform.position.x, this.transform.position.y, this.transform.size, 0, Math.PI * 2);
        ctx.fillStyle = '#abc123';
        ctx.fill();
        ctx.closePath();
    }

    update(ctx) {
        super.update(ctx);
    }

    onCollisionEnter(other) {
        if (other.tag === 'Paddle') {
            console.log("Colliding");
            this.rigidbody.velocity.y *= -1;
            this.rigidbody.velocity.x += (Math.random() - 0.5) * 10;
        }
        else if (other.tag === 'Wall') {
            console.log(this.rigidbody.velocity)
            this.rigidbody.velocity.x *= -1; // Reverse horizontal velocity on wall collision
        }
    }

    //Custom methods
    launch() {
        this.rigidbody.velocity = new Vector2(
            (Math.random() < 0.5 ? -1 : 1) * this.moveSpeed,
            this.moveSpeed
        );
    }
}