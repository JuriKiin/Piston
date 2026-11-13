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
        this.lockRotation = lockRotation ?? false;
        this.angularVelocity = 0; // degrees/sec, matching Transform.rotation's units
        this._restTimer = 0; // how long velocity + angularVelocity have both been near-zero
    }

    update() {
        if (this.velocity instanceof Vector2) {
            if (this.useGravity) {
                this.velocity.y -= this.gravity * Constants.DELTA_TIME;
            }

            // Damped on both axes, not just x - a top-down object can roll/slide in any
            // direction, and only friction-ing the horizontal axis left everything coasting
            // forever on y (fine for a platformer's gravity axis, wrong for e.g. a golf ball).
            this.velocity = this.velocity.multiply(new Vector2(1 - this.physicsMaterial.friction, 1 - this.physicsMaterial.friction));
        }
        // No continuous angular drag here (unlike the linear friction damping above): nothing
        // replenishes angular velocity between collisions the way gravity replenishes linear
        // velocity while falling, so any per-frame decay strong enough to matter also crushes a
        // collision's rotational kick to nothing before the object can visibly turn. Rotational
        // energy is dissipated the physical way instead - through the friction impulse applied
        // during collisions (see PhysicsEngine.applyImpulse) - and updateRestState() below snaps
        // out any leftover numerical creep once a body is genuinely at rest.
        if (this.collider && this.collider.enabled) {
            this.collider.getBounds();
        }
    }

    /**
     * Snaps velocity/angularVelocity fully to zero once both have stayed below a small threshold
     * for a moment, instead of letting them hover at a tiny nonzero value forever. Without this,
     * a resting body's per-frame contact resolution noise (the single-point contact approximation
     * isn't perfectly stable) reads as a slow, endless drift instead of actually coming to rest.
     *
     * Fires once per quiet period, not every frame it stays slow: after clamping, the timer
     * restarts, giving a fresh 0.3s window before the next clamp. Otherwise a real but small
     * torque - e.g. gravity's growing pull as a body tips off the edge of its support - would get
     * stomped back to zero on every single frame before it ever had a chance to accumulate into
     * visible rotation, since each frame's tiny addition looks "slow" in isolation.
     *
     * Called by GameLoop *after* collision resolution, not from update() above - checking right
     * after update() would see gravity's fresh velocity for this frame before the collision
     * resolver has had a chance to cancel it back out, so a genuinely resting body would never
     * read as "slow" and would never settle.
     */
    updateRestState() {
        if (this.isStatic) return;

        const isSlow = this.velocity.magnitudeSq() < 0.01 && Math.abs(this.angularVelocity) < 0.5;
        if (isSlow) {
            this._restTimer += Constants.DELTA_TIME;
            if (this._restTimer > 0.3) {
                this.velocity.x = 0;
                this.velocity.y = 0;
                this.angularVelocity = 0;
                this._restTimer = 0;
            }
        } else {
            this._restTimer = 0;
        }
    }

    /**
     * 1/moment-of-inertia about this body's own center, used by collision torque. Zero (treated
     * as infinite inertia, i.e. never spun by a collision) for static or rotation-locked bodies,
     * or if the collider doesn't know its own inertia (getMomentOfInertia unimplemented).
     */
    getInverseInertia() {
        if (this.isStatic || this.lockRotation) return 0;
        if (!this.collider || typeof this.collider.getMomentOfInertia !== 'function') return 0;
        const inertia = this.collider.getMomentOfInertia(this.mass);
        return inertia > 0 ? 1 / inertia : 0;
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

    alignRotationToNormal(normal) {
        if (this.lockRotation) return;
        const angle = Math.atan2(normal.y, normal.x) * (180 / Math.PI);
        if (this.collider && this.collider.entity && this.collider.entity.transform) {
            this.collider.entity.transform.rotation = angle - 90;
        }
    }
}