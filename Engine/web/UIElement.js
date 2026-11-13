import { Entity } from './Entity.js';
import { Vector2 } from './Physics/Vector2.js';
import { EntityRegistry } from './EntityRegistry.js';

/**
 * A bare host for UI components (UIContainer/Text/Button - see js/engine/UI/) - no rigidbody, no
 * collider, just a transform to hang them off of. Text/Button/UIContainer are deliberately generic
 * ("could theoretically be added by any object"), so this exists purely so a HUD element doesn't
 * need its own hand-written Entity subclass just to have somewhere to addComponent() them onto,
 * the same role Polygon.js plays for PolygonRenderer + PolygonCollider pairs.
 */
export class UIElement extends Entity {
    static description = "A screen-space UI entity (HUD text, buttons). It stays fixed on screen instead of moving with the camera.";

    // 'Screen' (the default - fixed relative to the viewport, unaffected by the camera panning or
    // zooming, the way a HUD label like a shot counter should behave) or 'World' (a real world
    // position that pans/zooms with everything else - a floating name tag over something in the
    // scene, say). See GameLoop#render's split render pass for how this is actually applied.
    static fields = [
        { key: 'space', label: 'Space', type: 'select', options: ['Screen', 'World'] },
    ];

    constructor(position, size) {
        super();
        this.tag = 'UIElement';
        this.position = position ?? new Vector2(0, 0);
        this.size = size ?? new Vector2(120, 40);
        this.space = 'Screen';
    }

    start() {
        this.transform.position = this.position.clone();
        this.transform.size = this.size.clone();
    }
}

EntityRegistry.register('UIElement', UIElement, 'UI');
