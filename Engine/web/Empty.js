import { Entity } from './Entity.js';
import { EntityRegistry } from './EntityRegistry.js';

/**
 * A bare Entity with no renderer, collider, or behavior of its own - nothing to add to it, just
 * something to exist at a point in the scene. Its main job is as a group anchor: parent other
 * entities under one (see Entity#setParent/moveBy) and dragging it moves the whole group together,
 * the same role an empty GameObject plays in Unity. Draws a small crosshair so it's actually
 * findable/selectable on the canvas despite having nothing else to render - MainCamera and
 * InputBindingLayer get away with being fully invisible because you'd only ever go looking for them
 * in the entity list, but a group anchor is something you want to grab and drag directly.
 */
export class Empty extends Entity {
    static description = "A blank entity with just a transform. Use it as a group or container, a spawn point, or a place to hang components.";

    start() {
        this.tag = 'Empty';
    }

    draw(ctx) {
        const size = 10;
        ctx.strokeStyle = '#ffd24d';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-size, 0);
        ctx.lineTo(size, 0);
        ctx.moveTo(0, -size);
        ctx.lineTo(0, size);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
        ctx.stroke();
    }
}

EntityRegistry.register('Empty', Empty, 'General');
