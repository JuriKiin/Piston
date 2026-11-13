/**
 * A pool of reusable entities, for things that appear and disappear constantly (bullets, sparks, damage numbers). Creating an entity builds its components and
 * adds it to the scene, and destroying one leaves garbage for the collector; a pool builds each entity once, switches it off (`entity.active = false`: no update,
 * no drawing, no collisions) when you are done with it, and switches it back on for the next use.
 *
 *   const bullets = new EntityPool({
 *       create: () => new Bullet(),                          // a neutral, ready-to-run entity; the pool calls start() and adds it to the scene
 *       onAcquire: (bullet, x, y, angle) => bullet.launch(x, y, angle),   // runs on EVERY use, fresh or recycled: set position, speed, lifetime, clear trails
 *       onRelease: (bullet) => {},                           // optional: stop sounds, clear particles
 *   });
 *   const b = bullets.acquire(x, y, angle);   // an active entity, or null if `max` live entities exist
 *   b.destroy();                              // for a pooled entity destroy() means "give it back" (also what `lifetime` runs out into)
 *   bullets.release(b);                       // the same, explicitly
 *
 * A pool belongs to one scene: when the scene is rebuilt (a scene load, the editor's Stop) the pool forgets every entity it had and starts fresh.
 * An entity returned mid-step is skipped for the rest of that step's collisions, but a callback already running still sees it: check `other.active` if it matters.
 */
export class EntityPool {
    /**
     * @param {object} options
     * @param {() => import('./Entity.js').Entity} options.create Builds one new entity (not started, not added to the scene).
     * @param {(entity, ...args) => void} [options.onAcquire] Initialises an entity every time it is handed out. Receives acquire()'s extra arguments.
     * @param {(entity) => void} [options.onRelease] Called when an entity is returned.
     * @param {object|(() => object)} [options.loop] The GameLoop (or a function returning it). Defaults to `window.Piston.gameLoop`.
     * @param {number} [options.prewarm=0] Entities to build up front (done on the first acquire, once the loop exists).
     * @param {number} [options.max=Infinity] Most live entities at once; acquire() returns null beyond it.
     */
    constructor({ create, onAcquire = null, onRelease = null, loop = null, prewarm = 0, max = Infinity } = {}) {
        if (typeof create !== 'function') throw new Error('EntityPool needs a create() function');
        Object.assign(this, { create, onAcquire, onRelease, max, _loop: loop, _prewarm: prewarm });
        this.free = [];
        this.all = new Set();
        this.liveCount = 0;
        this.created = 0; // entities built over the pool's lifetime (the fewer the better)
        this._generation = null;
    }

    get loop() {
        const l = typeof this._loop === 'function' ? this._loop() : this._loop;
        return l ?? globalThis.window?.Piston?.gameLoop ?? globalThis.Piston?.gameLoop ?? null;
    }

    /** Total entities the pool owns (live + free). */
    get size() { return this.all.size; }

    #sync(loop) {
        if (loop.generation === undefined || loop.generation === this._generation) return;
        this._generation = loop.generation;
        for (const e of this.all) e._pool = null; // the scene they lived in is gone
        this.free = []; this.all = new Set(); this.liveCount = 0;
    }

    #build(loop) {
        const entity = this.create();
        entity._pool = this;
        entity.start(loop.canvas);
        loop.entities.push(entity);
        this.all.add(entity);
        this.created++;
        return entity;
    }

    /** Builds `count` entities now and parks them switched off, so the first shots do not pay for construction. */
    prewarm(count) {
        const loop = this.loop;
        if (!loop) return;
        this.#sync(loop);
        for (let i = 0; i < count; i++) { const e = this.#build(loop); this.#park(e); }
    }

    #park(entity) {
        entity.active = false;
        entity._pooled = true;
        const c = entity.rigidbody?.collider;
        if (c && c.activeCollisions) c.activeCollisions = new Set(); // so a reused entity reports a fresh Enter
        this.free.push(entity);
    }

    /** A switched-on entity ready for use (recycled if one is free), initialised by `onAcquire(entity, ...args)`; null if the pool is at `max`. */
    acquire(...args) {
        const loop = this.loop;
        if (!loop) throw new Error('EntityPool: no GameLoop yet (pass `loop`, or acquire after the game has started)');
        this.#sync(loop);
        if (this._prewarm) { const n = this._prewarm; this._prewarm = 0; this.prewarm(n); }
        if (this.liveCount >= this.max) return null;
        let entity = this.free.pop();
        if (!entity) entity = this.#build(loop);
        entity._pooled = false;
        entity.active = true;
        entity.destroyed = false;
        entity.lifetime = null;
        this.liveCount++;
        if (this.onAcquire) this.onAcquire(entity, ...args);
        return entity;
    }

    /** Returns an entity to the pool: it is switched off and kept for the next acquire(). Safe to call twice, and from inside collision callbacks. */
    release(entity) {
        if (!entity || entity._pool !== this || entity._pooled) return;
        if (this.onRelease) this.onRelease(entity);
        this.liveCount = Math.max(0, this.liveCount - 1);
        this.#park(entity);
    }

    /** Returns every live entity to the pool (e.g. when a wave is cleared). */
    releaseAll() {
        for (const e of this.all) this.release(e);
    }

    /** Detaches the pool: its entities become ordinary entities again and are destroyed. */
    dispose() {
        for (const e of [...this.all]) { e._pool = null; e.active = true; e.destroy(); }
        this.free = []; this.all = new Set(); this.liveCount = 0;
    }
}
