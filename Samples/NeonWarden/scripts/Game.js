import { Entity } from "@piston/Entity.js";
import { SpriteRenderer } from "@piston/SpriteRenderer.js";
import Constants from "@piston/static/Constants.js";
import { Rigidbody } from "@piston/Physics/Rigidbody.js";
import { CircleCollider } from "@piston/Physics/Colliders/CircleCollider.js";
import { Layers, CollisionMatrix } from "@piston/Physics/CollisionMatrix.js";

export const CX = 960, CY = 540;      // arena centre in world (= canvas) pixels
export const ARENA_R = 470;           // drawn arena radius
export const PLAY_R = 436;            // how far the player's centre may go
export const ART = './assets/art/';

/** Shared, per-run game state and the "feel" helpers (shake, hit-stop, slow-mo). Game feel lives here, in game code, not in the engine. */
export const Game = {
    state: 'title', score: 0, combo: 1, comboTimer: 0, elapsed: 0, kills: 0,
    player: null, boss: null, enemies: new Set(), director: null,
    trauma: 0, zoomKick: 0, _hold: 0, _slow: { scale: 1, until: 0 },

    get loop() { return window.Piston.gameLoop; },
    get canvas() { return this.loop.canvas; },

    reset() {
        Object.assign(this, { state: 'title', score: 0, combo: 1, comboTimer: 0, elapsed: 0, kills: 0, player: null, boss: null, trauma: 0, zoomKick: 0, _hold: 0 });
        this.enemies.clear(); this._slow = { scale: 1, until: 0 };
    },

    /** Adds a freshly constructed entity to the running scene. */
    spawn(entity) {
        entity.start(this.canvas);
        this.loop.entities.push(entity);
        return entity;
    },

    shake(amount) { this.trauma = Math.min(1, this.trauma + amount); },
    zoomPunch(amount) { this.zoomKick = Math.min(0.12, this.zoomKick + amount); },
    /** Freeze the simulation for `ms` real milliseconds (hit-stop). */
    hitStop(ms) { this._hold = Math.max(this._hold, performance.now() + ms); },
    /** Run the simulation at `scale` speed for `ms` real milliseconds. */
    slowmo(scale, ms) { this._slow = { scale, until: performance.now() + ms }; },
    /** Called every frame by the Director: converts the hold/slow requests into the engine's time scale. */
    applyTime() {
        const now = performance.now();
        this.loop.timeScale = now < this._hold ? 0 : (now < this._slow.until ? this._slow.scale : 1);
    },

    addScore(points) {
        this.score += Math.round(points * this.combo);
        this.combo = Math.min(8, this.combo + 0.25); this.comboTimer = 3.2;
    },
};

/** Base for everything in the arena: a sort order for the entity, and a hit flash that decays by itself and is shown on `main` (the body SpriteRenderer). */
export class Actor extends Entity {
    constructor() { super(); this.order = 10; this.hitFlash = 0; this.main = null; }
    getSortingOrder() { return this.order; }
    flash(v = 1) { this.hitFlash = v; }
    update() {
        super.update();
        if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - Constants.DELTA_TIME * 7);
        if (this.main) this.main.flash = this.hitFlash;
    }
}

/** Builds a SpriteRenderer from a short option bag. `path` is relative to assets/art. */
export function mkSprite(path, o = {}) {
    const frames = o.frames ?? 1;
    const s = new SpriteRenderer({
        imagePath: ART + path, frameWidth: o.fw ?? 0, frameHeight: o.fh ?? 0, frameCount: frames, columns: o.cols ?? frames, fps: o.fps ?? 0,
        loop: o.loop ?? true, anchorX: o.ax ?? 0.5, anchorY: o.ay ?? 0.5, sortingOrder: o.order ?? 0, blendMode: o.blend ?? 'normal',
    });
    s.opacity = o.opacity ?? 1;
    return s;
}

export const rand = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const angleTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);

export { Layers };

/** Gives an entity a trigger circle on a collision layer (we move bodies ourselves; the engine only reports overlaps). */
export function addBody(entity, radius, layer, onEnter) {
    const rb = new Rigidbody();
    rb.useGravity = false; rb.mass = 1;
    rb.collider = new CircleCollider(entity, radius);
    rb.collider.isTrigger = true;
    rb.collider.layer = layer;
    rb.collider.onCollisionEnter = (other) => { if (other.entity && !other.entity.destroyed) onEnter(other.entity); };
    entity.rigidbody = rb;
    return rb;
}

/** Only these layer pairs ever touch: bolts hit enemies, enemies and their shots hit the player. */
export function setupCollisionMatrix() {
    const L = Layers, all = [L.Player, L.Enemy, L.PlayerProjectile, L.EnemyProjectile];
    for (const a of all) for (const b of all) CollisionMatrix.ignore(a, b, true);
    CollisionMatrix.ignore(L.Player, L.Enemy, false);
    CollisionMatrix.ignore(L.Player, L.EnemyProjectile, false);
    CollisionMatrix.ignore(L.PlayerProjectile, L.Enemy, false);
}
