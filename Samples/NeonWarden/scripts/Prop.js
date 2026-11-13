import { Entity } from "@piston/Entity.js";
import { EntityRegistry } from "@piston/EntityRegistry.js";

/** A plain scenery entity: just a transform that hosts components (a floor sprite, a glow, an emitter). Unlike Empty it draws no editor crosshair. */
export class Prop extends Entity {
    static description = 'Scenery: a transform that hosts components such as a SpriteRenderer. Draws nothing by itself.';
    constructor() { super(); this.tag = 'Prop'; }
    start() { this.tag = 'Prop'; }
}
EntityRegistry.register('Prop', Prop, 'Neon Warden');
