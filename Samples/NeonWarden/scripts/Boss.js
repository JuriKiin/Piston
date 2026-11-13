import { Vector2 } from "@piston/Physics/Vector2.js";
import { Animator } from "@piston/Animator.js";
import { Light2D } from "@piston/Light2D.js";
import { EntityRegistry } from "@piston/EntityRegistry.js";
import Constants from "@piston/static/Constants.js";
import { Actor, Game, Layers, addBody, mkSprite, CX, CY, ARENA_R, ART, clamp, lerp, rand, angleTo } from "./Game.js";
import { Enemy } from "./Enemies.js";
import { Orb } from "./Projectiles.js";
import { Fx, FxSprite } from "./Fx.js";
import { sfx } from "./Sfx.js";

const SEGMENTS = 10, SPACING = 70;

/** An expanding shockwave ring that hurts the player unless they dash through it (dash = invulnerable). */
export class ShockRing extends Actor {
    constructor(x, y, speed = 400) { super(); this.tag = 'ShockRing'; this.order = 36; this.px = x; this.py = y; this.r = 40; this.speed = speed; this.hit = false; }
    start() {
        this.transform.position = new Vector2(this.px, this.py); this.transform.size = new Vector2(80, 80);
        this.main = this.addComponent(mkSprite('ring_mag.png', { order: 4, blend: 'additive' }));
        this.light = this.addComponent(new Light2D({ color: '#ff2e88', radius: 260, intensity: 0.9 }));
    }
    update() {
        super.update();
        this.r += this.speed * Constants.DELTA_TIME;
        const d = this.r * 2 / 0.86;                    // the ring art's bright band sits at 86% of the sprite width
        this.transform.size = new Vector2(d, d);
        this.main.opacity = clamp(1.2 - this.r / 900, 0, 1);
        const pl = Game.player;
        if (pl && !pl.dead && !this.hit) {
            const dd = Math.hypot(pl.position.x - this.px, pl.position.y - this.py);
            if (Math.abs(dd - this.r) < 22 && pl.hurt(1, this)) this.hit = true;
        }
        if (this.r > 1000) this.destroy();
    }
}

/** A sweeping laser from the boss's head: telegraph line first, then a rotating beam. */
export class Laser extends Actor {
    constructor(head, dir) { super(); this.tag = 'Laser'; this.order = 37; this.head = head; this.dir = dir; this.t = 0; this.a0 = head.heading; }
    start() {
        this.transform.size = new Vector2(1, 1);
        this.light = this.addComponent(new Light2D({ color: '#ff2e88', radius: 420, intensity: 0.0 }));
        sfx.play('charge', { volume: 0.8, minGap: 0 });
    }
    get angle() { const k = clamp((this.t - 1.0) / 2.4, 0, 1); return this.a0 + this.dir * (-1.1 + 2.2 * k); }
    update() {
        super.update();
        this.t += Constants.DELTA_TIME;
        if (this.head.destroyed || this.head.dying) { this.destroy(); return; }
        this.transform.position.x = this.head.transform.position.x; this.transform.position.y = this.head.transform.position.y;
        if (this.t < 1.0) this.a0 = this.head.heading, this.dir = this.dir;
        if (this.t >= 1.0) {
            this.light.intensity = 1.3;
            if (!this.fired) { this.fired = true; sfx.play('shockwave', { volume: 0.9, minGap: 0 }); Game.shake(0.5); }
            Game.shake(0.02);
            const pl = Game.player, p = this.transform.position, a = this.angle;
            if (pl && !pl.dead) {
                const dx = pl.position.x - p.x, dy = pl.position.y - p.y, along = dx * Math.cos(a) + dy * Math.sin(a), off = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a));
                if (along > 0 && off < 30) pl.hurt(1, this);
            }
        }
        if (this.t > 3.6) this.destroy();
    }
    draw(ctx) {
        // Drawn in the entity's local space, which is unrotated: rotate to the beam angle ourselves.
        const a = this.t < 1.0 ? this.head.heading + this.dir * -1.1 : this.angle;
        const beam = (this.beamImg ??= (() => { const i = new window.Image(); i.src = ART + 'beam_mag.png'; return i; })());
        const aim = (this.aimImg ??= (() => { const i = new window.Image(); i.src = ART + 'aim.png'; return i; })());
        ctx.save(); ctx.rotate(a); ctx.globalCompositeOperation = 'lighter';
        if (this.t < 1.0) { ctx.globalAlpha = 0.3 + 0.5 * this.t; if (aim.complete && aim.naturalWidth) ctx.drawImage(aim, 60, -8, 1300, 16); }
        else if (beam.complete && beam.naturalWidth) {
            const fade = this.t > 3.2 ? 1 - (this.t - 3.2) / 0.4 : 1; ctx.globalAlpha = fade; const w = 70 * (0.9 + 0.1 * Math.sin(this.t * 60));
            ctx.drawImage(beam, 50, -w / 2, 1400, w);
        }
        ctx.restore();
    }
}

/** One armoured segment of the Warden's body. Follows the head along its path with spring lag; shoots radial bursts; can be destroyed. */
export class BossSegment extends Enemy {
    constructor(boss, index, tail = false) {
        super(); this.tag = tail ? 'WardenTail' : 'WardenSegment'; this.order = 22 - index * 0.01; this.boss = boss; this.index = index; this.tail = tail;
        this.hp = tail ? 8 : 5; this.maxHp = this.hp; this.heading = 0; this.fireT = rand(3, 7) + index * 0.3; this.windup = 0; this.contactDamage = 1; this.score = 250; this.px = CX; this.py = CY;
    }
    start() {
        this.transform.position = new Vector2(this.px, this.py); this.transform.size = new Vector2(128, 128);
        this.addComponent(mkSprite('shadow.png', { order: 1, opacity: 0.7 })).anchorY = 0.4;
        this.main = this.tail ? this.addComponent(mkSprite('boss_tail.png', { fw: 256, fh: 256, frames: 4, fps: 8, order: 5 })) : this.addComponent(mkSprite('boss_seg.png', { fw: 256, fh: 256, frames: 4, fps: 0, order: 5 }));
        this.light = this.addComponent(new Light2D({ color: '#ffb02e', radius: 190, intensity: 0.55 }));
        addBody(this, 46, Layers.Enemy, () => {});
        Game.enemies.add(this);
    }
    onPlayerContact() { /* the boss does not die on contact; the player just takes damage */ }
    update() {
        super.update();
        const dt = Constants.DELTA_TIME;
        if (this.boss.state === 'enter' || Game.state !== 'boss') return;
        this.fireT -= dt;
        if (this.fireT < 1.0 && this.fireT > 0) { this.windup = 1 - this.fireT; this.flash(Math.max(this.hitFlash, 0.25 + 0.25 * Math.sin(this.fireT * 45))); this.light.intensity = 1.0; }
        else this.light.intensity = 0.55 + (this.hp <= 2 ? 0.3 : 0);
        if (this.fireT <= 0) { this.fire(); this.fireT = rand(4.5, 7.5) / this.boss.aggression; }
        if (!this.tail && this.hp <= 2 && this.main.currentFrame !== 1) this.main.currentFrame = 1;
        if (this.tail && this.hp <= 4) this.main.fps = 14;
    }
    fire() {
        const p = this.transform.position, n = this.boss.phase >= 2 ? 8 : 6, a0 = rand(0, 6.28);
        for (let i = 0; i < n; i++) Game.spawn(new Orb(p.x, p.y, a0 + i * Math.PI * 2 / n, { speed: 250 }));
        Fx.sprite({ x: p.x, y: p.y, w: 120, sheet: 'spark_amb.png', frames: 6, fw: 128, fh: 128, cols: 6, fps: 36, order: 66 });
        sfx.play('turret_shot', { volume: 0.35, minGap: 0.12, pitch: 1.3 });
    }
    die() {
        if (this.dying) return; this.dying = true;
        const p = this.transform.position;
        Fx.explosion(p.x, p.y, { scale: 1.15 });
        Fx.sprite({ x: p.x, y: p.y, w: 128, sheet: 'boss_seg.png', frames: 4, fw: 256, fh: 256, cols: 4, life: 2.2, fade: 2, blend: 'normal', order: 9, rot: this.transform.rotation }).sprite.currentFrame = 3;
        sfx.play('seg_break', { volume: 0.9, minGap: 0 }); Game.shake(0.55); Game.hitStop(70); Game.zoomPunch(0.02);
        Game.addScore(this.tail ? 1000 : 250); Game.kills++;
        this.boss.onSegmentLost(this);
        this.destroy();
    }
}

/** THE WARDEN: a serpent made of a head, ten armoured segments and a tail core. The head leads along a figure-eight; the chain follows its path. */
export class Warden extends Enemy {
    static description = 'The boss: a segmented serpent. Break its segments to wear it down, then destroy the head.';
    constructor() {
        super(); this.tag = 'Warden'; this.order = 24; this.hp = 40; this.maxHp = 40; this.state = 'enter'; this.t = 0; this.u = 0; this.heading = 0; this.phase = 1;
        this.history = []; this.segments = []; this.attackT = 3; this.ringT = 7; this.laserT = 9; this.snarl = 0; this.aggression = 1; this.score = 5000; this.contactDamage = 1;
    }
    start() {
        this.transform.position = new Vector2(CX, CY); this.transform.size = new Vector2(10, 10);
        this.addComponent(mkSprite('shadow.png', { order: 1, opacity: 0.8 })).anchorX = 0.5;
        this.main = this.addComponent(mkSprite('boss_head.png', { fw: 384, fh: 384, frames: 4, fps: 0, order: 5, ax: 0.4375 }));
        this.light = this.addComponent(new Light2D({ color: '#ffb02e', radius: 340, intensity: 0.9 }));
        this.addComponent(new Animator({ playOnStart: true, defaultClip: 'enter', clips: [{ name: 'enter', duration: 1.4, loop: false, tracks: [
            { path: 'transform.size.x', keys: [{ t: 0, v: 10, ease: 'backOut' }, { t: 1.4, v: 200 }] }, { path: 'transform.size.y', keys: [{ t: 0, v: 10, ease: 'backOut' }, { t: 1.4, v: 200 }] }], events: [] }] }));
        this.body = addBody(this, 62, Layers.Enemy, () => {});
        this.body.collider.enabled = false;
        for (let i = 0; i < 260; i++) this.history.push({ x: CX, y: CY });
        for (let i = 0; i < SEGMENTS + 1; i++) this.segments.push(Game.spawn(new BossSegment(this, i, i === SEGMENTS)));
        Game.enemies.add(this); Game.boss = this;
        sfx.play('roar', { minGap: 0 }); Game.shake(0.9);
        Fx.ring(CX, CY, { color: 'amb', from: 40, to: 900, time: 1.0 }); Fx.ring(CX, CY, { color: 'mag', from: 20, to: 600, time: 0.8 });
    }
    get alive() { return this.segments.filter(s => !s.dying && !s.destroyed); }
    get speedMul() { return (this.phase === 1 ? 1 : this.phase === 2 ? 1.2 : 1.45) * (1 + (SEGMENTS - this.alive.length) * 0.025); }
    onSegmentLost() {
        if (this.dying) return;
        this.hp -= 2; this.flash(1); this.updateFrame();
        if (this.hp <= 0) this.die();
        else this.checkPhase();
    }
    onHit() { this.updateFrame(); this.checkPhase(); }
    takeHit(dmg, src) { if (this.state === 'enter') return; super.takeHit(dmg, src); }
    updateFrame() { this.main.currentFrame = this.snarl > 0 ? 1 : (this.hp <= this.maxHp * 0.33 ? 3 : this.hp <= this.maxHp * 0.66 ? 2 : 0); }
    checkPhase() {
        const frac = this.hp / this.maxHp, want = frac <= 0.33 ? 3 : frac <= 0.66 ? 2 : 1;
        if (want > this.phase) {
            this.phase = want; this.aggression = 1 + (want - 1) * 0.35; this.snarl = 1.2; this.updateFrame();
            sfx.play('roar', { minGap: 0 }); Game.shake(1); Game.hitStop(120); Game.zoomPunch(0.06);
            Fx.ring(this.transform.position.x, this.transform.position.y, { color: 'mag', from: 40, to: 700, time: 0.7 });
            Game.director?.bossPhase(want);
        }
    }
    update() {
        super.update();
        const dt = Constants.DELTA_TIME, p = this.transform.position;
        this.t += dt;
        if (this.snarl > 0) { this.snarl -= dt; if (this.snarl <= 0) this.updateFrame(); }
        if (this.state === 'enter') { if (this.t > 1.4) { this.state = 'fight'; this.body.collider.enabled = true; this.t = 0; } }
        const pl = Game.player;
        // path: a figure-eight around the arena centre, speed scaled by phase and lost segments
        const prevX = p.x, prevY = p.y;
        if (Game.state === 'boss' || Game.state === 'intro-boss') this.u += dt * 0.5 * this.speedMul * (this.state === 'enter' ? 0.4 : 1) * (this.laser && !this.laser.destroyed ? 0.25 : 1);
        const nx = CX + 330 * Math.sin(this.u), ny = CY + 190 * Math.sin(this.u * 2);
        p.x = nx; p.y = ny;
        const mx = p.x - prevX, my = p.y - prevY;
        if (Math.hypot(mx, my) > 0.01) this.heading = lerpAngle(this.heading, Math.atan2(my, mx), Math.min(1, 10 * dt));
        // heading and aim: the head snaps its look toward the player a little while attacking
        this.transform.rotation = this.heading * 180 / Math.PI;
        // history for the chain
        const last = this.history[this.history.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) >= 5) { this.history.push({ x: p.x, y: p.y }); if (this.history.length > 900) this.history.shift(); }
        this.layoutChain(dt);
        this.light.intensity = 0.8 + 0.3 * Math.sin(performance.now() / 200) + (this.snarl > 0 ? 0.8 : 0);
        if (this.state !== 'fight' || !pl || pl.dead || Game.state !== 'boss') return;
        // attacks
        this.attackT -= dt; this.ringT -= dt; this.laserT -= dt;
        if (this.attackT <= 0) { this.fan(); this.attackT = rand(2.0, 2.8) / this.aggression; }
        if (this.phase >= 2 && this.ringT <= 0) { this.ring(); this.ringT = rand(6, 8) / this.aggression; }
        if (this.phase >= 3 && this.laserT <= 0 && !(this.laser && !this.laser.destroyed)) { this.laser = Game.spawn(new Laser(this, Math.random() < 0.5 ? 1 : -1)); this.laserT = rand(9, 12); }
    }
    layoutChain(dt) {
        const alive = this.alive;
        let need = (alive.length + 1) * SPACING, acc = 0, idx = this.history.length - 1, j = 0;
        // walk back along the history, dropping a segment each SPACING of path length
        let prev = this.history[idx], target = SPACING;
        for (let i = idx - 1; i >= 0 && j < alive.length; i--) {
            const h = this.history[i]; acc += Math.hypot(h.x - prev.x, h.y - prev.y); prev = h;
            if (acc >= target) {
                const seg = alive[j], sp = seg.transform.position, k = 1 - Math.exp(-16 * dt);
                const ahead = this.history[Math.min(idx, i + 4)];
                seg.heading = Math.atan2(ahead.y - h.y, ahead.x - h.x);
                sp.x += (h.x - sp.x) * k; sp.y += (h.y - sp.y) * k;
                seg.transform.rotation = seg.heading * 180 / Math.PI;
                j++; target += SPACING;
            }
        }
        void need;
    }
    fan() {
        const p = this.transform.position, pl = Game.player, a = angleTo(p, pl.position), n = this.phase === 1 ? 5 : 7, spread = 0.9;
        this.snarl = 0.45; this.updateFrame();
        for (let i = 0; i < n; i++) Game.spawn(new Orb(p.x + Math.cos(this.heading) * 90, p.y + Math.sin(this.heading) * 90, a - spread / 2 + spread * i / (n - 1), { speed: 360, big: i === (n >> 1), amber: false }));
        sfx.play('turret_shot', { volume: 0.6, minGap: 0.1, pitch: 0.7 }); Game.shake(0.2);
        Fx.sprite({ x: p.x + Math.cos(this.heading) * 90, y: p.y + Math.sin(this.heading) * 90, w: 190, sheet: 'spark_amb.png', frames: 6, fw: 128, fh: 128, cols: 6, fps: 34, order: 66, light: { color: '#ff2e88', radius: 300, intensity: 1.4 } });
    }
    ring() {
        const p = this.transform.position;
        this.snarl = 0.9; this.updateFrame(); sfx.play('shockwave', { minGap: 0 }); sfx.play('roar', { volume: 0.6, minGap: 0 }); Game.shake(0.5);
        Game.spawn(new ShockRing(p.x, p.y, 380 + 40 * this.phase));
    }
    die() {
        if (this.dying) return; this.dying = true; Game.boss = null;
        Game.director?.onBossDead(this);
        this.destroy();
    }
}
const lerpAngle = (a, b, t) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * t; };

EntityRegistry.register('Warden', Warden, 'Neon Warden');
