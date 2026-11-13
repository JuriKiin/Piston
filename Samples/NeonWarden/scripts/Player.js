import { Vector2 } from "@piston/Physics/Vector2.js";
import { SpriteAnimator } from "@piston/SpriteAnimator.js";
import { TrailRenderer } from "@piston/TrailRenderer.js";
import { Light2D } from "@piston/Light2D.js";
import { ParticleEmitter } from "@piston/ParticleEmitter.js";
import { EntityRegistry } from "@piston/EntityRegistry.js";
import Constants from "@piston/static/Constants.js";
import input from "@piston/static/Input.js";
import { Actor, Game, Layers, addBody, mkSprite, CX, CY, PLAY_R, ART, clamp, lerp } from "./Game.js";
import { Bolt } from "./Projectiles.js";
import { Fx } from "./Fx.js";
import { sfx } from "./Sfx.js";

/** SPARK, the player's ship: twin-stick movement (WASD + mouse), auto-fire while the button is held, a dash with invulnerability. */
export class Player extends Actor {
    static description = 'The player ship: WASD/arrows to move, mouse to aim, hold the mouse or J to fire, Space or Shift to dash.';
    constructor(x = CX, y = CY) {
        super(); this.tag = 'Player'; this.order = 30; this.px = x; this.py = y;
        this.hp = 5; this.maxHp = 5; this.vx = 0; this.vy = 0; this.aim = 0; this.fireCd = 0; this.barrel = 1;
        this.invuln = 0; this.dashT = 0; this.dashCd = 0; this.dashDirX = 1; this.dashDirY = 0; this.dead = false; this.spawnT = 0;
    }
    start() {
        this.transform.position = new Vector2(this.px, this.py);
        this.transform.size = new Vector2(144, 96);
        this.addComponent(mkSprite('shadow.png', { order: 1, opacity: 0.8 })).anchorY = 0.46;
        this.main = this.addComponent(mkSprite('ship.png', { fw: 288, fh: 192, frames: 6, fps: 0, order: 5 }));
        this.anim = this.addComponent(new SpriteAnimator({ clips: [{ name: 'idle', from: 0, to: 2, fps: 10, loop: true }, { name: 'thrust', from: 3, to: 5, fps: 16, loop: true }], defaultClip: 'idle' }));
        this.trail = this.addComponent(new TrailRenderer({ emitting: false, lifetime: 0.28, minDistance: 6, startWidth: 36, endWidth: 0, startColor: '#bff6ff', endColor: '#33e6ff', blendMode: 'additive', sortingOrder: 2, opacity: 0.8 }));
        this.exhaust = this.addComponent(new ParticleEmitter({ emitting: true, rate: 0, imagePath: ART + 'glow.png', blendMode: 'additive', angle: 180, spread: 24, speed: 150, speedVariation: 0.5, drag: 2, lifetime: 0.35,
            startSize: 22, endSize: 2, startColor: '#bff6ff', endColor: '#2090ff', fade: true, sortingOrder: 3, maxParticles: 120, worldSpace: true }));
        this.light = this.addComponent(new Light2D({ color: '#33e6ff', radius: 300, intensity: 0.9 }));
        addBody(this, 20, Layers.Player, (e) => { if (e.contactDamage) { if (this.hurt(1, e)) e.onPlayerContact?.(this); } });
    }
    get position() { return this.transform.position; }

    hurt(n, source) {
        if (this.dead || this.invuln > 0 || this.dashT > 0) return false;
        this.hp -= n; this.invuln = 1.1; this.flash(1);
        const p = this.position;
        Game.shake(0.65); Game.hitStop(90); Game.zoomPunch(0.04); sfx.play('hurt', { minGap: 0.2 });
        Fx.hitSpark(p.x, p.y, 0, false);
        Game.director?.damagePulse();
        if (this.hp <= 0) this.die(); else if (this.hp === 1) sfx.play('alarm', { volume: 0.7, minGap: 3 });
        return true;
    }
    die() {
        this.dead = true; const p = this.position;
        Fx.explosion(p.x, p.y, { big: true, scale: 0.8 });
        Game.shake(1); Game.slowmo(0.35, 1400); sfx.play('boom_big', { minGap: 0 });
        this.main.opacity = 0; this.light.intensity = 0; this.trail.emitting = false; this.exhaust.emitting = false; this.rigidbody.collider.enabled = false;
        Game.director?.onPlayerDead();
    }

    update() {
        super.update();
        const dt = Constants.DELTA_TIME, p = this.position;
        if (this.dead) return;
        if (Game.state === 'intro' || Game.state === 'win') { this.vx *= 0.9; this.vy *= 0.9; }
        const canAct = Game.state !== 'intro' && Game.state !== 'win' && Game.state !== 'lose';
        // aim
        const m = window.Piston.gameLoop.getMouseWorldPosition();
        this.aim = Math.atan2(m.y - p.y, m.x - p.x);
        this.transform.rotation = this.aim * 180 / Math.PI;
        // move
        let ix = 0, iy = 0;
        if (canAct) {
            if (input.getKeyDown('KeyA') || input.getKeyDown('ArrowLeft')) ix -= 1;
            if (input.getKeyDown('KeyD') || input.getKeyDown('ArrowRight')) ix += 1;
            if (input.getKeyDown('KeyW') || input.getKeyDown('ArrowUp')) iy -= 1;
            if (input.getKeyDown('KeyS') || input.getKeyDown('ArrowDown')) iy += 1;
        }
        const il = Math.hypot(ix, iy) || 1; ix /= il; iy /= il;
        this.dashCd = Math.max(0, this.dashCd - dt); this.invuln = Math.max(0, this.invuln - dt);
        if (canAct && this.dashT <= 0 && this.dashCd <= 0 && (input.getKeyDown('Space') || input.getKeyDown('ShiftLeft'))) this.startDash(ix, iy);
        if (this.dashT > 0) {
            this.dashT -= dt; this.vx = this.dashDirX * 1250; this.vy = this.dashDirY * 1250;
            if (this.dashT <= 0) { this.trail.emitting = false; this.vx *= 0.3; this.vy *= 0.3; }
        } else {
            const k = Math.min(1, 12 * dt);
            this.vx = lerp(this.vx, ix * 560, k); this.vy = lerp(this.vy, iy * 560, k);
        }
        p.x += this.vx * dt; p.y += this.vy * dt;
        const dx = p.x - CX, dy = p.y - CY, d = Math.hypot(dx, dy);
        if (d > PLAY_R) { p.x = CX + dx / d * PLAY_R; p.y = CY + dy / d * PLAY_R; }
        const speed = Math.hypot(this.vx, this.vy), moving = speed > 80;
        this.anim.play(moving ? 'thrust' : 'idle');
        this.exhaust.rate = moving ? 90 : 18;
        this.exhaust.angle = 180; // relative to the ship's rotation
        // fire
        this.fireCd -= dt;
        const firing = canAct && (input.isMouseButtonPressed(0) || input.getKeyDown('KeyJ'));
        if (firing && this.fireCd <= 0) this.fire();
        // look
        const blink = this.invuln > 0 && Math.floor(this.invuln * 18) % 2 === 0;
        this.main.opacity = this.dashT > 0 ? 0.75 : (blink ? 0.35 : 1);
        this.light.intensity = 0.8 + 0.1 * Math.sin(performance.now() / 120);
    }
    startDash(ix, iy) {
        const dx = ix || iy ? ix : Math.cos(this.aim), dy = ix || iy ? iy : Math.sin(this.aim);
        this.dashDirX = dx; this.dashDirY = dy; this.dashT = 0.18; this.dashCd = 0.9; this.trail.emitting = true; this.trail.clear();
        sfx.play('dash', { volume: 0.7, minGap: 0.2 }); Game.shake(0.15);
        const p = this.position; Fx.ring(p.x, p.y, { color: 'cyan', from: 40, to: 200, time: 0.3, light: false });
        Game.director?.chromaticPulse(5);
    }
    fire() {
        this.fireCd = 1 / 12; this.barrel *= -1;
        const c = Math.cos(this.aim), s = Math.sin(this.aim), p = this.position, ox = 24, oy = 12 * this.barrel;
        const x = p.x + c * ox - s * oy, y = p.y + s * ox + c * oy, a = this.aim + (Math.random() - 0.5) * 0.045;
        Game.spawn(new Bolt(x, y, a));
        Fx.muzzle(x, y, a * 180 / Math.PI);
        sfx.play(`shot${1 + ((Math.random() * 3) | 0)}`, { volume: 0.5, minGap: 0.045, jitter: 0.1 });
        this.vx -= c * 12; this.vy -= s * 12; // tiny recoil
    }
}
EntityRegistry.register('Player', Player, 'Neon Warden');
