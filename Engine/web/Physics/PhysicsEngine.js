import Constants from "../static/Constants.js";
import { CollisionMatrix } from "./CollisionMatrix.js";
import { Vector2 } from "./Vector2.js";

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export class PhysicsEngine {
    constructor(spatialGrid) {
        this.spatialGrid = spatialGrid;
        this.physicsIterations = 4; // Velocity solver passes per frame, for stable resting/multi-contact resolution
    }

    handleCollisions(activeColliders) {
        // --- Narrowphase: Detailed Collision Checks ---
        const collisionPairs = new Set();
        const pairsToResolve = [];

        for (const entityA of activeColliders) {
            const nearbyEntities = this.spatialGrid.getNearby(entityA);
            const previousCollisions = entityA.rigidbody.collider.activeCollisions;
            const currentCollisions = new Set();

            const colliderA = entityA.rigidbody.collider;

            for (const entityB of nearbyEntities) {
                if (entityA === entityB) continue;

                const colliderB = entityB.rigidbody.collider;
                if (!CollisionMatrix.shouldCollide(colliderA.layer, colliderB.layer)) continue;

                const collisionInfo = colliderA.getCollisionDetails(colliderB);
                if (collisionInfo) {
                    currentCollisions.add(entityB);

                    if (!previousCollisions.has(entityB)) {
                        if (colliderA.onCollisionEnter) colliderA.onCollisionEnter(colliderB);
                        if (colliderB.onCollisionEnter) colliderB.onCollisionEnter(colliderA);
                    }

                    const pairKey = [entityA.id, entityB.id].sort().join('-');
                    if (!collisionPairs.has(pairKey)) {
                        collisionPairs.add(pairKey);
                        // Trigger colliders report enter/exit above but are never physically resolved.
                        if (!colliderA.isTrigger && !colliderB.isTrigger) {
                            pairsToResolve.push({ entityA, entityB, collisionInfo });
                        }
                    }
                }
            }

            for (const exitedEntity of previousCollisions) {
                if (!currentCollisions.has(exitedEntity)) {
                    // Guarded like onCollisionEnter above - not every collider type defines a
                    // default no-op (CircleCollider doesn't), so this would otherwise throw the
                    // first time a circle-based entity (e.g. a rolling ball) separated from anything.
                    if (entityA.rigidbody.collider.onCollisionExit) entityA.rigidbody.collider.onCollisionExit(exitedEntity.rigidbody.collider);
                    if (exitedEntity.rigidbody.collider.onCollisionExit) exitedEntity.rigidbody.collider.onCollisionExit(entityA.rigidbody.collider);
                }
            }

            entityA.rigidbody.collider.activeCollisions = currentCollisions;
        }

        // --- Resolution ---
        // Positional correction uses the depth computed above, so it must run exactly once per
        // pair per frame - repeating it against a stale depth would push objects apart too far.
        for (const { entityA, entityB, collisionInfo } of pairsToResolve) {
            this.correctPosition(entityA, entityB, collisionInfo);
        }

        // Velocity/impulse resolution is safe (and necessary) to iterate: each pass recomputes
        // relative velocity from the previous pass's result, letting multi-contact pairs
        // (e.g. a box resting against a floor and a wall at once) converge instead of jittering.
        for (let i = 0; i < this.physicsIterations; i++) {
            for (const { entityA, entityB, collisionInfo } of pairsToResolve) {
                this.applyImpulse(entityA, entityB, collisionInfo);
            }
        }
    }

    correctPosition(entityA, entityB, collisionInfo) {
        const rbA = entityA.rigidbody;
        const rbB = entityB.rigidbody;
        const normal = collisionInfo.normal;

        // Calculate inverse mass. Static objects (mass=0) or marked as static have an inverse mass of 0.
        const invMassA = rbA.isStatic ? 0 : 1 / rbA.mass;
        const invMassB = rbB.isStatic ? 0 : 1 / rbB.mass;
        const invInertiaA = rbA.getInverseInertia();
        const invInertiaB = rbB.getInverseInertia();

        // Same torque-arm setup as applyImpulse - the correction must also fight rotation, not
        // just push the centers apart. A linear-only push is correcting "the two centers are too
        // close along normal", but the actual overlap is measured at a corner, and a rotating body
        // keeps digging that corner in deeper regardless of where its center ends up. Without
        // spreading the correction into rotation too, that rotation keeps growing unopposed:
        // tilt increases -> the SAT depth measured at the corner increases with it -> next frame's
        // (now bigger) correction/impulse feeds back into more rotation, compounding every frame.
        const contact = collisionInfo.contactPoint;
        const rA = contact ? contact.clone().subtract(entityA.transform.position) : new Vector2(0, 0);
        const rB = contact ? contact.clone().subtract(entityB.transform.position) : new Vector2(0, 0);
        const rACrossN = rA.x * normal.y - rA.y * normal.x;
        const rBCrossN = rB.x * normal.y - rB.y * normal.x;
        const angularTermN = rACrossN * rACrossN * invInertiaA + rBCrossN * rBCrossN * invInertiaB;

        const correctionFactor = 0.8;
        const slop = 0.01;
        // Caps how far a single frame's correction can push two bodies apart. Deep penetration
        // (typically tunneling - a small/fast body crossing most of the way through another in one
        // frame) otherwise produces a correction big enough to shove the body clean through to the
        // other side, which can then reverse next frame and repeat - an oscillation through the
        // overlap that never converges, instead of settling to the surface over a few frames.
        const maxCorrection = 8;
        const totalInvMass = invMassA + invMassB + angularTermN;

        if (totalInvMass > 0) {
            const correctionAmount =
                (Math.min(Math.max(collisionInfo.depth - slop, 0), maxCorrection) / totalInvMass) * correctionFactor;

            const correctionVector = normal.clone().scale(correctionAmount);

            if (!rbA.isStatic) {
                entityA.transform.move(correctionVector.clone().scale(-invMassA));
                if (invInertiaA > 0) {
                    entityA.transform.rotation -= correctionAmount * rACrossN * invInertiaA * RAD2DEG;
                }
            }
            if (!rbB.isStatic) {
                entityB.transform.move(correctionVector.scale(invMassB));
                if (invInertiaB > 0) {
                    entityB.transform.rotation += correctionAmount * rBCrossN * invInertiaB * RAD2DEG;
                }
            }
        }
    }

    applyImpulse(entityA, entityB, collisionInfo) {
        const rbA = entityA.rigidbody;
        const rbB = entityB.rigidbody;
        const normal = collisionInfo.normal;

        const invMassA = rbA.isStatic ? 0 : 1 / rbA.mass;
        const invMassB = rbB.isStatic ? 0 : 1 / rbB.mass;
        const invInertiaA = rbA.getInverseInertia();
        const invInertiaB = rbB.getInverseInertia();

        if (invMassA + invMassB <= 0) return;

        // Arm from each body's center to the contact point - determines the torque a linear
        // impulse there produces. Collision types that don't compute a contact point (currently
        // none; every collider pair now provides one) would fall back to a zero arm, i.e. no
        // rotational effect for that pair, rather than crashing on a missing value.
        const contact = collisionInfo.contactPoint;
        const rA = contact ? contact.clone().subtract(entityA.transform.position) : new Vector2(0, 0);
        const rB = contact ? contact.clone().subtract(entityB.transform.position) : new Vector2(0, 0);

        // Velocity of the material point AT the contact, not just the center of mass - a spinning
        // body's edge is moving even when its center isn't, and that has to factor into whether
        // the two bodies are approaching or separating at the actual point of contact.
        const velocityAt = (rb, r) =>
            rb.velocity.clone().add(new Vector2(-r.y, r.x).scale(rb.angularVelocity * DEG2RAD));

        let relativeVelocity = velocityAt(rbB, rB).subtract(velocityAt(rbA, rA));
        const velocityAlongNormal = relativeVelocity.dot(normal);

        if (velocityAlongNormal > 0) {
            return;
        }

        const rACrossN = rA.x * normal.y - rA.y * normal.x;
        const rBCrossN = rB.x * normal.y - rB.y * normal.x;
        const angularTermN = rACrossN * rACrossN * invInertiaA + rBCrossN * rBCrossN * invInertiaB;

        // Combine restitution as the max of the two materials (matches common engine convention,
        // e.g. Box2D): a Bouncy body should still bounce off a Default-material surface.
        const restitution = Math.max(rbA.physicsMaterial.restitution, rbB.physicsMaterial.restitution);
        const j = -(1 + restitution) * velocityAlongNormal / (invMassA + invMassB + angularTermN);
        const impulse = normal.clone().scale(j);

        this.#applyLinearAndAngularImpulse(rbA, rbB, rA, rB, impulse, invMassA, invMassB, invInertiaA, invInertiaB);

        // --- Tangential (friction) impulse ---
        // The block above only cancels/reflects the velocity component along `normal`, which for
        // two unrotated boxes is always purely horizontal or vertical. Without this, any sideways
        // relative velocity (e.g. a paddle sliding into a box from an angle) is simply discarded
        // instead of dragging the other body along - collisions only ever look like a straight
        // bounce off whichever axis SAT picked, never an angled knock. It's also friction acting
        // off-center that makes a body tip/tumble rather than just sliding, so this feeds torque too.
        relativeVelocity = velocityAt(rbB, rB).subtract(velocityAt(rbA, rA));
        const velocityAlongNormalAfter = relativeVelocity.dot(normal);
        const tangent = relativeVelocity.clone().subtract(normal.clone().scale(velocityAlongNormalAfter));
        const tangentSpeed = tangent.magnitude();

        if (tangentSpeed > 1e-6) {
            tangent.scale(1 / tangentSpeed);

            const rACrossT = rA.x * tangent.y - rA.y * tangent.x;
            const rBCrossT = rB.x * tangent.y - rB.y * tangent.x;
            const angularTermT = rACrossT * rACrossT * invInertiaA + rBCrossT * rBCrossT * invInertiaB;

            const velocityAlongTangent = relativeVelocity.dot(tangent);
            let jt = -velocityAlongTangent / (invMassA + invMassB + angularTermT);

            // Coulomb friction: the tangential impulse can't exceed frictionCoeff * normalImpulse.
            const friction = Math.sqrt(rbA.physicsMaterial.friction * rbB.physicsMaterial.friction);
            const maxFriction = friction * Math.abs(j);
            jt = Math.max(-maxFriction, Math.min(maxFriction, jt));

            const frictionImpulse = tangent.scale(jt);
            this.#applyLinearAndAngularImpulse(rbA, rbB, rA, rB, frictionImpulse, invMassA, invMassB, invInertiaA, invInertiaB);
        }
    }

    #applyLinearAndAngularImpulse(rbA, rbB, rA, rB, impulse, invMassA, invMassB, invInertiaA, invInertiaB) {
        if (!rbA.isStatic) {
            rbA.velocity.subtract(impulse.clone().scale(invMassA));
        }
        if (!rbB.isStatic) {
            rbB.velocity.add(impulse.clone().scale(invMassB));
        }

        if (invInertiaA > 0) {
            const rACrossJ = rA.x * impulse.y - rA.y * impulse.x;
            rbA.angularVelocity -= rACrossJ * invInertiaA * RAD2DEG;
        }
        if (invInertiaB > 0) {
            const rBCrossJ = rB.x * impulse.y - rB.y * impulse.x;
            rbB.angularVelocity += rBCrossJ * invInertiaB * RAD2DEG;
        }
    }
}
