/**
 * Base class for anything attachable to an Entity via addComponent() - built-in engine behavior
 * (rendering, and eventually things like Rigidbody/Collider) as well as custom per-game logic,
 * the same way Unity's MonoBehaviour lets a script sit alongside built-in components on one
 * GameObject. A component that wants its own fields to show up in the Inspector declares a
 * static `fields` array: [{ key, label, type }], where `type` is
 * 'number' | 'checkbox' | 'text' | 'color' | 'select' (needs an `options: string[]`, see
 * UIElement's `space` field) | 'vertices' (read-only point count - see PolygonRenderer) |
 * 'bindings' (an { actionName: keyToken } map, editable as add/remove rows - see InputController).
 */
export class Component {
    /** Fields the Inspector renders for this component. Override in subclasses. */
    static fields = [];

    constructor() {
        this.entity = null; // set by Entity.addComponent()
        this.enabled = true;
    }

    /** Called once, immediately after the component is attached. */
    start() {}

    /** Called every frame this entity updates, while `enabled`. */
    update() {}

    /** Called every render frame (in the entity's local, translated+rotated ctx space), while `enabled`. */
    draw(ctx) {}

    /** Optional: return plain data to snapshot for GameLoop's Edit<->Play revert. */
    captureState() { return null; }

    /** Optional: restore a snapshot produced by captureState(). */
    restoreState(state) {}
}
