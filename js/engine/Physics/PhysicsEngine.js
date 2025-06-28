import Constants from "../static/Constants.js";

export class PhysicsEngine {
    constructor(spatialGrid) {
        this.spatialGrid = spatialGrid;
        this.physicsIterations = 1; // Increased iterations for stability
    }

    handleCollisions(activeColliders) {
        const currentCollisions = new Set();

        // --- Narrowphase: Detailed Collision Checks ---
        const collisionPairs = new Set();
        for (const entityA of activeColliders) {
            const nearbyEntities = this.spatialGrid.getNearby(entityA);
            const previousCollisions = new Set(entityA.rigidbody.collider.activeCollisions);

            for (const entityB of nearbyEntities) {
                if (entityA === entityB) continue;
                const pairKey = [entityA.id, entityB.id].sort().join('-');
                if (collisionPairs.has(pairKey)) continue;

                const collisionInfo = entityA.rigidbody.collider.getCollisionDetails(entityB.rigidbody.collider);
                if (collisionInfo) {
                    collisionPairs.add(pairKey);
                    currentCollisions.add(entityB);
                    if (!previousCollisions.has(entityB)) {
                        if (entityA.rigidbody.collider.onCollisionEnter) entityA.rigidbody.collider.onCollisionEnter(entityB.rigidbody.collider);
                        if (entityB.rigidbody.collider.onCollisionEnter) entityB.rigidbody.collider.onCollisionEnter(entityA.rigidbody.collider);

                        this.resolvePhysicalCollision(entityA, entityB, collisionInfo);
                    }
                }
            }

            for (const exitedEntity of previousCollisions) {
                if (!currentCollisions.has(exitedEntity)) {
                    entityA.rigidbody.collider.onCollisionExit(exitedEntity.rigidbody.collider);
                    exitedEntity.rigidbody.collider.onCollisionExit(entityA.rigidbody.collider);
                }
            }
        }

        for (let i = 0; i < this.physicsIterations; i++) {
            for (const { entityA, entityB, collisionInfo } of currentCollisions) {
                if (!entityA || !entityB || !collisionInfo) continue;
                this.resolvePhysicalCollision(entityA, entityB, collisionInfo);
            }
        }
    }

    resolvePhysicalCollision(entityA, entityB, collisionInfo) {
        const rbA = entityA.rigidbody;
        const rbB = entityB.rigidbody;
        const normal = collisionInfo.normal;

        // Calculate inverse mass. Static objects (mass=0) or marked as static have an inverse mass of 0.
        const invMassA = rbA.isStatic ? 0 : 1 / rbA.mass;
        const invMassB = rbB.isStatic ? 0 : 1 / rbB.mass;

        // --- 1. Positional Correction ---
        const correctionFactor = 0.8;
        const slop = 0.01;
        const totalInvMass = invMassA + invMassB;

        if (totalInvMass > 0) {
            const correctionAmount =
                (Math.max(collisionInfo.depth - slop, 0) / totalInvMass) * correctionFactor;

            const correctionVector = normal.clone().scale(correctionAmount);

            if (!rbA.isStatic) {
                entityA.transform.move(correctionVector.clone().scale(-invMassA));
            }
            if (!rbB.isStatic) {
                entityB.transform.move(correctionVector.scale(invMassB));
            }
        }

        // --- 2. Impulse Resolution ---
        const relativeVelocity = rbB.velocity.clone().subtract(rbA.velocity);
        const velocityAlongNormal = relativeVelocity.dot(normal);

        if (velocityAlongNormal > 0) {
            return;
        }

        if (totalInvMass > 0) {
            let jA = -(1 + rbA.physicsMaterial.restitution) * velocityAlongNormal;
            let jB = -(1 + rbB.physicsMaterial.restitution) * velocityAlongNormal;
            jA /= totalInvMass;
            jB /= totalInvMass;

            const impulseA = normal.clone().scale(jA);
            const impulseB = normal.clone().scale(jB);

            if (!rbA.isStatic) {
                rbA.velocity.subtract(impulseA.clone().scale(invMassA));
            }
            if (!rbB.isStatic) {
                rbB.velocity.add(impulseB.scale(invMassB));
            }
        }
    }
}
