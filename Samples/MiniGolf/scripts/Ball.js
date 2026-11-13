import { Entity } from "@piston/Entity.js";
import { CircleCollider } from "@piston/Physics/Colliders/CircleCollider.js";
import { PhysicsMaterial } from "@piston/Physics/PhysicsMaterial.js";
import { Rigidbody } from "@piston/Physics/Rigidbody.js";
import { Layers } from "@piston/Physics/CollisionMatrix.js";
import { Vector2 } from "@piston/Physics/Vector2.js";
import Constants from "@piston/static/Constants.js";
import input from "@piston/static/Input.js";
import { SpriteRenderer } from "@piston/SpriteRenderer.js";
import { Animator } from "@piston/Animator.js";
import { ParticleEmitter } from "@piston/ParticleEmitter.js";
import { PhysicsMaterialComponent } from "@piston/PhysicsMaterialComponent.js";
import { EntityRegistry } from "@piston/EntityRegistry.js";
import { Text } from "@piston/UI/Text.js";
import { sfx, wait } from "./Sfx.js";

/**
 * The golf ball. Aim by pulling back from it (drag) and let go. Its look and its sink / tunnel animations come from components in
 * the scene (SpriteRenderer, an Animator with "sink", "tunnelIn" and "tunnelOut" clips, a ParticleEmitter for dust), so they
 * are edited in the Animation panel and Inspector, not here. Without an Animator it falls back to a plain code shrink.
 */
export class Ball extends Entity {
    static fields = [
        { key: 'radius', label: 'Radius', type: 'number' },
        { key: 'maxDragDistance', label: 'Max Drag Dist.', type: 'number' },
        { key: 'powerScale', label: 'Power Scale', type: 'number' },
        { key: 'pickRadius', label: 'Pick Radius', type: 'number' },
        { key: 'restSpeed', label: 'Rest Speed', type: 'number' },
        { key: 'sinkDuration', label: 'Sink Duration (no-Animator fallback)', type: 'number' },
        { key: 'shotCount', label: "Shot Count", type: 'number' },
    ];

    constructor(position, radius = 12) {
        super();
        this.tag = 'Ball';
        this.startPosition = position ?? new Vector2(0, 0);
        this._radius = radius;
        this.maxDragDistance = 180; // pixels; clamps how far back a shot can be pulled
        this.powerScale = 0.1; // pull-back distance -> launch speed
        this.pickRadius = 40; // how close a mousedown must land to the ball to grab it
        this.restSpeed = 0.4; // the ball can only be grabbed once it has (all but) stopped: below this speed in pixels per frame
        this.wasHeld = false;
        this.sinkDuration = 0.4; // fallback shrink time when there is no Animator
        this.isDragging = false;
        this.dragCurrent = new Vector2(0, 0);
        this.isSinking = false;
        this.inTunnel = false;
        this.tunnelCooldown = 0;
        this.sinkTimer = 0;
        this.sinkStartRadius = radius;
        this.sinkTarget = null;
        this.sinkResolve = null;
        this.shotCount = 0;
    }

    get radius() { return this._radius; }
    set radius(r) {
        this._radius = r;
        if (this.transform?.size) this.transform.size = new Vector2(r * 2, r * 2);
        if (this.rigidbody?.collider) this.rigidbody.collider.radius = r;
    }

    start() {
        this.transform.position = this.startPosition.clone();
        this.transform.size = new Vector2(this.radius * 2, this.radius * 2);

        const rb = new Rigidbody();
        rb.mass = 1;
        rb.useGravity = false; // top-down: rolling, not falling
        rb.physicsMaterial = PhysicsMaterial.Turf;
        rb.collider = new CircleCollider(this, this.radius);
        rb.collider.layer = Layers.Player; // sections of a hole can keep the ball in or ignore it by layer (see Tunnel)
        rb.collider.onCollisionEnter = (other) => this.#onContact(other);
        this.rigidbody = rb;

        this.renderer = this.addComponent(new SpriteRenderer({
            imagePath: './assets/art/ball.png', frameWidth: 64, frameHeight: 64, frameCount: 1, columns: 1, fps: 0, sortingOrder: 3,
        }));
    }

    /** Sounds and puffs for whatever the ball just touched. */
    #onContact(other) {
        const e = other.entity;
        if (!e || this.isSinking || this.inTunnel) return;
        const speed = this.rigidbody.velocity.magnitude();
        const material = e.getComponent?.(PhysicsMaterialComponent);
        if (material?.zone || other.isTrigger) {
            if (material?.kind === 'sand') { sfx.play('sand', { volume: 0.7 }); this.#puff('#d8c08a'); }
            else if (material?.kind === 'boost') sfx.play('boost', { volume: 0.8 });
            return;
        }
        if (e.tag === 'Hole' || e.tag === 'Tunnel' || speed < 25) return;
        const volume = Math.min(1, 0.2 + speed / 500);
        const pitch = 0.92 + Math.random() * 0.16;
        if (e.tag === 'Bumper') sfx.play('bumper', { volume, pitch });
        else if (e.tag === 'Rock') sfx.play('rock', { volume, pitch });
        else sfx.play('wall', { volume, pitch });
    }

    #puff(color = '#e9e4d0', count = 8) {
        const emitter = this.getComponent(ParticleEmitter);
        if (!emitter) return;
        const keep = emitter.startColor;
        emitter.startColor = color; emitter.endColor = color;
        emitter.burst(count);
        emitter.startColor = keep; emitter.endColor = keep;
    }

    update() {
        super.update();
        if (this.tunnelCooldown > 0) this.tunnelCooldown -= Constants.DELTA_TIME;
        if (this.inTunnel) return;

        if (this.isSinking) {
            this.#updateSinking();
            return;
        }

        const mouseWorld = window.Piston.gameLoop.getMouseWorldPosition();
        const isHeld = input.isMouseButtonPressed(0);
        const pressed = isHeld && !this.wasHeld; // a fresh press: holding the button while the ball was still rolling must not grab it
        this.wasHeld = isHeld;

        if (this.isDragging) {
            if (isHeld) {
                this.dragCurrent = mouseWorld;
            } else {
                this.#launch();
            }
        } else if (pressed && this.#isAtRest()) {
            if (Vector2.distance(mouseWorld, this.transform.position) <= this.pickRadius) {
                this.isDragging = true;
                this.dragCurrent = mouseWorld;
            }
        }
    }

    #isAtRest() {
        return this.rigidbody.velocity.magnitude() < this.restSpeed;
    }

    captureEditState() {
        const state = super.captureEditState();
        state.radius = this.radius;
        state.isSinking = this.isSinking;
        state.shotCount = this.shotCount;
        return state;
    }

    restoreEditState(state) {
        super.restoreEditState(state);
        this.radius = state.radius;
        this.isSinking = state.isSinking;
        this.inTunnel = false;
        this.tunnelCooldown = 0;
        this.shotCount = state.shotCount;
        this.isDragging = false;
        this.sinkTimer = 0;
        this.sinkTarget = null;
        this.sinkResolve = null;
    }

    /** Called by Hole on contact: freezes physics and plays the "sink" animation. Resolves when the ball has vanished into the hole. */
    sink(targetPosition) {
        if (this.isSinking) return Promise.resolve();
        this.isSinking = true;
        this.isDragging = false;
        this.sinkTimer = 0;
        this.sinkStartRadius = this.radius;
        this.sinkTarget = targetPosition;

        this.rigidbody.velocity = new Vector2(0, 0);
        this.rigidbody.angularVelocity = 0;
        this.rigidbody.isStatic = true; // stop reacting to any further physics
        if (this.rigidbody.collider) this.rigidbody.collider.enabled = false; // stop registering new collisions

        const animator = this.getComponent(Animator);
        if (animator?.clips.some(c => c.name === 'sink')) {
            this.sinkAnimator = animator;
            return animator.playAsync('sink').then(() => { this.destroy(); });
        }
        this.sinkAnimator = null;
        return new Promise((resolve) => { this.sinkResolve = resolve; });
    }

    #updateSinking() {
        if (this.sinkAnimator) { // the scene's "sink" clip scales the ball; the code only draws it toward the hole
            const clip = this.sinkAnimator.clips.find(c => c.name === 'sink');
            const t = Math.min(1, this.sinkAnimator.time / Math.max(0.01, clip?.duration ?? 0.4));
            this.transform.position.lerp(this.sinkTarget, 0.25 + 0.5 * t);
            return;
        }
        this.sinkTimer += Constants.DELTA_TIME;
        const t = Math.min(this.sinkTimer / this.sinkDuration, 1);
        this.radius = this.sinkStartRadius * (1 - t);
        this.transform.position.lerp(this.sinkTarget, t);
        if (t >= 1) {
            this.destroy();
            this.sinkResolve?.();
        }
    }

    /** Called by a Tunnel mouth: the ball shrinks away, is gone for a beat, and comes out of `to` heading where it points. */
    async enterTunnel(from, to) {
        if (this.isSinking || this.inTunnel || this.tunnelCooldown > 0) return;
        const loop = window.Piston.gameLoop, sceneId = loop.scene?.id;
        const speed = Math.max(this.rigidbody.velocity.magnitude(), to.exitSpeed ?? 260);
        this.inTunnel = true;
        this.isDragging = false;
        this.rigidbody.velocity = new Vector2(0, 0);
        this.rigidbody.isStatic = true;
        if (this.rigidbody.collider) this.rigidbody.collider.enabled = false;
        sfx.play('tunnel', { volume: 0.8 });

        const animator = this.getComponent(Animator);
        this.transform.position = from.transform.position.clone();
        await animator?.playAsync('tunnelIn');
        await wait(320);
        if (this.destroyed || loop.scene?.id !== sceneId || loop.playState === 'edit') return;

        const turn = (to.transform.rotation * Math.PI) / 180;
        const dir = new Vector2(-Math.sin(turn), Math.cos(turn)); // the mouth opens "down" at rotation 0
        this.transform.position = to.transform.position.clone().add(dir.clone().scale(to.radius + this.radius + 6));
        to.getComponent(ParticleEmitter)?.burst(14);
        sfx.play('tunnel', { volume: 0.8, pitch: 1.25, minGap: 0 });

        this.rigidbody.isStatic = false;
        if (this.rigidbody.collider) { this.rigidbody.collider.enabled = true; this.rigidbody.collider.layer = Layers[to.ballLayer] ?? Layers.Player; }
        this.rigidbody.velocity = dir.clone().scale(speed);
        this.tunnelCooldown = 0.8;
        this.inTunnel = false;
        animator?.playAsync('tunnelOut');
    }

    /** Releases the drag: shoots opposite the pull direction, powered by how far it was pulled. */
    #launch() {
        const shot = this.transform.position.clone().subtract(this.dragCurrent);
        shot.clampMagnitude(this.maxDragDistance).scale(this.powerScale);
        this.rigidbody.velocity = shot;
        this.isDragging = false;
        this.shotCount++;

        const power = Math.min(1, shot.magnitude() / (this.maxDragDistance * this.powerScale));
        sfx.play('hit', { volume: 0.35 + 0.65 * power, pitch: 0.9 + 0.3 * power, minGap: 0 });
        this.#puff('#e9e4d0', 4 + Math.round(power * 8));

        const shotCountObj = window.Piston.gameLoop.findObjectWithTag("ShotCount");
        const shotCountText = shotCountObj?.getComponent(Text);
        if (shotCountText) {
            shotCountText.text = `Stroke ${this.shotCount}`;
        }
    }

    draw(ctx) {
        if (this.isSinking || this.inTunnel) return;
        if (this.isDragging) { this.#drawAim(ctx); return; }
        if (this.#isAtRest()) { // a slowly turning dashed ring says "your turn"; it is gone while the ball is moving
            const t = performance.now() / 1000;
            ctx.save();
            ctx.beginPath();
            ctx.arc(0, 0, this.radius + 8 + Math.sin(t * 3) * 1.5, 0, Math.PI * 2);
            ctx.setLineDash([7, 8]);
            ctx.lineDashOffset = -t * 16;
            ctx.lineCap = 'round';
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
            ctx.stroke();
            ctx.restore();
        }
    }

    /** The aiming guide: a faint pull-back line to the cursor, and a trail of dots (and an arrowhead) showing where the shot will go,
     * longer and warmer the harder you pull (green, then gold, then red at full power). */
    #drawAim(ctx) {
        const aim = this.transform.position.clone().subtract(this.dragCurrent).rotate(-this.transform.rotation); // ball minus cursor, in the ball's own space
        const pull = Math.min(aim.magnitude(), this.maxDragDistance);
        if (pull < 8) return;
        const power = pull / this.maxDragDistance;
        const dir = aim.clone().normalize();
        const [r, g, b] = powerColor(power);
        ctx.save();
        ctx.lineCap = 'round';

        const handle = dir.clone().scale(-pull); // where the pull-back handle sits (the cursor, held inside the maximum pull)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(handle.x, handle.y); ctx.stroke();
        ctx.beginPath(); ctx.arc(handle.x, handle.y, 13, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.18)'; ctx.fill();
        ctx.lineWidth = 4; ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`; ctx.stroke();

        const length = 70 + power * 230;
        for (let d = this.radius + 14; d < length; d += 24) {
            const k = d / length;
            ctx.beginPath();
            ctx.arc(dir.x * d, dir.y * d, 7 - 3.5 * k, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${1 - 0.6 * k})`;
            ctx.fill();
            ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(20, 30, 24, 0.35)'; ctx.stroke();
        }
        const tip = dir.clone().scale(length + 8), side = new Vector2(-dir.y, dir.x);
        ctx.beginPath();
        ctx.moveTo(tip.x + dir.x * 14, tip.y + dir.y * 14);
        ctx.lineTo(tip.x + side.x * 11, tip.y + side.y * 11);
        ctx.lineTo(tip.x - side.x * 11, tip.y - side.y * 11);
        ctx.closePath();
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.45)`; ctx.fill();
        ctx.restore();
    }
}

/** Green at a gentle pull, gold at about half, red at full power. */
function powerColor(p) {
    const lerp = (a, b, t) => Math.round(a + (b - a) * t);
    const [low, mid, high] = [[126, 231, 135], [255, 209, 102], [255, 107, 107]];
    const [from, to, t] = p < 0.5 ? [low, mid, p / 0.5] : [mid, high, (p - 0.5) / 0.5];
    return [lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)];
}

EntityRegistry.register('Ball', Ball, 'Golf');
