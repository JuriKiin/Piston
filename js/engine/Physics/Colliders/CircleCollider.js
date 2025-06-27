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
        // This is part of the double-dispatch pattern.
        // It calls the appropriate collision method on the other collider, passing itself in.
        // e.g., otherCollider.circleCollision(this) or otherCollider.boxCollision(this)
        return otherCollider.circleCollision(this);
    }

    /**
     * Provides collision details for this Circle against another Circle.
     * @param {CircleCollider} otherCircle The other circle collider.
     * @returns {object|null} Collision details { depth, normal } or null if no collision.
     */
    circleCollision(otherCircle) {
        const posA = this.entity.transform.position;
        const posB = otherCircle.entity.transform.position;

        const distance = Vector2.distance(posA, posB);
        const radii = this.radius + otherCircle.radius;

        if (distance >= radii) return null; // No collision
        else {
            const normal = posB.clone().subtract(posA).normalize();
            const depth = radii - distance;

            return {
                depth: depth,
                normal: normal
            };
        }
    }

    /**
     * Provides collision details for this Circle against a BoxCollider (OBB).
     * @param {BoxCollider} boxCollider The box collider.
     * @returns {object|null} Collision details { depth, normal, contactPoint } or null.
     */
    boxCollision(boxCollider) {
        const circlePos = this.entity.transform.position;
        const boxPos = boxCollider.entity.transform.position;
        const boxAngle = -boxCollider.entity.transform.rotation * (Math.PI / 180);

        // Step 1: Transform the circle's center into the box's local coordinate system.
        const cosA = Math.cos(boxAngle);
        const sinA = Math.sin(boxAngle);
        const relativePos = circlePos.clone().subtract(boxPos);

        const localCirclePos = new Vector2(
            relativePos.x * cosA - relativePos.y * sinA,
            relativePos.x * sinA + relativePos.y * cosA
        );

        // Step 2: Find the closest point on the AABB (in its own local space) to the circle's center.
        const halfW = boxCollider.width / 2;
        const halfH = boxCollider.height / 2;

        const closestPointLocal = new Vector2(
            Math.max(-halfW, Math.min(localCirclePos.x, halfW)),
            Math.max(-halfH, Math.min(localCirclePos.y, halfH))
        );

        // Step 3: Check if the distance from the circle's center to this closest point is less than the radius.
        const distanceVec = localCirclePos.clone().subtract(closestPointLocal);
        // CORRECTED: Replaced magnitudeSq() with direct calculation.
        const distanceSq = distanceVec.x * distanceVec.x + distanceVec.y * distanceVec.y;

        if (distanceSq < this.radius * this.radius) {
            // Collision detected! Now, gather the necessary information for resolution.
            const distance = Math.sqrt(distanceSq);
            const depth = this.radius - distance;

            // The collision normal is the vector from the closest point to the circle's center.
            // We calculate it in the box's local space and then rotate it back to world space.
            let normalWorld;
            if (distance > 0.0001) {
                const normalLocal = distanceVec.normalize();
                normalWorld = new Vector2(
                    normalLocal.x * cosA + normalLocal.y * -sinA,
                    normalLocal.x * sinA + normalLocal.y * cosA
                );
            } else {
                // The circle's center is inside the box. Fallback normal calculation.
                // The normal should point from the box center towards the circle center.
                normalWorld = circlePos.clone().subtract(boxPos).normalize();
                 // CORRECTED: Replaced magnitudeSq() with a check for a zero vector.
                if (normalWorld.x === 0 && normalWorld.y === 0) {
                    // Failsafe if centers are aligned, push upwards.
                    normalWorld = new Vector2(0, 1);
                }
            }
            
            // Transform the contact point from local space back to world space.
            const contactWorld = new Vector2(
                closestPointLocal.x * cosA + closestPointLocal.y * -sinA + boxPos.x,
                closestPointLocal.x * sinA + closestPointLocal.y * cosA + boxPos.y
            );

            // The normal should always point away from the box and towards the circle.
            // Let's ensure this direction is correct.
            const directionFromBoxToCircle = circlePos.clone().subtract(contactWorld);
            if (directionFromBoxToCircle.dot(normalWorld) < 0) {
                normalWorld.scale(-1); // Flip the normal if it's pointing the wrong way.
            }

            return {
                depth: depth,
                normal: normalWorld,
                contactPoint: contactWorld
            };
        }

        // No collision.
        return null;
    }

    drawCollider(ctx, color = 'green') {
        if (!ctx) return;
        const pos = this.entity.transform.position;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, this.radius, 0, Math.PI * 2);
        ctx.stroke();
        // Draw center point
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // Visual debug: draw the collision normal from contact point to circle center
    drawNormal(ctx, collisionResult, color = 'blue') {
        if (!ctx || !collisionResult || !collisionResult.contactPoint) return;
        const circlePos = this.entity.transform.position;
        const contact = collisionResult.contactPoint;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(contact.x, contact.y);
        ctx.lineTo(circlePos.x, circlePos.y);
        ctx.stroke();
        // Draw dot at contact
        ctx.beginPath();
        ctx.arc(contact.x, contact.y, 3, 0, Math.PI * 2);
        ctx.fill();
        // Draw dot at circle center
        ctx.beginPath();
        ctx.arc(circlePos.x, circlePos.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}