import { Entity } from "./Entity.js";
import { SpatialGrid } from "./Physics/Colliders/SpacialGrid.js";
import Constants from "./static/Constants.js";

/**
 * The main game loop responsible for updating and rendering entities,
 * and handling the physics simulation including collision detection and resolution.
 */
export default class GameLoop {

    constructor(canvas, entities) {
        this.canvas = canvas;
        this.ctx = this.canvas.getContext('2d');
        this.entities = entities ?? [];
        this.spatialGrid = new SpatialGrid(canvas.width, canvas.height, 50, false, this.ctx); // Cell size of 50
        this.lastTime = null;
        this.physicsIterations = 1; // Increased iterations for stability
    }

    /**
     * Starts the game loop.
     */
    start() {
        if (this.entities.length === 0) {
            console.warn("GameLoop starting with no entities.");
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

    /**
     * The main update function, called every frame.
     */
    update() {
        // --- Time Management ---
        if (!this.lastTime) this.lastTime = Date.now();
        Constants.DELTA_TIME = (Date.now() - this.lastTime) / 1000;
        this.lastTime = Date.now();

        // --- Rendering & Entity Updates ---
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // --- Update Spacial Grid ---
        this.activeColliders = this.entities.filter(e => e.rigidbody && e.rigidbody.collider && e.rigidbody.collider.enabled);
        if (this.activeColliders.length > 0) {
            this.spatialGrid.update(this.activeColliders);
        }
        // Update all entities (handles movement, input, etc.)
        for(const entity of this.entities) {
            if (entity instanceof Entity) {
                entity.update(this.ctx);
            }
        }

        // --- Physics Step ---
        this.handleCollisions();
    }
    
    /**
     * Manages the entire collision detection and resolution pipeline for a frame.
     */
    handleCollisions() {
        const collisions = [];
        
        // --- Narrowphase: Detailed Collision Checks ---
        const collisionPairs = new Set();
        for (const entityA of this.activeColliders) {
            const nearbyEntities = this.spatialGrid.getNearby(entityA);
            const previousCollisions = new Set(entityA.rigidbody.collider.activeCollisions);
            const currentCollisions = new Set();

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
                    }
                }
            }

            // Detect collision exits
            for (const exitedEntity of previousCollisions) {
                if (!currentCollisions.has(exitedEntity)) {
                    console.log(entityA.tag, exitedEntity.tag);
                    entityA.rigidbody.collider.onCollisionExit(exitedEntity.rigidbody.collider);
                    exitedEntity.rigidbody.collider.onCollisionExit(entityA.rigidbody.collider);
                }
            }

            // Update active collisions
            entityA.rigidbody.collider.activeCollisions = currentCollisions;
        }
        
        // --- Iterative Resolution Phase ---
        // By running the solver multiple times, we improve stability and reduce jitter.
        for(let i = 0; i < this.physicsIterations; i++) {
            for (const { entityA, entityB, collisionInfo } of collisions) {
                this.resolvePhysicalCollision(entityA, entityB, collisionInfo);
            }
        }
    }

    /**
     * Orchestrates the two-step collision resolution process: positional correction and impulse.
     */
    resolvePhysicalCollision(entityA, entityB, collisionInfo) {
        const rbA = entityA.rigidbody;
        const rbB = entityB.rigidbody;

        // if (!rbA.isStatic) entityA.transform.move(collisionInfo.normal.scale(collisionInfo.depth));
        // if (!rbB.isStatic) entityB.transform.move(collisionInfo.normal.scale(-collisionInfo.depth));
    }

    /**
     * Adds an entity to the game loop.
     * @param {Entity} entity The entity to add.
     */
    add(entity) {
        if (entity && entity instanceof Entity) {
            this.entities.push(entity);
        } else {
            console.error("Attempted to add an invalid object to the GameLoop. Must be an Entity.", entity);
        }
    }

    /**
     * Finds the first entity with a given tag.
     * @param {string} tag The tag to search for.
     * @returns {Entity|undefined} The found entity, or undefined.
     */
    findObjectWithTag(tag) {
        return this.entities.find(entity => entity.tag === tag);
    }
}
