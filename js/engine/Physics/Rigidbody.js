import { Vector2 } from "./Vector2.js";
import { PhysicsMaterial } from "./PhysicsMaterial.js";
import Constants from "../static/Constants.js";

export class Rigidbody {
    constructor(velocity, gravity, useGravity, mass, physicsMaterial, collider, lockRotation = false) {
        this.velocity = velocity ?? Vector2.Zero;
        this.gravity = gravity ?? Constants.GRAVITY;
        this.useGravity = useGravity ?? true;
        this.mass = mass ?? 1000;
        this.isStatic = false;
        this.physicsMaterial = physicsMaterial ?? PhysicsMaterial.Default;
        this.collider = collider ?? null;
        this.lockRotation = lockRotation; // New field
        
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

    // Utility: set rotation to align with a given normal (in degrees)
    alignRotationToNormal(normal) {
        // Only if not locked
        if (this.lockRotation) return;
        // atan2 returns radians, convert to degrees
        const angle = Math.atan2(normal.y, normal.x) * (180 / Math.PI);
        // For a rectangle, aligning the 'up' (y) axis to the normal means subtracting 90 degrees
        if (this.collider && this.collider.entity && this.collider.entity.transform) {
            this.collider.entity.transform.rotation = angle - 90;
        }
    }
}