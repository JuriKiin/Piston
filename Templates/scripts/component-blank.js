// @template: Component
// @kind: component
// @summary: An empty component to attach to any entity (like a new MonoBehaviour).
import { Component } from "@piston/Component.js";
import { ComponentRegistry } from "@piston/ComponentRegistry.js";

export class {{Class}} extends Component {
    // Shown in the editor's Inspector and saved in scene files.
    static fields = [
        { key: 'speed', label: 'Speed', type: 'number' },
    ];

    // One options object, every key defaulted: the editor creates components with no arguments.
    constructor({ speed = 1 } = {}) {
        super();
        this.speed = speed;
    }

    start() {
        // Runs once, when the component is attached. `this.entity` is the entity it belongs to.
    }

    update() {
        // Runs every frame while the game is playing.
    }
}

ComponentRegistry.register('{{Class}}', {{Class}}, 'game');
