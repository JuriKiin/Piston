import { Bounds } from "../Bounds.js";
import { Vector2 } from "../Vector2.js";
import { Collider } from './Collider.js';

export class CircleCollider extends Collider {
    constructor(entity, radius) {
        super(entity);
        this.radius = radius;
    }

    getBounds() {
        const pos = this.entity.transform.position;
        return new Bounds(pos.x - this.radius, pos.x + this.radius, pos.y - this.radius, pos.y + this.radius);
    }

    checkCollision(otherCollider) {
        return otherCollider.circleCollision(this);
    }

    circleCollision(otherCircle) {
        const posA = this.entity.transform.position;
        const posB = otherCircle.entity.transform.position;
        const radiusA = this.radius;
        const radiusB = otherCircle.radius;

        const distanceVec = posB.clone().subtract(posA);
        const distance = distanceVec.magnitude();
        const sumOfRadii = radiusA + radiusB;

        if (distance < sumOfRadii) {
            return {
                penetration: sumOfRadii - distance,
                normal: distance > 0 ? distanceVec.normalize() : new Vector2(0, -1),
            };
        }
        return null;
    }

    boxCollision(boxCollider) {
        const circlePos = this.entity.transform.position;
        const circleRadius = this.radius;
        const boxBounds = boxCollider.getBounds();

        const closestX = Math.max(boxBounds.left, Math.min(circlePos.x, boxBounds.right));
        const closestY = Math.max(boxBounds.top, Math.min(circlePos.y, boxBounds.bottom));
        const closestPoint = new Vector2(closestX, closestY);

        const distanceVec = circlePos.clone().subtract(closestPoint);
        const distance = distanceVec.magnitude();

        if (distance < circleRadius) {
            return {
                penetration: circleRadius - distance,
                normal: distance < 0.0001 ? new Vector2(0, -1) : distanceVec.normalize(),
            };
        }
        return null;
    }
}