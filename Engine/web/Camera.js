import { Vector2 } from "./Physics/Vector2.js";
import { Component } from "./Component.js";
import { ComponentRegistry } from "./ComponentRegistry.js";
import Constants from "./static/Constants.js";

/**
 * A 2D camera: a world-space focus point + zoom, applied as a canvas transform before entities
 * render. A Component like any other - not a bespoke field GameLoop holds - so it lives on a
 * regular Entity and gets its position "for free" from that entity's own transform.position,
 * rather than tracking a separate one of its own. That means it's draggable in the Inspector,
 * follows the same Play<->Stop edit-state revert every entity already gets, round-trips through
 * the level file via the exact same generic per-entity/per-component serialization every other
 * component uses, and a consumer who wants entirely custom camera behavior can just write their
 * own Component instead of needing to special-case anything in GameLoop.
 *
 * GameLoop.camera finds this by scanning for the first live entity with one attached (see its own
 * doc comment) - so "the active camera" is simply whichever entity has this component, the same
 * way nothing else in the engine hardcodes which entity is "the player" or "the ball" either.
 */
export class Camera extends Component {
    static description = "A view onto the scene. The scene's camera decides what the player sees; zoom scales it.";

    static fields = [
        { key: 'zoom', label: 'Zoom', type: 'number', animatable: true },
    ];

    constructor({ zoom = 1 } = {}) {
        super();
        this.zoom = zoom;
        this.target = null;
        this.smoothing = 0; // 0 = snap instantly to the target; otherwise a per-second lerp factor
    }

    /** This camera's world-space focus point - its entity's own position, not a field of its own. */
    get position() {
        return this.entity.transform.position;
    }

    /** Makes the camera track an entity's transform.position every frame. */
    follow(entity, smoothing = 0) {
        this.target = entity;
        this.smoothing = smoothing;
    }

    stopFollowing() {
        this.target = null;
    }

    update() {
        if (!this.target) return;
        const targetPos = this.target.transform.position;
        const position = this.position;

        if (this.smoothing <= 0) {
            position.x = targetPos.x;
            position.y = targetPos.y;
        } else {
            // Frame-rate independent exponential smoothing.
            const t = 1 - Math.pow(1 - this.smoothing, Constants.DELTA_TIME);
            position.x += (targetPos.x - position.x) * t;
            position.y += (targetPos.y - position.y) * t;
        }
    }

    /** Applies this camera's transform to the context. Caller is responsible for save()/restore(). */
    apply(ctx, canvasWidth, canvasHeight) {
        const position = this.position;
        ctx.translate(canvasWidth / 2, canvasHeight / 2);
        ctx.scale(this.zoom, this.zoom);
        ctx.translate(-position.x, -position.y);
    }

    worldToScreen(worldPos, canvasWidth, canvasHeight) {
        const position = this.position;
        return new Vector2(
            (worldPos.x - position.x) * this.zoom + canvasWidth / 2,
            (worldPos.y - position.y) * this.zoom + canvasHeight / 2
        );
    }

    screenToWorld(screenPos, canvasWidth, canvasHeight) {
        const position = this.position;
        return new Vector2(
            (screenPos.x - canvasWidth / 2) / this.zoom + position.x,
            (screenPos.y - canvasHeight / 2) / this.zoom + position.y
        );
    }

    /** Only `zoom` needs its own Play<->Stop revert - `position` already gets one for free since
     * it's just this entity's own transform.position, which Entity.captureEditState/
     * restoreEditState already snapshot for every entity regardless of what's on it. */
    captureState() {
        return { zoom: this.zoom };
    }

    restoreState(state) {
        this.zoom = state.zoom;
    }
}

ComponentRegistry.register('Camera', Camera, 'engine');
