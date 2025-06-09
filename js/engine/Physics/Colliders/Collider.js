export class Collider {
    constructor(entity) {
        if (!entity || !entity.transform) {
            throw new Error("Collider must be attached to an entity with a transform.");
        }
        this.entity = entity;
        this.enabled = true;
    }

    getBounds() {
        throw new Error("getBounds() must be implemented by a subclass.");
    }
    
    getCollisionDetails(otherCollider) {
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