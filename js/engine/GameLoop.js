import { Entity } from "./Entity.js";
import { SpatialGrid } from "./Physics/Colliders/SpacialGrid.js";
import Constants from "./static/Constants.js";

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
        const activeColliders = this.entities.filter(e => e.rigidbody && e.rigidbody.collider && e.rigidbody.collider.enabled);
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

        let { normal, penetration } = collisionInfo;
        // Ensure normal is normalized and not zero
        if (!normal || (normal.x === 0 && normal.y === 0)) return;
        const mag = Math.sqrt(normal.x * normal.x + normal.y * normal.y);
        if (mag === 0) return;
        normal = { x: normal.x / mag, y: normal.y / mag };

        const relativeVelocity = rbB.velocity.clone().subtract(rbA.velocity);
        const velocityAlongNormal = relativeVelocity.dot(normal);

        if (velocityAlongNormal > 0) return;

        const restitution = Math.min(rbA.physicsMaterial.restitution, rbB.physicsMaterial.restitution);
        const invMassA = isAStatic ? 0 : 1 / rbA.mass;
        const invMassB = isBStatic ? 0 : 1 / rbB.mass;

        let impulseScalar = -(1 + restitution) * velocityAlongNormal;
        impulseScalar /= (invMassA + invMassB);

        const impulse = new rbA.velocity.constructor(normal.x, normal.y).scale(impulseScalar);

        if (!isAStatic) {
            rbA.velocity.subtract(impulse.clone().scale(invMassA));
            if (rbA.transform && rbA.transform.position) {
                rbA.transform.position.subtract(normal.clone().scale(penetration * invMassA / (invMassA + invMassB)));
            }
        }
        if (!isBStatic) {
            rbB.velocity.add(impulse.clone().scale(invMassB));
            if (rbB.transform && rbB.transform.position) {
                rbB.transform.position.add(normal.clone().scale(penetration * invMassB / (invMassA + invMassB)));
            }
        }

        if (!isAStatic && rbA.lockRotation === false && typeof rbA.alignRotationToNormal === 'function') {
            rbA.alignRotationToNormal(normal);
        }
        if (!isBStatic && rbB.lockRotation === false && typeof rbB.alignRotationToNormal === 'function') {
            rbB.alignRotationToNormal({ x: -normal.x, y: -normal.y });
        }
    }

    applyCorrection(entityA, entityB, penetration, normal) {
        const isAStatic = entityA.rigidbody?.isStatic || !entityA.rigidbody || entityA.rigidbody.mass <= 0;
        const isBStatic = entityB.rigidbody?.isStatic || !entityB.rigidbody || entityB.rigidbody.mass <= 0;
        const overCorrection = 1.75;
        let correctedNormal = { ...normal };

        // Special handling for circle vs box: always orient normal from box to circle
        const isACircle = entityA.rigidbody?.collider?.constructor?.name === 'CircleCollider';
        const isBBox = entityB.rigidbody?.collider?.constructor?.name === 'BoxCollider';
        const isBCircle = entityB.rigidbody?.collider?.constructor?.name === 'CircleCollider';
        const isABox = entityA.rigidbody?.collider?.constructor?.name === 'BoxCollider';

        if (!isAStatic && isBStatic) {
            // Move A (dynamic) out of B (static)
            let dir = entityA.transform.position.clone().subtract(entityB.transform.position);
            // For circle vs box, always orient normal from box to circle
            if (isACircle && isBBox) {
                dir = entityA.transform.position.clone().subtract(entityB.transform.position);
            }
            if (dir.dot(normal) < 0) {
                correctedNormal.x = -normal.x;
                correctedNormal.y = -normal.y;
            }
            const correctionVector = new entityA.transform.position.constructor(correctedNormal.x, correctedNormal.y).scale(penetration * overCorrection);
            entityA.transform.position.add(correctionVector);
        } else if (isAStatic && !isBStatic) {
            // Move B (dynamic) out of A (static)
            let dir = entityB.transform.position.clone().subtract(entityA.transform.position);
            if (isBCircle && isABox) {
                dir = entityB.transform.position.clone().subtract(entityA.transform.position);
            }
            if (dir.dot(normal) < 0) {
                correctedNormal.x = -normal.x;
                correctedNormal.y = -normal.y;
            }
            const correctionVector = new entityA.transform.position.constructor(correctedNormal.x, correctedNormal.y).scale(penetration * overCorrection);
            entityB.transform.position.add(correctionVector);
        } else if (!isAStatic && !isBStatic) {
            // Split correction for two dynamic objects
            let dir = entityB.transform.position.clone().subtract(entityA.transform.position);
            if ((isACircle && isBBox) || (isBCircle && isABox)) {
                dir = entityB.transform.position.clone().subtract(entityA.transform.position);
            }
            if (dir.dot(normal) < 0) {
                correctedNormal.x = -normal.x;
                correctedNormal.y = -normal.y;
            }
            const correctionVector = new entityA.transform.position.constructor(correctedNormal.x, correctedNormal.y).scale((penetration * overCorrection) / 2);
            entityA.transform.position.add(correctionVector);
            entityB.transform.position.subtract(correctionVector);
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
