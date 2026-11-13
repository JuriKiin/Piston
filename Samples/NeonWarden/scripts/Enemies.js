import { Vector2 } from "@piston/Physics/Vector2.js";
import { Animator } from "@piston/Animator.js";
import { Light2D } from "@piston/Light2D.js";
import { BeamRenderer } from "@piston/BeamRenderer.js";
import { EntityRegistry } from "@piston/EntityRegistry.js";
import Constants from "@piston/static/Constants.js";
import { Actor, Game, Layers, addBody, mkSprite, CX, CY, PLAY_R, ARENA_R, clamp, lerp, rand, angleTo } from "./Game.js";
import { Orb } from "./Projectiles.js";
import { Fx } from "./Fx.js";
import { sfx } from "./Sfx.js";

/** Shared enemy behaviour: hit points, being hit (flash, spark, sound), registration with the Game. */
export class Enemy extends Actor {
    constructor() { super(); this.hp = 1; this.dying = false; this.score = 100; }
    onDestroy() { Game.enemies.delete(this); }
    takeHit(dmg, src) {
        if (this.dying) return;
        this.hp -= dmg; this.flash(1);
        const p = src?.transform?.position ?? this.transform.position;
        Fx.hitSpark(p.x, p.y, src ? Math.atan2(src.vy ?? 0, src.vx ?? 0) * 180 / Math.PI + 180 : 0, false);
        sfx.play('hit', { volume: 0.45, minGap: 0.04, jitter: 0.2 });
        this.onHit?.(src);
        if (this.hp <= 0) this.die();
    }
    die() { this.dying = true; this.destroy(); }
}

/** A spinning kamikaze drone: circles in, telegraphs (pulses and brightens), then dives at the player. */
export class Drone extends Enemy {
    static description = 'A kamikaze drone that circles, telegraphs, and dives at the player.';
    constructor(x = CX, y = CY - 300) {
        super(); this.tag = 'Drone'; this.order = 20; this.px = x; this.py = y; this.hp = 2; this.vx = 0; this.vy = 0;
        this.state = 'spawn'; this.t = 0; this.nextDive = rand(1.8, 3.6); this.dive = { x: 0, y: 0 }; this.contactDamage = 1; this.seed = Math.random() * 6.28;
    }
    start() {
        this.transform.position = new Vector2(this.px, this.py);
        this.transform.size = new Vector2(1, 1);
        this.addComponent(mkSprite('shadow.png', { order: 1, opacity: 0.7 })).anchorY = 0.4;
        this.main = this.addComponent(mkSprite('drone.png', { fw: 160, fh: 160, frames: 8, fps: 16, order: 5 }));
        this.light = this.addComponent(new Light2D({ color: '#ff2e88', radius: 150, intensity: 0.7 }));
        this.addComponent(new Animator({ playOnStart: true, defaultClip: 'spawn', clips: [{ name: 'spawn', duration: 0.5, loop: false, tracks: [
            { path: 'transform.size.x', keys: [{ t: 0, v: 4, ease: 'backOut' }, { t: 0.5, v: 84 }] }, { path: 'transform.size.y', keys: [{ t: 0, v: 4, ease: 'backOut' }, { t: 0.5, v: 84 }] }], events: [] }] }));
        this.body = addBody(this, 26, Layers.Enemy, () => {});
        this.body.collider.enabled = false;
        Game.enemies.add(this);
        Fx.ring(this.px, this.py, { color: 'mag', from: 20, to: 150, time: 0.45, light: false });
    }
    onPlayerContact() { this.die(true); }
    update() {
        super.update();
        const dt = Constants.DELTA_TIME, p = this.transform.position, pl = Game.player;
        this.t += dt;
        if (this.state === 'spawn') { if (this.t > 0.5) { this.state = 'chase'; this.t = 0; this.body.collider.enabled = true; } return; }
        if (!pl || pl.dead) { this.vx *= 0.95; this.vy *= 0.95; p.x += this.vx * dt; p.y += this.vy * dt; return; }
        const dx = pl.position.x - p.x, dy = pl.position.y - p.y, d = Math.hypot(dx, dy) || 1;
        let tx = 0, ty = 0, speed = 0;
        if (this.state === 'chase') {
            const keep = 260; // circle at range
            const toward = d > keep ? 1 : -0.4, side = Math.sin(this.seed + performance.now() / 900);
            tx = (dx / d) * toward + (-dy / d) * side * 0.8; ty = (dy / d) * toward + (dx / d) * side * 0.8; speed = 250;
            if (this.t > this.nextDive && d < 600) { this.state = 'windup'; this.t = 0; sfx.play('windup', { volume: 0.5, minGap: 0.15 }); }
        } else if (this.state === 'windup') {
            speed = 0; this.flash(0.35 + 0.35 * Math.sin(this.t * 40)); this.main.fps = 40; this.light.intensity = 1.2;
            if (this.t > 0.5) { this.state = 'dive'; this.t = 0; this.dive = { x: dx / d, y: dy / d }; this.main.fps = 16; }
        } else if (this.state === 'dive') {
            tx = this.dive.x; ty = this.dive.y; speed = 720; this.light.intensity = 1.0;
            if (this.t > 0.75) { this.state = 'chase'; this.t = 0; this.nextDive = rand(2.2, 4); this.light.intensity = 0.7; }
        }
        // separation from other drones
        for (const e of Game.enemies) {
            if (e === this || !(e instanceof Drone)) continue;
            const ex = p.x - e.transform.position.x, ey = p.y - e.transform.position.y, ed = Math.hypot(ex, ey);
            if (ed < 70 && ed > 0.01) { tx += (ex / ed) * 0.9; ty += (ey / ed) * 0.9; }
        }
        const tl = Math.hypot(tx, ty) || 1, k = Math.min(1, 6 * dt);
        this.vx = lerp(this.vx, (tx / tl) * speed, k); this.vy = lerp(this.vy, (ty / tl) * speed, k);
        p.x += this.vx * dt; p.y += this.vy * dt;
        const r = Math.hypot(p.x - CX, p.y - CY); if (r > PLAY_R) { p.x = CX + (p.x - CX) / r * PLAY_R; p.y = CY + (p.y - CY) / r * PLAY_R; }
        this.transform.rotation += this.state === 'dive' ? 0 : 0;
    }
    onHit(src) { if (src?.vx !== undefined) { this.vx += src.vx * 0.05; this.vy += src.vy * 0.05; } }
    die(contact = false) {
        if (this.dying) return; this.dying = true;
        const p = this.transform.position;
        Fx.pop(p.x, p.y);
        sfx.play('boom_small', { volume: 0.7, minGap: 0.03, jitter: 0.2 });
        Game.shake(contact ? 0.3 : 0.18); Game.hitStop(contact ? 40 : 22);
        if (!contact) { Game.addScore(100); Game.kills++; }
        this.destroy();
    }
}

/** Static turret base (decoration with a soft shadow), spawned with each turret. */
export class TurretBase extends Actor {
    constructor(x = CX, y = CY) { super(); this.tag = 'TurretBase'; this.order = 8; this.px = x; this.py = y; }
    start() {
        this.transform.position = new Vector2(this.px, this.py); this.transform.size = new Vector2(1, 1);
        this.addComponent(mkSprite('turret_base.png', { order: 2 }));
        this.addComponent(new Animator({ playOnStart: true, defaultClip: 'rise', clips: [{ name: 'rise', duration: 0.7, loop: false, tracks: [
            { path: 'transform.size.x', keys: [{ t: 0, v: 20, ease: 'backOut' }, { t: 0.7, v: 128 }] }, { path: 'transform.size.y', keys: [{ t: 0, v: 20, ease: 'backOut' }, { t: 0.7, v: 128 }] }], events: [] }] }));
    }
}

/** A turret: tracks the player, charges (growing aim line), fires a fan of slow orbs, recoils. */
export class Turret extends Enemy {
    static description = 'A turret that charges an aim line and fires a fan of orbs.';
    constructor(x = CX, y = CY) {
        super(); this.tag = 'Turret'; this.order = 25; this.px = x; this.py = y; this.hp = 12; this.score = 400;
        this.state = 'rise'; this.t = 0; this.aim = 0; this.cd = rand(0.8, 1.6); this.charge = 0; this.sinking = false;
    }
    start() {
        this.transform.position = new Vector2(this.px, this.py);
        this.transform.size = new Vector2(1, 1);
        this.main = this.addComponent(mkSprite('turret_head.png', { fw: 256, fh: 256, frames: 6, fps: 0, order: 5 }));
        this.light = this.addComponent(new Light2D({ color: '#ffb02e', radius: 200, intensity: 0.4 }));
        // The aim telegraph: a strip along the turret's facing (the entity rotates, so the beam does too), grown and faded while charging.
        this.aimBeam = this.addComponent(new BeamRenderer({ imagePath: './assets/art/aim.png', startDistance: 56, length: 120, width: 18, blendMode: 'additive', opacity: 0, sortingOrder: 9 }));
        this.addComponent(new Animator({ playOnStart: true, defaultClip: 'rise', clips: [{ name: 'rise', duration: 0.7, loop: false, tracks: [
            { path: 'transform.size.x', keys: [{ t: 0, v: 20, ease: 'backOut' }, { t: 0.7, v: 128 }] }, { path: 'transform.size.y', keys: [{ t: 0, v: 20, ease: 'backOut' }, { t: 0.7, v: 128 }] }], events: [] }] }));
        this.body = addBody(this, 44, Layers.Enemy, () => {});
        this.body.collider.enabled = false;
        this.base = Game.spawn(new TurretBase(this.px, this.py));
        Game.enemies.add(this);
        sfx.play('spawn', { minGap: 0.1 });
        Fx.ring(this.px, this.py, { color: 'amb', from: 30, to: 260, time: 0.6 });
    }
    onDestroy() { super.onDestroy(); this.base?.destroy(); }
    update() {
        super.update();
        const dt = Constants.DELTA_TIME, pl = Game.player, p = this.transform.position;
        this.t += dt;
        if (this.state === 'rise') { if (this.t > 0.7) { this.state = 'idle'; this.t = 0; this.body.collider.enabled = true; } return; }
        if (this.sinking) return;
        if (pl && !pl.dead) {
            const want = angleTo(p, pl.position); let da = want - this.aim; da = Math.atan2(Math.sin(da), Math.cos(da));
            this.aim += da * Math.min(1, (this.state === 'charge' ? 2 : 5) * dt);
        }
        this.transform.rotation = this.aim * 180 / Math.PI;
        if (this.state === 'idle') {
            this.main.currentFrame = 0; this.light.intensity = 0.4;
            if (this.t > this.cd && pl && !pl.dead) { this.state = 'charge'; this.t = 0; sfx.play('charge', { volume: 0.6, minGap: 0.5 }); }
        } else if (this.state === 'charge') {
            this.charge = Math.min(1, this.t / 1.1);
            this.main.currentFrame = Math.min(4, 1 + Math.floor(this.charge * 4));
            this.light.intensity = 0.4 + this.charge * 1.4;
            if (this.t > 1.1) this.fireFan();
        } else if (this.state === 'fire') {
            this.main.currentFrame = this.t < 0.12 ? 5 : 0; this.charge = 0;
            if (this.t > 0.6) { this.state = 'idle'; this.t = 0; this.cd = rand(1.6, 2.8); }
        }
        const charging = this.state === 'charge';
        this.aimBeam.length = 120 + 560 * this.charge; this.aimBeam.opacity = charging ? 0.35 + 0.5 * this.charge : 0;
    }
    fireFan() {
        this.state = 'fire'; this.t = 0;
        const p = this.transform.position, c = Math.cos(this.aim), s = Math.sin(this.aim), mx = p.x + c * 56, my = p.y + s * 56;
        for (const off of [-0.28, 0, 0.28]) Orb.spawn(mx, my, this.aim + off, { speed: 250, amber: true });
        Fx.sprite({ x: mx, y: my, w: 140, sheet: 'spark_amb.png', frames: 6, fw: 128, fh: 128, cols: 6, fps: 40, order: 66, light: { color: '#ffb02e', radius: 240, intensity: 1.4 } });
        sfx.play('turret_shot', { volume: 0.7, minGap: 0.1 }); Game.shake(0.12);
        this.transform.position.x -= c * 8; this.transform.position.y -= s * 8; this.px = this.transform.position.x; this.py = this.transform.position.y;
    }
    sink() {
        if (this.sinking || this.dying) return; this.sinking = true;
        this.addComponent(new Animator({ playOnStart: true, defaultClip: 'sink', clips: [{ name: 'sink', duration: 0.6, loop: false, tracks: [
            { path: 'transform.size.x', keys: [{ t: 0, v: 128, ease: 'easeIn' }, { t: 0.6, v: 0 }] }, { path: 'transform.size.y', keys: [{ t: 0, v: 128, ease: 'easeIn' }, { t: 0.6, v: 0 }] }], events: [] }] }));
        this.aimBeam.opacity = 0; this.body.collider.enabled = false; this.lifetime = 0.65;
    }
    die() {
        if (this.dying) return; this.dying = true;
        const p = this.transform.position;
        Fx.explosion(p.x, p.y, { scale: 1.1 }); sfx.play('boom_small', { volume: 0.9, minGap: 0 }); Game.shake(0.4); Game.hitStop(60); Game.addScore(400); Game.kills++;
        this.destroy();
    }
}

EntityRegistry.register('Drone', Drone, 'Neon Warden');
EntityRegistry.register('Turret', Turret, 'Neon Warden');
