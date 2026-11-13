import { Entity } from "@piston/Entity.js";
import { Vector2 } from "@piston/Physics/Vector2.js";
import { SpriteRenderer } from "@piston/SpriteRenderer.js";
import { EntityRegistry } from "@piston/EntityRegistry.js";

/**
 * Purely decorative marker for a hole: a waving pixel-art flag (4 frames, see assets/art/flag.png). No rigidbody/collider.
 * `position` is the base of the pole: SpriteRenderer's bottom-center anchor keeps the foot planted at transform.position.
 */
export class Flag extends Entity {
    constructor(position, size) {
        super();
        this.tag = 'Flag';
        this.position = position ?? new Vector2(0, 0);
        this.size = size ?? new Vector2(32, 60);
    }

    start() {
        this.transform.position = this.position.clone();
        this.transform.size = this.size.clone();

        this.renderer = this.addComponent(new SpriteRenderer({
            imagePath: './assets/art/flag.png',
            frameWidth: 64,
            frameHeight: 120,
            frameCount: 4,
            columns: 4,
            fps: 6,
            anchorY: 1,
            sortingOrder: 4,
        }));
    }
}

EntityRegistry.register('Flag', Flag, 'Golf');
