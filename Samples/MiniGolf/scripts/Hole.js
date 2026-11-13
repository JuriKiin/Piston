import { Entity } from "@piston/Entity.js";
import { CircleCollider } from "@piston/Physics/Colliders/CircleCollider.js";
import { Rigidbody } from "@piston/Physics/Rigidbody.js";
import { Vector2 } from "@piston/Physics/Vector2.js";
import { SpriteRenderer } from "@piston/SpriteRenderer.js";
import { ParticleEmitter } from "@piston/ParticleEmitter.js";
import { PlayState } from "@piston/PlayState.js";
import { EntityRegistry } from "@piston/EntityRegistry.js";
import { LevelFlow } from "@piston/LevelFlow.js";
import { sfx, wait } from "./Sfx.js";

export class Hole extends Entity {
    constructor(position, radius = 16) {
        super();
        this.tag = 'Hole';
        this.position = position ?? new Vector2(0, 0);
        this.radius = radius;
        this.sunk = false;
    }

    start() {
        this.transform.position = this.position.clone();
        this.transform.size = new Vector2(this.radius * 2.4, this.radius * 2.4);

        const rb = new Rigidbody();
        rb.isStatic = true;
        rb.useGravity = false;
        rb.collider = new CircleCollider(this, this.radius);
        rb.collider.isTrigger = true; // detect the ball without physically stopping it

        rb.collider.onCollisionEnter = (otherCollider) => {
            if (this.sunk || otherCollider.entity.tag !== 'Ball') return;
            this.sunk = true;
            this.#showFrame(1);
            this.onSunk(otherCollider.entity);
        };

        this.rigidbody = rb;

        this.renderer = this.addComponent(new SpriteRenderer({
            imagePath: './assets/art/hole.png', frameWidth: 24, frameHeight: 24, frameCount: 2, columns: 2, fps: 0,
        }));
        this.renderer.pixelArt = true;
        this.#showFrame(0);
    }

    #showFrame(n) {
        if (!this.renderer) return;
        this.renderer.playing = false;
        this.renderer.currentFrame = n;
    }

    captureEditState() {
        const state = super.captureEditState();
        state.sunk = this.sunk;
        return state;
    }

    restoreEditState(state) {
        super.restoreEditState(state);
        this.sunk = state.sunk;
        this.#showFrame(this.sunk ? 1 : 0);
    }

    /** The ball drops in (its "sink" animation), the hole celebrates, then the engine records strokes vs par and moves on. */
    async onSunk(ball) {
        const loop = window.Piston.gameLoop, sceneId = loop.scene?.id;
        const strokes = ball.shotCount; // read now: the ball is removed once it has sunk
        sfx.play('sink', { minGap: 0 });
        await ball.sink(this.transform.position.clone());
        if (this.destroyed || loop.scene?.id !== sceneId || loop.playState === PlayState.Edit) return;

        sfx.play('win', { minGap: 0 });
        sfx.play('cheer', { volume: 0.5, minGap: 0 });
        for (const emitter of this.components.filter(c => c instanceof ParticleEmitter)) emitter.burst();
        await wait(1300);
        if (this.destroyed || loop.scene?.id !== sceneId || loop.playState === PlayState.Edit) return; // Stop was pressed meanwhile

        await LevelFlow.finish(loop, strokes);
    }
}

EntityRegistry.register('Hole', Hole, 'Golf');
