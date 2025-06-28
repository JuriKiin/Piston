import { Entity } from "./Entity.js";
import { SpatialGrid } from "./Physics/Colliders/SpacialGrid.js";
import Constants from "./static/Constants.js";
import { PhysicsEngine } from "./Physics/PhysicsEngine.js";

/**
 * The main game loop responsible for updating and rendering entities,
 * and handling the physics simulation including collision detection and resolution.
 */
export default class GameLoop {

    constructor(canvas, entities) {
        this.canvas = canvas;
        this.ctx = this.canvas.getContext('2d');
        this.entities = entities ?? [];
        this.spatialGrid = new SpatialGrid(canvas.width, canvas.height, 10000, true, this.ctx); // Cell size of 50
        this.lastTime = null;
        this.physicsEngine = new PhysicsEngine(this.spatialGrid);
    }

    /**
     * Starts the game loop.
     */
    start() {
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
        this.physicsEngine.handleCollisions(this.activeColliders);
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
