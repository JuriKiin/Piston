/**
 * Lets Component subclasses make themselves discoverable for the Inspector's "+ Add Component"
 * search, without the Inspector needing to import or know about every component that exists.
 * Engine-provided components (ShapeRenderer, etc.) register under 'engine'; a game's own custom
 * logic components register under 'game' the same way - call register() once at module load.
 *
 * A component added this way is always constructed with zero arguments, so any component meant
 * to be addable from the Inspector must have sensible defaults for every constructor field.
 */
class ComponentRegistryImpl {
    constructor() {
        this.entries = []; // { name, ComponentClass, category: 'engine' | 'game' }
    }

    register(name, ComponentClass, category = 'game') {
        this.entries.push({ name, ComponentClass, category });
    }

    /** Case-insensitive substring match on name, split into { engine, game } lists. */
    search(query = '') {
        const q = query.trim().toLowerCase();
        const matches = this.entries.filter(e => e.name.toLowerCase().includes(q));
        return {
            engine: matches.filter(e => e.category === 'engine'),
            game: matches.filter(e => e.category === 'game'),
        };
    }

    /** The registered name for a component class, or null if it was never registered - e.g. a
     * one-off component built inline in a scene file rather than via a reusable class. Used by
     * scene save/load to record *what* a component is, since a saved file only has plain data. */
    nameOf(ComponentClass) {
        return this.entries.find(e => e.ComponentClass === ComponentClass)?.name ?? null;
    }

    /** The class registered under `name`, or null. Used by scene load to reconstruct components. */
    get(name) {
        return this.entries.find(e => e.name === name)?.ComponentClass ?? null;
    }
}

export const ComponentRegistry = new ComponentRegistryImpl();
