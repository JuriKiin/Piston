// @template: Spin Behaviour
// @kind: component
// @summary: A working example: rotates its entity at a steady speed. Replace the update() body with your own.
import { Component } from "@piston/Component.js";
import { ComponentRegistry } from "@piston/ComponentRegistry.js";
import Constants from "@piston/static/Constants.js";

export class {{Class}} extends Component {
    static fields = [
        { key: 'degreesPerSecond', label: 'Speed (deg/s)', type: 'number' },
    ];

    constructor({ degreesPerSecond = 90 } = {}) {
        super();
        this.degreesPerSecond = degreesPerSecond;
    }

    update() {
        this.entity.transform.rotation += this.degreesPerSecond * Constants.DELTA_TIME;
    }
}

ComponentRegistry.register('{{Class}}', {{Class}}, 'game');
