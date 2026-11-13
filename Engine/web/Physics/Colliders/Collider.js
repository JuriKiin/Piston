import { Layers } from "../CollisionMatrix.js";

export class Collider {
    constructor(entity) {
        if (!entity || !entity.transform) {
            throw new Error("Collider must be attached to an entity with a transform.");
        }
        this.entity = entity;
        this.enabled = true;
        this.activeCollisions = new Set(); // Entities currently colliding with this one, for onCollisionEnter/Exit
        this.layer = Layers.Default; // Which layer this collider belongs to, see CollisionMatrix
        this.isTrigger = false; // Trigger colliders still report onCollisionEnter/Exit, but never get physically resolved
        // A normal collider is solid ground: something outside it can't get in. An inverse one is
        // a containment boundary instead: whatever's already inside can't get OUT - the "inside"
        // of the shape is the safe zone, and collision only fires (pushing back inward) once the
        // other object's own edge pokes past the boundary. Meant for the shape acting as the wall
        // (e.g. a custom-outline green), not for whatever's moving around inside it - see
        // CircleCollider's circleCollision/#circlePolygonCollision for the actual containment math.
        this.isInverse = false;
    }

    getBounds() {
        throw new Error("getBounds() must be implemented by a subclass.");
    }
    
    getCollisionDetails(otherCollider) {
        // This "reject if the bounding boxes aren't even near each other" shortcut only makes
        // sense between two solid shapes - a containment boundary's danger zone is everywhere
        // OUTSIDE its own (small, fixed) bounds, so the farther the other collider drifts, the
        // more urgently they actually need checking, not less.
        if (!this.isInverse && !otherCollider.isInverse) {
            const myBounds = this.getBounds();
            const otherBounds = otherCollider.getBounds();

            if (
                myBounds.right < otherBounds.left ||
                myBounds.left > otherBounds.right ||
                myBounds.bottom < otherBounds.top ||
                myBounds.top > otherBounds.bottom
            ) {
                return null;
            }
        }

        return this.checkCollision(otherCollider);
    }

    checkCollision(otherCollider) {
        throw new Error("checkCollision() must be implemented by a subclass.");
    }

    circleCollision(circleCollider) {
        throw new Error("circleCollision() must be implemented by a subclass.");
    }

    boxCollision(boxCollider) {
        throw new Error("boxCollision() must be implemented by a subclass.");
    }
}