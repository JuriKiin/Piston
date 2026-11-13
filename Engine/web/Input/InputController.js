import { Component } from '../Component.js';
import { ComponentRegistry } from '../ComponentRegistry.js';
import input from '../static/Input.js';

/**
 * A named-action layer over the raw Input singleton: game code asks "is 'launch' down" instead of
 * hardcoding a mouse button or key code inline, so remapping a control later is a one-line edit
 * here rather than a hunt through every place that reads Input directly. A Component like Camera -
 * GameLoop.input finds it the same way GameLoop.camera finds a Camera (see InputBindingLayer.js) -
 * so a consumer wanting real rebinding UI/persistence can just write their own Component instead of
 * needing anything here to special-case it.
 *
 * Each binding is one action name -> one token: a KeyboardEvent.code ('Space', 'KeyW') or
 * 'Mouse0'/'Mouse1'/'Mouse2' for the left/middle/right mouse button - edited as plain text in the
 * Inspector (see its 'bindings' field type) rather than a "press a key to bind" capture UI, which
 * felt like more machinery than a first pass at this needed.
 */
export class InputController extends Component {
    static description = "Reads input through binding layers and exposes named actions to your game code.";

    static fields = [
        { key: 'bindings', label: 'Bindings', type: 'bindings' },
    ];

    constructor({ bindings = {} } = {}) {
        super();
        this.bindings = bindings; // { actionName: 'KeyCode' | 'MouseN' }
    }

    /** True while the key/button bound to `action` is held down. False for an unbound/unknown action
     * (a scene missing a binding shouldn't throw - just behave as if that control isn't pressed). */
    isActionDown(action) {
        const token = this.bindings[action];
        return token ? InputController.#isTokenDown(token) : false;
    }

    /** True on the exact frame the key bound to `action` was released - see Input#getKeyUp. Mouse
     * buttons have no "up" edge tracked by the Input singleton, so a mouse-bound action never fires
     * this (isActionDown going false on the following frame is the only signal available for those). */
    wasActionReleased(action) {
        const token = this.bindings[action];
        if (!token || token.startsWith('Mouse')) return false;
        return input.getKeyUp(token);
    }

    /** True for exactly one simulation step after the key/button bound to `action` went down; a quick tap between two steps still counts. */
    wasActionPressed(action) {
        const token = this.bindings[action];
        if (!token) return false;
        return token.startsWith('Mouse') ? input.wasMousePressed(Number(token.slice(5))) : input.wasPressed(token);
    }

    static #isTokenDown(token) {
        if (token.startsWith('Mouse')) return input.isMouseButtonPressed(Number(token.slice(5)));
        return input.getKeyDown(token);
    }
}

ComponentRegistry.register('InputController', InputController, 'engine');
