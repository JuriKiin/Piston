import { Bounds } from "../Bounds.js";
import { Vector2 } from "../Vector2.js";
import { Collider } from './Collider.js';
import { PolygonCollider } from './PolygonCollider.js';

export class CircleCollider extends Collider {
    constructor(entity, radius) {
        super(entity);
        this.radius = radius;
    }

    /** Moment of inertia of a solid disc about its own center: mass*r^2/2. */
    getMomentOfInertia(mass) {
        return mass * this.radius ** 2 / 2;
    }

    getBounds() {
        const pos = this.entity.transform.position;
        return new Bounds(pos.x - this.radius, pos.x + this.radius, pos.y - this.radius, pos.y + this.radius);
    }

    /**
     * Same {left, right, top, bottom} shape PolygonCollider provides for SpatialGrid - every
     * collider type needs one, but this was never added for circles since nothing used one
     * with the spatial grid until now (WaterDrop used a box collider despite the name).
     */
    getTransformedBounds() {
        const bounds = this.getBounds();
        return {
            left: new Vector2(bounds.left, 0),
            right: new Vector2(bounds.right, 0),
            top: new Vector2(0, bounds.top),
            bottom: new Vector2(0, bounds.bottom)
        };
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
        if (this.isInverse || otherCircle.isInverse) {
            return this.#containmentCircleCollision(otherCircle);
        }

        const posA = this.entity.transform.position;
        const posB = otherCircle.entity.transform.position;

        const distance = Vector2.distance(posA, posB);
        const radii = this.radius + otherCircle.radius;

        if (distance >= radii) return null; // No collision
        else {
            // A fast-moving small circle can tunnel deep enough in one frame that its center
            // lands right on (or past) the other circle's center. `normalize()` on that near-zero
            // vector is numerically unstable - and exactly at zero it's left as (0,0) - so without
            // this fallback the correction/impulse below (both scale `normal`) become zero vectors
            // and the two circles stay locked together forever instead of separating.
            // Points from this circle toward otherCircle - correct for contactPoint below (a
            // surface point on THIS circle facing the other), but NOT the sign PhysicsEngine
            // expects for the returned `normal` field - see the comment on the return below.
            const towardOther = distance > 0.0001
                ? posB.clone().subtract(posA).normalize()
                : new Vector2(0, -1);
            const depth = radii - distance;
            const contactPoint = posA.clone().add(towardOther.clone().scale(this.radius));

            // checkCollision()'s double dispatch (`otherCollider.circleCollision(this)`) means
            // `this` is always the SECOND collider PhysicsEngine is resolving and `otherCircle` is
            // the first - so `towardOther` above actually points from the second body to the
            // first, the reverse of the first-to-second convention correctPosition/applyImpulse
            // expect (PolygonCollider.circleCollision compensates for the exact same reversal with
            // its own `.scale(-1)`). Velocity resolution reads fine either way since it's
            // sign-symmetric, but positional correction isn't: left unflipped, this pushed an
            // overlapping ball further into a bumper instead of back out of it, trapping it inside.
            const normal = towardOther.clone().scale(-1);

            return {
                depth: depth,
                normal: normal,
                contactPoint: contactPoint
            };
        }
    }

    /**
     * One of these two circles is a containment boundary (isInverse) - the OTHER must stay fully
     * inside it, rather than the usual "can't overlap" rule. Whichever circle declares isInverse
     * is treated as the container regardless of which side of the double-dispatch it landed on
     * (see checkCollision's comment on the role reversal that convention has to correct for).
     */
    #containmentCircleCollision(otherCircle) {
        const containerIsThis = this.isInverse;
        const container = containerIsThis ? this : otherCircle;
        const content = containerIsThis ? otherCircle : this;

        const containerPos = container.entity.transform.position;
        const contentPos = content.entity.transform.position;
        const distance = Vector2.distance(containerPos, contentPos);
        const maxDistance = container.radius - content.radius;

        if (maxDistance < 0) return null; // Content is bigger than the container - nothing sane to resolve.
        if (distance <= maxDistance) return null; // Fully inside, nowhere near the boundary.

        const towardContainer = distance > 0.0001
            ? containerPos.clone().subtract(contentPos).normalize()
            : new Vector2(0, -1);
        const depth = distance - maxDistance;
        const contactPoint = contentPos.clone().add(towardContainer.clone().scale(content.radius));

        // Same first-to-second convention as the solid case above: `this` is always the SECOND
        // collider PhysicsEngine is resolving, `otherCircle` the first. When the container is
        // `this` (second), pushing the content (first) toward it means the normal points AWAY
        // from the container (first-to-second, i.e. container-to-content); when the container is
        // `otherCircle` (first), it's the reverse.
        const normal = containerIsThis ? towardContainer.clone().scale(-1) : towardContainer;

        return { depth, normal, contactPoint };
    }

    /**
     * PolygonCollider's double-dispatch checkCollision() asks the other collider for a method
     * named after its own shape (polygonCollision), the same way circleCollision/boxCollision
     * work here. PolygonCollider was renamed from BoxCollider but this alias was never added,
     * so a Polygon-vs-Circle pair (polygon queried first) threw "polygonCollision is not a
     * function". The polygon math below already handles any convex shape, so reuse it.
     * @param {PolygonCollider} polygonCollider The polygon collider.
     * @returns {object|null} Collision details { depth, normal, contactPoint } or null.
     */
    polygonCollision(polygonCollider) {
        return this.#circlePolygonCollision(polygonCollider);
    }

    /**
     * Provides collision details for this Circle against a PolygonCollider - a rectangle (the
     * "box" name is historical) or an arbitrary custom-vertex polygon, convex or concave; all are
     * just `polygonCollider.transformVertices` of different lengths, so the same code handles any.
     * @param {PolygonCollider} boxCollider The polygon collider.
     * @returns {object|null} Collision details { depth, normal, contactPoint } or null.
     */
    boxCollision(boxCollider) {
        return this.#circlePolygonCollision(boxCollider);
    }

    /**
     * Circle vs an arbitrary polygon, entirely in world space via the polygon's already-
     * transformed vertices - unlike the old box-only version, which transformed the circle into
     * the box's local axes first. That only worked because a box's local axes were known in
     * advance; an arbitrary polygon has no fixed pair of local axes to transform into, so this
     * instead finds the closest point on the polygon's perimeter directly (correct for any vertex
     * count or shape, since it's just a per-edge nearest-point scan), and tests "inside" with the
     * general ray-casting rule (PolygonCollider.isPointInPolygon) rather than SAT's convex-only
     * same-side check - true polygon-vs-polygon SAT genuinely requires convex shapes, but a circle
     * only ever needs "closest boundary point" + "am I inside", both of which are well-defined for
     * ANY simple polygon. That's what makes a concave course boundary (isInverse) work correctly
     * against the ball without needing to decompose it into convex pieces at all.
     */
    #circlePolygonCollision(polygonCollider) {
        const circlePos = this.entity.transform.position;
        const verts = polygonCollider.transformVertices;
        const n = verts.length;

        let closestPoint = null;
        let minDistSq = Infinity;

        for (let i = 0; i < n; i++) {
            const a = verts[i];
            const b = verts[(i + 1) % n];
            const point = CircleCollider.#closestPointOnSegment(circlePos, a, b);
            const distSq = point.clone().subtract(circlePos).magnitudeSq();
            if (distSq < minDistSq) {
                minDistSq = distSq;
                closestPoint = point;
            }
        }

        const distance = Math.sqrt(minDistSq);
        const inside = PolygonCollider.isPointInPolygon(circlePos, verts);

        if (polygonCollider.isInverse) {
            return this.#containmentPolygonCollision(circlePos, closestPoint, distance, inside);
        }

        if (!inside && distance >= this.radius) return null; // No collision.

        // A fast-moving circle can tunnel deep enough that its center lands exactly on the
        // perimeter (distance ~0) - normalize() on a near-zero vector is unstable, so fall back to
        // a fixed direction rather than an unpredictable one (same idea as the circle-circle
        // degenerate case above).
        const normal = distance > 0.0001
            ? circlePos.clone().subtract(closestPoint).normalize()
            : new Vector2(0, -1);

        // Tunneled fully inside: push out through whichever edge is nearest (same idea as SAT's
        // point-in-polygon case), so depth grows with how deep past that edge the center already
        // is, rather than shrinking as if the center were still approaching from outside.
        const depth = inside ? this.radius + distance : this.radius - distance;

        return { depth, normal, contactPoint: closestPoint };
    }

    /**
     * The polygon is a containment boundary: `inside` is now the SAFE state (the reverse of the
     * solid case above), and collision only fires once the circle's own edge actually pokes past
     * the perimeter - either from just inside (still `inside`, but within `radius` of the nearest
     * edge) or having already escaped outright (`!inside`).
     */
    #containmentPolygonCollision(circlePos, closestPoint, distance, inside) {
        if (inside && distance >= this.radius) return null; // Safely inside, nowhere near the edge.

        if (inside) {
            // Near the edge from inside - (circlePos - closestPoint) already points from the edge
            // back toward the interior (since circlePos, being inside, is on the interior side of
            // its own nearest edge), exactly the direction to push back in - no flip needed, unlike
            // the escaped case below.
            const normal = distance > 0.0001
                ? circlePos.clone().subtract(closestPoint).normalize()
                : new Vector2(0, -1);
            return { depth: this.radius - distance, normal, contactPoint: closestPoint };
        }

        // Fully escaped - push back toward the interior. Opposite direction from the solid case's
        // tunneled fallback: there, the polygon is an obstacle to push OUT of; here, it's the
        // safe zone to push back INTO.
        const normal = distance > 0.0001
            ? closestPoint.clone().subtract(circlePos).normalize()
            : new Vector2(0, -1);
        return { depth: this.radius + distance, normal, contactPoint: closestPoint };
    }

    static #closestPointOnSegment(p, a, b) {
        const ab = b.clone().subtract(a);
        const abLenSq = ab.magnitudeSq();
        if (abLenSq === 0) return a.clone();
        const t = Math.max(0, Math.min(1, p.clone().subtract(a).dot(ab) / abLenSq));
        return a.clone().add(ab.scale(t));
    }

    onCollisionEnter(otherCollider) {
        //These can be defined by the Entity. Do nothing by default
    }

    onCollisionExit(otherCollider) {
        //These can be defined by the Entity. Do nothing by default
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