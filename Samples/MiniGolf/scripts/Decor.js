import { Entity } from "@piston/Entity.js";
import { Vector2 } from "@piston/Physics/Vector2.js";
import { SpriteRenderer } from "@piston/SpriteRenderer.js";
import { EntityRegistry } from "@piston/EntityRegistry.js";

const KINDS = ['tree', 'bush', 'flowers', 'pine', 'windmill', 'hub', 'boost'];

/** Scenery with no physics: trees, bushes, flowers, a windmill tower. Pick the picture with `kind`; scale it with the transform size. */
export class Decor extends Entity {
    static fields = [
        { key: 'kind', label: 'Kind', type: 'select', options: KINDS },
    ];

    constructor(position, size) {
        super();
        this.tag = 'Decor';
        this.position = position ?? new Vector2(0, 0);
        this.size = size ?? new Vector2(64, 64);
        this._kind = 'tree';
    }

    get kind() { return this._kind; }
    set kind(k) { this._kind = k; this.#show(); }

    start() {
        this.transform.position = this.position.clone();
        this.transform.size = this.size.clone();
        this.renderer = this.addComponent(new SpriteRenderer({ sortingOrder: 6 }));
        this.renderer.pixelArt = true;
        this.#show();
    }

    /** Points the sprite at this kind's picture (called at start and whenever `kind` changes). */
    #show() {
        const r = this.renderer;
        if (!r) return;
        const trees = { tree: 0, bush: 1, flowers: 2, pine: 3 };
        if (this._kind in trees) {
            Object.assign(r, { imagePath: './assets/art/decor.png', frameWidth: 32, frameHeight: 32, frameCount: 4, columns: 4, fps: 0, anchorY: 0.75, sortingOrder: 6 });
            r.playing = false;
            r.currentFrame = trees[this._kind];
        } else {
            const file = { hub: 'hub.png', windmill: 'windmill.png', boost: 'boost.png' }[this._kind] ?? 'windmill.png';
            Object.assign(r, { imagePath: `./assets/art/${file}`, frameWidth: 0, frameHeight: 0, frameCount: 1, anchorY: this._kind === 'windmill' ? 0.8 : 0.5, sortingOrder: this._kind === 'hub' ? 7 : this._kind === 'boost' ? 1 : 6 });
            r.playing = false;
        }
    }
}

EntityRegistry.register('Decor', Decor, 'Golf');
