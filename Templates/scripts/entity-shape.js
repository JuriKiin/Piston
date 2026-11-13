// @template: Shape Entity
// @kind: entity
// @summary: A simple entity drawn as a coloured circle. The easiest starting point.
import { Entity } from "@piston/Entity.js";
import { Vector2 } from "@piston/Physics/Vector2.js";
import { ShapeRenderer } from "@piston/ShapeRenderer.js";
import { EntityRegistry } from "@piston/EntityRegistry.js";

export class {{Class}} extends Entity {
    // Shown in the editor's Inspector and saved in scene files.
    static fields = [
        { key: 'radius', label: 'Radius', type: 'number' },
        { key: 'color', label: 'Color', type: 'color' },
    ];

    // Every constructor parameter needs a default: the editor creates entities with no arguments.
    constructor(position, radius = 16) {
        super();
        this.tag = '{{Class}}';
        this.position = position ?? new Vector2(0, 0);
        this.radius = radius;
        this.color = '#ff8800';
    }

    start() {
        this.transform.position = this.position.clone();
        this.transform.size = new Vector2(this.radius * 2, this.radius * 2);
        this.renderer = this.addComponent(new ShapeRenderer({ shape: 'circle', color: this.color, radius: this.radius }));
    }

    update() {
        super.update();
        // Runs every frame while the game is playing.
    }
}

EntityRegistry.register('{{Class}}', {{Class}}, 'Game');
