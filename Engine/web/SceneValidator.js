// Scene validation: checks a scene file's data against the engine's contract (see EditorDocs/13-engine-contract.md).
// Pure function, no engine state: `schemas` is what the bridge's getSchemas returns ({ entities: [{ name, fields }], components: [...] }),
// so the same rules run in the editor, in Node tests, and (later) in any other runtime's conformance suite.
import { EASING_NAMES, parseColor } from './Animation/Tracks.js';

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const TRANSFORM_PATHS = new Set(['transform.position.x', 'transform.position.y', 'transform.rotation', 'transform.size.x', 'transform.size.y']);

/** @returns {{ errors: Issue[], warnings: Issue[] }}  Issue = { entity: sceneKey|null, path: string, message: string } */
export function validateScene(data, schemas = { entities: [], components: [] }) {
    const errors = [], warnings = [];
    const err = (entity, path, message) => errors.push({ entity, path, message });
    const warn = (entity, path, message) => warnings.push({ entity, path, message });

    if (!data || typeof data !== 'object' || Array.isArray(data)) { err(null, '', 'A scene must be a JSON object'); return { errors, warnings }; }
    if (!Array.isArray(data.entities)) { err(null, 'entities', 'A scene needs an `entities` array'); return { errors, warnings }; }
    if (data.deletedKeys !== undefined && !Array.isArray(data.deletedKeys)) err(null, 'deletedKeys', '`deletedKeys` must be an array of keys');

    const entityTypes = new Map((schemas.entities ?? []).map(e => [e.name, e.fields ?? []]));
    const componentTypes = new Map((schemas.components ?? []).map(c => [c.name, c.fields ?? []]));
    const keys = new Map();   // sceneKey → entity record
    const parents = new Map(); // sceneKey → parentKey

    data.entities.forEach((e, i) => {
        const at = `entities[${i}]`;
        if (!e || typeof e !== 'object') { err(null, at, 'Entity must be an object'); return; }
        const key = e.sceneKey;
        if (typeof key !== 'string' || !key) { err(null, at, 'Entity has no `sceneKey` (a stable, unique id)'); return; }
        if (keys.has(key)) err(key, `${at}.sceneKey`, `Duplicate sceneKey "${key}" (also entities[${keys.get(key).index}])`);
        else keys.set(key, { index: i, entity: e });
        parents.set(key, e.parentKey ?? null);

        if (!e.type) warn(key, `${at}.type`, 'No `type`: it can only be loaded by code that creates it, not from the file');
        else if (!entityTypes.has(e.type)) warn(key, `${at}.type`, `Entity type "${e.type}" isn't registered, so it will be skipped when the game loads`);

        const t = e.transform;
        if (!t || typeof t !== 'object') err(key, `${at}.transform`, 'Missing `transform`');
        else {
            for (const [p, v] of [['position.x', t.position?.x], ['position.y', t.position?.y], ['rotation', t.rotation], ['size.x', t.size?.x], ['size.y', t.size?.y]]) {
                if (!isNumber(v)) err(key, `${at}.transform.${p}`, `transform.${p} must be a finite number`);
            }
            if (isNumber(t.size?.x) && t.size.x < 0) warn(key, `${at}.transform.size.x`, 'Negative width');
            if (isNumber(t.size?.y) && t.size.y < 0) warn(key, `${at}.transform.size.y`, 'Negative height');
        }

        if (e.fields) checkFields(key, `${at}.fields`, e.fields, entityTypes.get(e.type), warn, err, `entity type "${e.type}"`);

        if (e.components !== undefined && !Array.isArray(e.components)) err(key, `${at}.components`, '`components` must be an array');
        (Array.isArray(e.components) ? e.components : []).forEach((c, j) => {
            const cat = `${at}.components[${j}]`;
            if (!c || typeof c.type !== 'string') { err(key, cat, 'Component needs a `type`'); return; }
            if (!componentTypes.has(c.type)) { warn(key, `${cat}.type`, `Component type "${c.type}" isn't registered, so it will be dropped when the game loads`); return; }
            checkFields(key, `${cat}.fields`, c.fields ?? {}, componentTypes.get(c.type), warn, err, `component "${c.type}"`);
            if (c.type === 'Animator') checkAnimator(key, cat, c.fields ?? {}, componentTypes, warn, err, e);
        });
    });

    for (const [key, parentKey] of parents) {
        if (parentKey === null) continue;
        if (parentKey === key) { err(key, 'parentKey', 'An entity can\'t be its own parent'); continue; }
        if (!keys.has(parentKey)) { warn(key, 'parentKey', `Parent "${parentKey}" doesn't exist in this scene (the entity will load unparented)`); continue; }
        const seen = new Set([key]);
        for (let cur = parentKey; cur; cur = parents.get(cur) ?? null) {
            if (seen.has(cur)) { err(key, 'parentKey', `Parenting cycle through "${cur}"`); break; }
            seen.add(cur);
        }
    }
    return { errors, warnings };
}

function checkFields(key, path, values, schema, warn, err, owner) {
    if (!schema) return; // unknown type: already reported
    const byKey = new Map(schema.map(f => [f.key, f]));
    for (const [name, v] of Object.entries(values)) {
        const f = byKey.get(name);
        if (!f) { warn(key, `${path}.${name}`, `"${name}" isn't a declared field of ${owner} (ignored or kept as-is)`); continue; }
        if (v === null || v === undefined) continue; // unset is allowed everywhere
        switch (f.type) {
            case 'number': if (!isNumber(v)) err(key, `${path}.${name}`, `${name} must be a number (got ${typeof v})`); break;
            case 'checkbox': if (typeof v !== 'boolean') err(key, `${path}.${name}`, `${name} must be true or false`); break;
            case 'text': if (typeof v !== 'string') err(key, `${path}.${name}`, `${name} must be text`); break;
            case 'color': if (typeof v !== 'string') err(key, `${path}.${name}`, `${name} must be a color string`); else if (!parseColor(v) && !/^[a-z]+$/i.test(v)) warn(key, `${path}.${name}`, `"${v}" isn't a color we recognise (#rgb, #rrggbb, #rrggbbaa, rgb(), rgba(), or a name)`); break;
            case 'select': if (!(f.options ?? []).includes(v)) err(key, `${path}.${name}`, `${name} must be one of ${(f.options ?? []).join(', ')} (got "${v}")`); break;
            default: break; // vertices, clips, animation, bindings: structure is the owning component's business
        }
    }
}

function checkAnimator(key, path, fields, componentTypes, warn, err, entity) {
    const clips = fields.clips ?? [];
    if (!Array.isArray(clips)) { err(key, `${path}.fields.clips`, '`clips` must be an array'); return; }
    if (fields.asset && clips.length) warn(key, `${path}.fields.asset`, 'Both inline clips and an animation file are set; the inline clips win and the file is ignored');
    const names = new Set();
    const have = new Set(TRANSFORM_PATHS);
    for (const c of entity.components ?? []) {
        const f = componentTypes.get(c.type) ?? [];
        for (const field of f) if (field.animatable) have.add(`${c.type}.${field.key}`);
    }
    clips.forEach((clip, i) => {
        const cp = `${path}.fields.clips[${i}]`;
        if (!clip || typeof clip.name !== 'string' || !clip.name) { err(key, cp, 'Clip needs a name'); return; }
        if (names.has(clip.name)) err(key, cp, `Two clips are named "${clip.name}"`);
        names.add(clip.name);
        if (!isNumber(clip.duration) || clip.duration <= 0) err(key, `${cp}.duration`, 'Clip duration must be a number above 0');
        (clip.tracks ?? []).forEach((tr, j) => {
            const tp = `${cp}.tracks[${j}]`;
            if (!have.has(tr.path)) warn(key, `${tp}.path`, `"${tr.path}" isn't an animatable property of this entity`);
            const keys = tr.keys ?? [];
            if (!keys.length) warn(key, `${tp}.keys`, 'Track has no keys');
            keys.forEach((k, m) => {
                if (!isNumber(k.t) || k.t < 0) err(key, `${tp}.keys[${m}].t`, 'Key time must be a number >= 0');
                else if (isNumber(clip.duration) && k.t > clip.duration + 1e-9) warn(key, `${tp}.keys[${m}].t`, `Key at ${k.t}s is after the clip ends (${clip.duration}s)`);
                if (k.ease !== undefined && !EASING_NAMES.includes(k.ease)) warn(key, `${tp}.keys[${m}].ease`, `Unknown easing "${k.ease}" (treated as linear)`);
                if (k.v === undefined || k.v === null) err(key, `${tp}.keys[${m}].v`, 'Key needs a value');
            });
        });
        for (const [m, e] of (clip.events ?? []).entries()) if (!isNumber(e.t) || typeof e.name !== 'string') err(key, `${cp}.events[${m}]`, 'Event needs a time and a name');
    });
    if (fields.defaultClip && clips.length && !names.has(fields.defaultClip)) warn(key, `${path}.fields.defaultClip`, `Default clip "${fields.defaultClip}" doesn't exist`);
}
