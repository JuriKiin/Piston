import { Entity } from './Entity.js';
import { EntityRegistry } from './EntityRegistry.js';
import { Camera } from './Camera.js';

/**
 * A bare host for a Camera component - no rigidbody, no collider, just a transform (which IS the
 * camera's world position - see Camera.js) and the component itself, the same role UIElement.js
 * plays for Text/Button/UIContainer. GameLoop auto-adds one of these (see #ensureCamera) to any
 * scene that doesn't already have an entity carrying a Camera component, so every scene has a
 * working default view with nothing extra to author - but it's a perfectly ordinary entity once it
 * exists: draggable in the Inspector, deletable, and (once Saved) round-trips through the level
 * file the exact same way any other entity does. A consumer who wants entirely custom camera
 * behavior can just add a Camera component to their own entity instead (a "MainCamera" tag isn't
 * required by anything - GameLoop.camera picks up the first entity with a Camera component it
 * finds, whatever it's tagged).
 */
export class MainCamera extends Entity {
    static description = "The default camera entity every scene gets. Move it to change what the player sees.";

    start() {
        this.tag = 'MainCamera';
        this.addComponent(new Camera());
    }
}

EntityRegistry.register('MainCamera', MainCamera, 'engine');
