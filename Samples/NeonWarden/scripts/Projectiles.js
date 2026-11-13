import { Vector2 } from "@piston/Physics/Vector2.js";
import { TrailRenderer } from "@piston/TrailRenderer.js";
import { Light2D } from "@piston/Light2D.js";
import { EntityPool } from "@piston/EntityPool.js";
import Constants from "@piston/static/Constants.js";
import { Actor, Game, Layers, addBody, mkSprite, CX, CY, ARENA_R, ART } from "./Game.js";
import { Fx } from "./Fx.js";

/** A player bolt: fast additive streak with a ribbon trail and a light. Hits enemies through the engine's trigger overlap. Pooled: use Bolt.spawn(). */
export class Bolt extends Actor {
    constructor(x = 0, y = 0, angle = 0, speed = 1650) {
        super(); this.tag = 'Bolt'; this.order = 40; this.launch(x, y, angle, speed);
    }
    /** (Re)aims the bolt: called by the constructor and every time the pool hands a recycled bolt out. */
    launch(x, y, angle, speed = 1650) {
        this.px = x; this.py = y; this.angle = angle; this.speed = speed;
        this.vx = Math.cos(angle) * speed; this.vy = Math.sin(angle) * speed; this.life = 1.4; this.dead = false;
        if (this.trail) { // already started: this is a recycled bolt
            this.transform.position.x = x; this.transform.position.y = y;
            this.transform.rotation = angle * 180 / Math.PI;
            this.trail.clear();
        }
    }
    static pool = new EntityPool({ create: () => new Bolt(), onAcquire: (b, ...a) => b.launch(...a) });
    static spawn(x, y, angle, speed) { return Bolt.pool.acquire(x, y, angle, speed); }
    start() {
        this.transform.position = new Vector2(this.px, this.py);
        this.transform.rotation = this.angle * 180 / Math.PI;
        this.transform.size = new Vector2(84, 34);
        this.main = this.addComponent(mkSprite('bolt.png', { order: 4, blend: 'additive' }));
        this.main.anchorX = 0.85;
        this.trail = this.addComponent(new TrailRenderer({ lifetime: 0.12, minDistance: 8, startWidth: 7, endWidth: 0, startColor: '#bff6ff', endColor: '#33e6ff', blendMode: 'additive', sortingOrder: 3 }));
        this.addComponent(new Light2D({ color: '#33e6ff', radius: 130, intensity: 0.75 }));
        addBody(this, 9, Layers.PlayerProjectile, (e) => this.onHit(e));
    }
    onHit(e) {
        if (this.dead || !e.takeHit) return;
        this.dead = true;
        e.takeHit(1, this);
        this.destroy();
    }
    update() {
        super.update();
        const dt = Constants.DELTA_TIME, p = this.transform.position;
        p.x += this.vx * dt; p.y += this.vy * dt;
        this.life -= dt;
        if (this.life <= 0) this.destroy();
        else if (Math.hypot(p.x - CX, p.y - CY) > ARENA_R + 10) { Fx.hitSpark(p.x, p.y, Math.atan2(this.vy, this.vx) * 180 / Math.PI + 180, true); this.destroy(); }
    }
}

/** An enemy projectile: a pulsing orb. `big` orbs are boss shots. Pooled per look (small, amber, big): use Orb.spawn(). */
export class Orb extends Actor {
    constructor(x = 0, y = 0, angle = 0, { speed = 330, big = false, amber = false } = {}) {
        super(); this.tag = 'Orb'; this.order = 38; this.big = big; this.amber = amber; this.launch(x, y, angle, speed);
    }
    /** (Re)aims the orb: called by the constructor and every time the pool hands a recycled orb out. */
    launch(x, y, angle, speed = 330) {
        this.px = x; this.py = y;
        this.vx = Math.cos(angle) * speed; this.vy = Math.sin(angle) * speed; this.life = 6; this.dead = false;
        if (this.main) { // already started: this is a recycled orb
            this.transform.position.x = x; this.transform.position.y = y;
            this.main.currentFrame = 0;
        }
    }
    static pools = new Map();
    static spawn(x, y, angle, { speed = 330, big = false, amber = false } = {}) {
        const key = `${big}|${amber}`;
        let pool = Orb.pools.get(key);
        if (!pool) Orb.pools.set(key, pool = new EntityPool({ create: () => new Orb(0, 0, 0, { big, amber }), onAcquire: (o, ...a) => o.launch(...a) }));
        return pool.acquire(x, y, angle, speed);
    }
    start() {
        const sz = this.big ? 92 : 50;
        this.transform.position = new Vector2(this.px, this.py);
        this.transform.size = new Vector2(sz, sz);
        const sheet = this.big ? 'bigorb.png' : (this.amber ? 'orb_amb.png' : 'orb_mag.png'), fw = this.big ? 192 : 96;
        this.main = this.addComponent(mkSprite(sheet, { fw, fh: fw, frames: 4, fps: 9, order: 4 }));
        this.addComponent(new Light2D({ color: this.amber ? '#ffb02e' : '#ff2e88', radius: this.big ? 200 : 110, intensity: 0.8 }));
        addBody(this, this.big ? 24 : 12, Layers.EnemyProjectile, (e) => {
            if (this.dead || e !== Game.player) return;
            if (e.hurt(1, this)) { this.dead = true; Fx.hitSpark(this.transform.position.x, this.transform.position.y, 0, false); this.destroy(); }
        });
    }
    update() {
        super.update();
        const dt = Constants.DELTA_TIME, p = this.transform.position;
        p.x += this.vx * dt; p.y += this.vy * dt;
        this.life -= dt;
        if (this.life <= 0 || Math.hypot(p.x - CX, p.y - CY) > ARENA_R + 60) this.destroy();
    }
}
