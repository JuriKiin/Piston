import { Component } from '../Component.js';
import { ComponentRegistry } from '../ComponentRegistry.js';
import input from '../static/Input.js';

/**
 * Turns whatever entity it's attached to into a clickable button - an axis-aligned hit test against
 * that entity's own transform.size (typically paired with a UIContainer for the visible button and
 * a Text for its label, all three on the same entity), firing `onClick` once per press rather than
 * every frame the mouse happens to be down. Like Hole's `onSunk`, `onClick` is a plain injected
 * function, not something Inspector-editable or saved - it's how the button DOES something, not a
 * tunable value, the same distinction SceneIO already draws elsewhere.
 *
 * Runs during Component.update(), which GameLoop only calls while Playing (see Entity.update) - a
 * button in an Edit-mode HUD mockup won't fire while you're just laying out the scene.
 */
export class Button extends Component {
    static description = "A clickable screen-space button.";

    static fields = [
        { key: 'sortingOrder', label: 'Order', type: 'number' },
    ];

    constructor({ onClick = null, sortingOrder = 0 } = {}) {
        super();
        this.onClick = onClick;
        this.sortingOrder = sortingOrder;
        this.isHovering = false;
        this._wasDown = false;
    }

    update() {
        const mouse = input.getCanvasMousePosition();
        const t = this.entity.transform;
        const halfW = (t.size?.x ?? 0) / 2;
        const halfH = (t.size?.y ?? 0) / 2;
        this.isHovering = Math.abs(mouse.x - t.position.x) <= halfW && Math.abs(mouse.y - t.position.y) <= halfH;

        const isDown = input.isMouseButtonPressed(0);
        if (this.isHovering && isDown && !this._wasDown) {
            this.onClick?.(this.entity);
        }
        this._wasDown = isDown;
    }
}

ComponentRegistry.register('Button', Button, 'engine');
