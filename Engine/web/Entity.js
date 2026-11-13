import { Transform } from "./Transform.js";
import { Vector2 } from "./Physics/Vector2.js";
import MathLib from "./static/Math.js";
import Constants from "./static/Constants.js";
import Debug from "./static/Debug.js";

export class Entity {
    /** Entity-level tunable settings the Inspector renders (and SceneIO saves/restores) directly on
     * this entity, the same [{ key, label, type }] shape Component.fields already uses - see Ball
     * for an example. Transform/Rigidbody/Collider are hand-written in Inspector instead, since
     * every entity has those and they predate this mechanism (mirrors Component's own doc comment). */
    static fields = [];

    constructor(transform, rigidbody, tag) {
        this.id = (+new Date()).toString(16) + (Math.random() * 100000000 | 0).toString(16);
        this.transform = transform ?? new Transform(null, 0, new Vector2(20, 20));
        this.rigidbody = rigidbody ?? null;
        this.tag = tag ?? "Entity";
        // null = "no name of its own yet" - see the `name` getter/setter below.
        this._name = null;
        this.destroyed = false;
        this.lifetime = null; // seconds; if set, the entity auto-destroys when it reaches 0
        this.components = [];
        // Grouping only - NOT a transform hierarchy. transform.position stays plain world-space on
        // every entity, parented or not (see setParent/moveBy below), so nothing about rendering,
        // collision, or hit-testing needs to know parenting exists at all. A parent is purely "when
        // I move, drag these along with me" - set via setParent()/the Inspector's Parent dropdown,
        // never assigned directly (that would leave the two sides out of sync).
        this.parent = null;
        this.children = [];
    }

    /**
     * A human-readable label for THIS specific entity, shown in the Inspector and editable there
     * (double-click its header, or the "Name" field) - independent of `tag`, which is a shared
     * category label multiple entities can intentionally have in common (eight different "Book"
     * entities, each with its own `name`, all findable together via GameLoop#findObjectWithTag
     * ('Book') because they share that `tag`). Defaults to whatever `tag` currently is until a name
     * is explicitly set, so an entity nobody's bothered to name still shows something sensible
     * rather than blank - and keeps tracking `tag` if that changes too, right up until it doesn't
     * (an explicit name, once set, no longer follows tag changes).
     */
    get name() { return this._name ?? this.tag; }
    set name(value) { this._name = value; }

    /**
     * Attaches a Component instance - engine-provided (ShapeRenderer, eventually Rigidbody itself)
     * or a custom one defining its own per-entity logic. The same Component subclass can be
     * attached to any number of entities; each instance is independent.
     */
    addComponent(component) {
        component.entity = this;
        this.components.push(component);
        component.start();
        return component;
    }

    /** Returns this entity's first attached component that is an instance of `Type`, or undefined. */
    getComponent(Type) {
        return this.components.find(c => c instanceof Type);
    }

    /** The draw-order value GameLoop's render pass sorts entities with - lower draws first
     * (further back), equal values keep their relative/insertion order. Duck-typed off the first
     * attached component that happens to have a `sortingOrder` field (ShapeRenderer,
     * PolygonRenderer) rather than hardcoding a renderer type list, so any future renderer
     * component opts in for free just by naming its own field the same way. */
    getSortingOrder() {
        for (const component of this.components) {
            if (typeof component.sortingOrder === 'number') return component.sortingOrder;
        }
        return 0;
    }

    /**
     * Marks this entity for removal. It stops updating/rendering/colliding once GameLoop
     * sweeps destroyed entities out at the start of its next update - not immediately, so
     * it's safe to call from inside a collision callback or its own update().
     *
     * Children are orphaned, not destroyed with it - deleting a group's Empty anchor shouldn't
     * silently take the whole group down too, since nothing else about this entity's destruction
     * is cascading (a Wall's destroy() doesn't destroy whatever's resting on it, say). If cascading
     * delete is ever wanted, that's a deliberate, separate action - not this one's default.
     */
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        for (const child of [...this.children]) child.setParent(null);
        this.setParent(null);
        this.onDestroy();
    }

    onDestroy() {}

    /**
     * Re-parents this entity under `newParent` (or unparents it, for null) - the only correct way
     * to change `parent`/`children`, since those are two sides of the same relationship and have to
     * move together. Refuses (logging why, rather than corrupting the tree) parenting to itself or
     * to one of its own descendants, which would otherwise create a cycle that moveBy below would
     * recurse into forever.
     */
    setParent(newParent) {
        if (newParent === this) {
            console.error(`Entity "${this.name}" can't be its own parent - ignoring.`);
            return;
        }
        if (newParent) {
            for (let p = newParent.parent; p; p = p.parent) {
                if (p === this) {
                    console.error(`Parenting "${this.name}" under "${newParent.name}" would create a cycle - ignoring.`);
                    return;
                }
            }
        }
        if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this);
        this.parent = newParent;
        if (newParent) newParent.children.push(this);
    }

    /**
     * Moves this entity by a world-space delta and cascades the same delta to every descendant -
     * this, not a transform hierarchy, is what "parenting" actually means in this engine (see the
     * constructor's own doc comment on `parent`/`children`): a plain world-space nudge that happens
     * to also apply to whatever's grouped under it. Rotating/scaling a parent does NOT cascade -
     * only position does, for now; scope kept deliberately tight to "move a group together" rather
     * than a full local/world transform system, which would also need every collider and the
     * Inspector's hit-testing to stop assuming transform.position is always world-space.
     */
    moveBy(dx, dy) {
        this.transform.position.x += dx;
        this.transform.position.y += dy;
        for (const child of this.children) child.moveBy(dx, dy);
    }

    /**
     * Simulation logic: movement, physics, timers. Only called while GameLoop is in the
     * Playing state - frozen in Edit/Paused so the scene can be positioned before pressing Play.
     */
    update() {
        if (this.lifetime !== null) {
            this.lifetime -= Constants.DELTA_TIME;
            if (this.lifetime <= 0) {
                this.destroy();
                return;
            }
        }

        if (this.rigidbody) {
            this.rigidbody.update(this.transform);
        }
        this.transform.update(this.rigidbody);

        for (const component of this.components) {
            if (component.enabled) component.update();
        }
    }

    /**
     * Drawing only - runs every frame regardless of play state, so derived geometry
     * (collider bounds) and visuals stay in sync with the transform even while paused/editing.
     */
    render(ctx) {
        if (this.rigidbody && this.rigidbody.collider) {
            this.rigidbody.collider.getBounds();
        }

        ctx.save();
        ctx.translate(this.transform.position.x, this.transform.position.y);
        ctx.rotate(MathLib.degreesToRadians(this.transform.rotation));
        // Sorted by each component's own sortingOrder, the same field/meaning GameLoop's render
        // pass already sorts ENTITIES by (see getSortingOrder) - lower draws first (further back).
        // Without this, two components on one entity (a UIContainer background + a Text label, say)
        // drew in whatever order they were addComponent()-ed in, regardless of their own Order
        // fields - editing Order looked like it should control exactly this and silently didn't.
        // Array.sort is stable, so components without a sortingOrder (or tied) keep their original
        // add order instead of jittering.
        const drawOrder = [...this.components].sort((a, b) => (a.sortingOrder ?? 0) - (b.sortingOrder ?? 0));
        for (const component of drawOrder) {
            if (component.enabled) component.draw(ctx);
        }
        this.draw(ctx);
        ctx.restore();

        if (Debug.showColliders && this.rigidbody && this.rigidbody.collider && this.rigidbody.collider.drawCollider) {
            this.rigidbody.collider.drawCollider(ctx);
        }
    }

    /**
     * Captures the fields GameLoop.stop() restores when leaving Play mode. Override and call
     * super.captureEditState() to snapshot additional custom fields.
     */
    captureEditState() {
        const state = {
            position: this.transform.position.clone(),
            rotation: this.transform.rotation,
            size: this.transform.size.clone(),
            // Direct object references, not ids - captureEditState/restoreEditState only ever
            // operate on live entities within one session (never serialized - see SceneIO.js for
            // the save-file equivalent), so there's no lookup step needed the way loading a level
            // file has to resolve a saved parentKey back into an object (see buildEntityFromData).
            // Copied into fresh arrays/values here and on restore so this snapshot and the live
            // this.children array never end up aliasing the same array.
            parent: this.parent,
            children: [...this.children],
        };

        if (this.rigidbody) {
            state.rigidbody = {
                velocity: this.rigidbody.velocity.clone(),
                angularVelocity: this.rigidbody.angularVelocity,
                isStatic: this.rigidbody.isStatic,
                useGravity: this.rigidbody.useGravity,
            };
            if (this.rigidbody.collider) {
                state.colliderEnabled = this.rigidbody.collider.enabled;
            }
        }

        state.components = this.components.map(c => c.captureState());

        return state;
    }

    /** Restores a snapshot taken by captureEditState(). Override alongside it for custom fields. */
    restoreEditState(state) {
        this.transform.position = state.position.clone();
        this.transform.rotation = state.rotation;
        this.transform.size = state.size.clone();
        this.parent = state.parent;
        this.children = [...state.children];

        if (this.rigidbody && state.rigidbody) {
            this.rigidbody.velocity = state.rigidbody.velocity.clone();
            this.rigidbody.angularVelocity = state.rigidbody.angularVelocity;
            this.rigidbody.isStatic = state.rigidbody.isStatic;
            this.rigidbody.useGravity = state.rigidbody.useGravity;
            if (this.rigidbody.collider) {
                this.rigidbody.collider.enabled = state.colliderEnabled;
            }
        }

        if (state.components) {
            this.components.forEach((c, i) => c.restoreState(state.components[i]));
        }
    }

    start(canvas) {
        throw new Error("isColliding method must be implemented in subclasses.");
    }

    /** Optional extra/overlay drawing beyond whatever the entity's components already drew. */
    draw(ctx) {}

    onCollisionEnter(other) {}
    onCollisionExit(other) {}
}
