import Constants from "./Constants.js";
import { Entity } from "./Entity.js";
import { SpatialGrid } from "./Physics/Colliders/SpacialGrid.js";
import { Vector2 } from "./Physics/Vector2.js";

export default class GameLoop {

    constructor(canvas, entities) {
        this.canvas = canvas;
        this.ctx = this.canvas.getContext('2d');
        this.entities = entities ?? [];
        this.spatialGrid = new SpatialGrid(canvas.width, canvas.height, 50);
        this.lastTime = null;
    }

    start() {
        if (this.entities.length === 0) {
            throw new Error("No entities to start the game loop with.");
        }

        this.entities.forEach(entity => {
            if (entity instanceof Entity) {
                entity.start(this.canvas);
            }
        });

        this.lastTime = Date.now();
        
        const loop = () => {
            this.update();
            requestAnimationFrame(loop);
        };

        requestAnimationFrame(loop);
    }

    update() {
        if (!this.lastTime) this.lastTime = Date.now();
        Constants.DELTA_TIME = (Date.now() - this.lastTime) / 1000;
        this.lastTime = Date.now();

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        for(const entity of this.entities) {
            if (entity instanceof Entity) {
                entity.update(this.ctx)
            }
        }

        this.spatialGrid.clear();
        const activeColliders = this.entities.filter(e => e.rigidbody && e.rigidbody.collider.enabled);
        for (const entity of activeColliders) {
            this.spatialGrid.insert(entity);
        }

        const collisionPairs = new Set();
        
        for (const entityA of activeColliders) {
            const nearbyEntities = this.spatialGrid.getNearby(entityA);
            for (const entityB of nearbyEntities) {
                const pairKey = [entityA.id, entityB.id].sort().join('-');
                if (collisionPairs.has(pairKey)) continue;

                const collisionInfo = entityA.rigidbody.collider.getCollisionDetails(entityB.rigidbody.collider);

                if (collisionInfo) {
                    collisionPairs.add(pairKey);
                    if (entityA.onCollisionEnter) entityA.onCollisionEnter(entityB);
                    if (entityB.onCollisionEnter) entityB.onCollisionEnter(entityA);
                    this.resolvePhysicalCollision(entityA, entityB, collisionInfo);
                }
            }
        }
    }

    resolvePhysicalCollision(entityA, entityB, collisionInfo) {
        const rbA = entityA.rigidbody;
        const rbB = entityB.rigidbody;

        if (!rbA || !rbB) return;

        const isAStatic = rbA.isStatic || rbA.mass <= 0;
        const isBStatic = rbB.isStatic || rbB.mass <= 0;

        if (isAStatic && isBStatic) return;

        const { normal, penetration } = collisionInfo;

        // --- 1. Impulse Resolution (Handle Velocity Change / Bounce) ---
        const relativeVelocity = rbB.velocity.clone().subtract(rbA.velocity);
        const velocityAlongNormal = relativeVelocity.dot(normal);

        if (velocityAlongNormal > 0) return;

        const restitution = Math.min(rbA.physicsMaterial.restitution, rbB.physicsMaterial.restitution);
        
        const invMassA = isAStatic ? 0 : 1 / rbA.mass;
        const invMassB = isBStatic ? 0 : 1 / rbB.mass;

        let impulseScalar = -(1 + restitution) * velocityAlongNormal;
        impulseScalar /= (invMassA + invMassB);

        const impulse = normal.clone().scale(impulseScalar);

        if (!isAStatic) {
            rbA.velocity.subtract(impulse.clone().scale(invMassA));
        }
        if (!isBStatic) {
            rbB.velocity.add(impulse.clone().scale(invMassB));
        }

        this.applyCorrection(entityA, entityB, penetration, normal);
    }
    
    applyCorrection(entityA, entityB, penetration, normal) {
        const isAStatic = entityA.rigidbody?.isStatic || !entityA.rigidbody || entityA.rigidbody.mass <= 0;
        const isBStatic = entityB.rigidbody?.isStatic || !entityB.rigidbody || entityB.rigidbody.mass <= 0;

        const invMassA = isAStatic ? 0 : 1 / entityA.rigidbody.mass;
        const invMassB = isBStatic ? 0 : 1 / entityB.rigidbody.mass;

        const totalInvMass = invMassA + invMassB;
        if (totalInvMass === 0) return;

        const slop = 0.01;
        const percent = 0.5;
        
        const correctionAmount = (Math.max(penetration - slop, 0) / totalInvMass) * percent;
        const correctionVector = normal.clone().scale(correctionAmount);

        if (!isAStatic) {
            entityA.transform.position.subtract(correctionVector.clone().scale(invMassA));
        }
        if (!isBStatic) {
            entityB.transform.position.add(correctionVector.clone().scale(invMassB));
        }
    }


    add(entity) {
        if (entity && entity instanceof Entity) {
            this.entities.push(entity);
        } 
    }

    findObjectWithTag(tag) {
        return this.entities.find(entity => entity.tag === tag);
    }
}
