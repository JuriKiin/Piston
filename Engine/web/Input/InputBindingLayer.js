import { Entity } from '../Entity.js';
import { EntityRegistry } from '../EntityRegistry.js';
import { InputController } from './InputController.js';

/**
 * A bare host for an InputController component - no rigidbody, no collider, no meaningful
 * transform - the same role MainCamera plays for Camera. Unlike MainCamera, this is NOT
 * auto-injected: not every game needs named input actions (reading the Input singleton directly is
 * still perfectly fine for something simple, the way Ball.js already does for launching), so add
 * one from the Add menu when a game actually wants remappable, named actions.
 */
export class InputBindingLayer extends Entity {
    static description = "A set of named input actions (like \"jump\") mapped to keys, so game code asks for actions instead of raw keys.";

    start() {
        this.tag = 'InputBindingLayer';
        this.addComponent(new InputController());
    }
}

EntityRegistry.register('InputBindingLayer', InputBindingLayer, 'engine');
