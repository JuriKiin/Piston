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

    // Improved circle-vs-circle collision
    circleCollision(otherCircle) {
        const posA = this.entity.transform.position;
        const posB = otherCircle.entity.transform.position;
        const radiusA = this.radius;
        const radiusB = otherCircle.radius;
        const distanceVec = posB.clone().subtract(posA);
        const distance = distanceVec.magnitude();
        const sumOfRadii = radiusA + radiusB;
        if (distance < sumOfRadii) {
            let normal = distance > 0 ? distanceVec.clone().normalize() : new Vector2(0, -1);
            // Always point normal from this to other
            return {
                penetration: sumOfRadii - distance,
                normal: normal
            };
        }
        return null;
    }

    // Accurate circle-vs-OBB collision with robust normal
    boxCollision(boxCollider, ctx) {
        const circlePos = this.entity.transform.position;
        const boxPos = boxCollider.entity.transform.position;
        const angle = -(boxCollider.entity.transform.rotation || 0) * (Math.PI / 180);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const relX = circlePos.x - boxPos.x;
        const relY = circlePos.y - boxPos.y;
        const localX = relX * cos - relY * sin;
        const localY = relX * sin + relY * cos;

        const halfW = boxCollider.width / 2;
        const halfH = boxCollider.height / 2;
        const closestX = Math.max(-halfW, Math.min(localX, halfW));
        const closestY = Math.max(-halfH, Math.min(localY, halfH));

        const distX = localX - closestX;
        const distY = localY - closestY;
        const distSq = distX * distX + distY * distY;
        const radius = this.radius;

        if (distSq < radius * radius) {
            const contactLocal = new Vector2(closestX, closestY);
            const contactWorld = new Vector2(
                contactLocal.x * cos + contactLocal.y * -sin + boxPos.x,
                contactLocal.x * sin + contactLocal.y * cos + boxPos.y
            );

            let normalWorld = circlePos.clone().subtract(contactWorld);
            if (normalWorld.magnitude() < 0.0001) normalWorld = new Vector2(0, -1);
            else normalWorld.normalize();

            // Debug visuals
            ctx.save();
            ctx.strokeStyle = 'red';
            ctx.beginPath();
            ctx.arc(localX, localY, 3, 0, Math.PI * 2);
            ctx.stroke();

            ctx.strokeStyle = 'blue';
            ctx.beginPath();
            ctx.arc(closestX, closestY, 3, 0, Math.PI * 2);
            ctx.stroke();

            ctx.strokeStyle = 'green';
            ctx.beginPath();
            ctx.moveTo(contactWorld.x, contactWorld.y);
            ctx.lineTo(circlePos.x, circlePos.y);
            ctx.stroke();
            ctx.restore();

            // Continuous collision detection: project circle's velocity onto normal
            const velocity = this.entity.rigidbody.velocity;
            const velocityAlongNormal = velocity.dot(normalWorld);
            if (velocityAlongNormal < 0) {
                const correction = normalWorld.clone().scale(radius - Math.sqrt(distSq));
                this.entity.transform.position.add(correction);
            }

            return {
                penetration: radius - Math.sqrt(distSq),
                normal: normalWorld,
                contactPoint: contactWorld
            };
        }
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