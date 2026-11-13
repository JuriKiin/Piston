/**
 * Lets Entity subclasses make themselves discoverable for the top bar's "Add" menu, without that
 * menu needing to import or know about every entity type a game defines. A game registers its own
 * entities under whatever group name makes sense for it (e.g. 'Golf', 'Enemies') - unlike
 * ComponentRegistry's fixed engine/game split, groups here are free-form so a project can organize
 * its own catalog however it wants.
 *
 * An entity added this way is always constructed with zero arguments, so any entity meant to be
 * addable from the menu must have sensible defaults for every constructor parameter.
 */
class EntityRegistryImpl {
    constructor() {
        this.entries = []; // { name, EntityClass, group }
    }

    register(name, EntityClass, group = 'General') {
        this.entries.push({ name, EntityClass, group });
    }

    /** Case-insensitive substring match on name, grouped into a Map<groupName, entries[]>. */
    search(query = '') {
        const q = query.trim().toLowerCase();
        const groups = new Map();
        for (const entry of this.entries) {
            if (!entry.name.toLowerCase().includes(q)) continue;
            if (!groups.has(entry.group)) groups.set(entry.group, []);
            groups.get(entry.group).push(entry);
        }
        return groups;
    }

    /** The registered name for an entity class, or null if it was never registered - e.g. a
     * one-off entity built inline in a scene file. Used by scene save/load to record *what* a
     * runtime-added entity is, since a saved file only has plain data. */
    nameOf(EntityClass) {
        return this.entries.find(e => e.EntityClass === EntityClass)?.name ?? null;
    }

    /** The class registered under `name`, or null. Used by scene load to reconstruct entities. */
    get(name) {
        return this.entries.find(e => e.name === name)?.EntityClass ?? null;
    }
}

export const EntityRegistry = new EntityRegistryImpl();
