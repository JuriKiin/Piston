import { Vector2 } from "./Vector2.js";
import { PhysicsMaterial } from "./PhysicsMaterial.js";
import Constants from "../Constants.js";

export class Rigidbody {
    constructor(velocity, gravity, useGravity, mass, physicsMaterial, collider) {
        this.velocity = velocity ?? new Vector2(0);
        this.gravity = gravity ?? Constants.GRAVITY;
        this.useGravity = useGravity ?? true;
        this.mass = mass ?? 1000;
        this.isStatic = false;
        this.physicsMaterial = physicsMaterial ?? PhysicsMaterial.Default;
        this.collider = collider ?? null;
    }

    update() {
        if (this.velocity instanceof Vector2) {
            if (this.useGravity) this.velocity.y -= this.gravity;

            this.velocity.multiply(new Vector2(1 - this.physicsMaterial.friction, 1));
        }
    }

    addForce(vector2) {
        if (vector2 instanceof Vector2) {
            this.velocity.add(vector2);
        } else {
            console.error("addForce expects a Vector2 instance");
        }
    }

    stop() {
        this.velocity = new Vector2(0, 0);
    }
}