// @template: Sprite Entity
// @kind: entity
// @summary: An entity drawn from an image in your assets folder.
import { Entity } from "@piston/Entity.js";
import { Vector2 } from "@piston/Physics/Vector2.js";
import { SpriteRenderer } from "@piston/SpriteRenderer.js";
import { EntityRegistry } from "@piston/EntityRegistry.js";

export class {{Class}} extends Entity {
    static fields = [
        { key: 'imagePath', label: 'Image', type: 'text', accept: 'image' },
        { key: 'width', label: 'Width', type: 'number' },
        { key: 'height', label: 'Height', type: 'number' },
    ];

    constructor(position) {
        super();
        this.tag = '{{Class}}';
        this.position = position ?? new Vector2(0, 0);
        this.imagePath = './assets/sprite.png'; // put your image in the assets folder, then change this
        this.width = 64;
        this.height = 64;
    }

    start() {
        this.transform.position = this.position.clone();
        this.transform.size = new Vector2(this.width, this.height);
        // With no frame settings the whole image is drawn, scaled to the entity's size.
        this.renderer = this.addComponent(new SpriteRenderer({ imagePath: this.imagePath }));
    }

    update() {
        super.update();
    }
}

EntityRegistry.register('{{Class}}', {{Class}}, 'Game');
