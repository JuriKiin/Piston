// Pure animation math (no DOM, no engine state): easing, keyframe sampling, and addressing entity properties by path.
// Shared by the Animator component at runtime and by the editor's timeline preview (through the bridge).
import { ComponentRegistry } from '../ComponentRegistry.js';

/** Easing curves, named so clips stay readable JSON. Each maps 0..1 → 0..1 (back/bounce may overshoot). */
export const Easing = {
    linear: (p) => p,
    step: (p) => (p >= 1 ? 1 : 0), // hold the value until the next key
    easeIn: (p) => p * p,
    easeOut: (p) => 1 - (1 - p) * (1 - p),
    easeInOut: (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2),
    cubicIn: (p) => p * p * p,
    cubicOut: (p) => 1 - Math.pow(1 - p, 3),
    cubicInOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    backOut: (p) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); },
    bounceOut: (p) => {
        const n = 7.5625, d = 2.75;
        if (p < 1 / d) return n * p * p;
        if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
        if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
        return n * (p -= 2.625 / d) * p + 0.984375;
    },
};
export const EASING_NAMES = Object.keys(Easing);

// ---- Colors: any CSS color a field might hold ("#rgb", "#rrggbb", "#rrggbbaa", "rgb()/rgba()", a basic name, "transparent")
const NAMED = {
    white: [255, 255, 255], black: [0, 0, 0], red: [255, 0, 0], green: [0, 128, 0], lime: [0, 255, 0], blue: [0, 0, 255], yellow: [255, 255, 0],
    orange: [255, 165, 0], purple: [128, 0, 128], pink: [255, 192, 203], gray: [128, 128, 128], grey: [128, 128, 128], cyan: [0, 255, 255],
    magenta: [255, 0, 255], brown: [165, 42, 42], gold: [255, 215, 0], navy: [0, 0, 128], teal: [0, 128, 128], silver: [192, 192, 192],
};

/** Parses a CSS color into [r, g, b, a] (a is 0..1), or null if it isn't one we understand. */
export function parseColor(value) {
    if (typeof value !== 'string') return null;
    const v = value.trim().toLowerCase();
    if (v === 'transparent') return [0, 0, 0, 0];
    if (NAMED[v]) return [...NAMED[v], 1];
    let m = /^#([0-9a-f]{3,4})$/.exec(v);
    if (m) { const h = [...m[1]].map(c => parseInt(c + c, 16)); return [h[0], h[1], h[2], h[3] === undefined ? 1 : h[3] / 255]; }
    m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
    if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] === undefined ? 1 : parseInt(m[2], 16) / 255]; }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v);
    if (m) { const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]); return [+m[1], +m[2], +m[3], a]; }
    return null;
}

/** "#rrggbb" when opaque, "rgba(r,g,b,a)" when translucent (both are valid canvas fill styles). */
export function formatColor([r, g, b, a]) {
    const c = [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))));
    if (a >= 0.999) return '#' + c.map(x => x.toString(16).padStart(2, '0')).join('');
    return `rgba(${c[0]},${c[1]},${c[2]},${Math.round(Math.max(0, a) * 1000) / 1000})`;
}

function mix(a, b, p) {
    if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * p;
    const ca = parseColor(a), cb = parseColor(b);
    if (ca && cb) return formatColor(ca.map((v, i) => v + (cb[i] - v) * p));
    return p >= 1 ? b : a; // anything else (text, booleans) just holds, then switches
}

/** Value of one track at time `t`. Before the first key it holds the first value; after the last, the last. */
export function evaluateTrack(track, t) {
    const keys = track.keys ?? [];
    if (!keys.length) return undefined;
    if (t <= keys[0].t) return keys[0].v;
    const last = keys[keys.length - 1];
    if (t >= last.t) return last.v;
    let i = 0;
    while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
    const a = keys[i], b = keys[i + 1];
    const span = b.t - a.t;
    const p = span > 0 ? (t - a.t) / span : 1;
    return mix(a.v, b.v, (Easing[a.ease] ?? Easing.linear)(p));
}

/** Every track of a clip sampled at `t`: { path: value }. */
export function sampleClip(clip, t) {
    const out = {};
    for (const track of clip.tracks ?? []) {
        const v = evaluateTrack(track, t);
        if (v !== undefined) out[track.path] = v;
    }
    return out;
}

/** Events with  from < time <= to  (the half-open window that just elapsed), in time order. */
export function eventsBetween(clip, from, to) {
    return (clip.events ?? []).filter(e => e.t > from && e.t <= to).sort((a, b) => a.t - b.t);
}

// ---- Property paths ---------------------------------------------------------------------------------------------
//   transform.position.x | transform.position.y | transform.rotation | transform.size.x | transform.size.y
//   <Component>.<field>      any number or color field a component declares in its static `fields` with `animatable: true`
const TRANSFORM = [
    ['transform.position.x', 'Position X'], ['transform.position.y', 'Position Y'], ['transform.rotation', 'Rotation'],
    ['transform.size.x', 'Width'], ['transform.size.y', 'Height'],
];

const componentByName = (entity, name) => entity.components.find(c => ComponentRegistry.nameOf(c.constructor) === name);

export function readProperty(entity, path) {
    const parts = path.split('.');
    if (parts[0] === 'transform') {
        const t = entity.transform;
        return parts.length === 3 ? t[parts[1]]?.[parts[2]] : t[parts[1]];
    }
    return componentByName(entity, parts[0])?.[parts[1]];
}

export function writeProperty(entity, path, value) {
    const parts = path.split('.');
    if (parts[0] === 'transform') {
        const t = entity.transform;
        if (parts.length === 3) { if (t[parts[1]]) t[parts[1]][parts[2]] = value; } else t[parts[1]] = value;
        return;
    }
    const c = componentByName(entity, parts[0]);
    if (c) c[parts[1]] = value;
}

/** What can be animated on this entity right now, with each property's current value (used to seed new keys). */
export function listProperties(entity) {
    const out = TRANSFORM.map(([path, label]) => ({ path, label: `Transform / ${label}`, type: 'number', value: readProperty(entity, path) }));
    for (const c of entity.components) {
        const name = ComponentRegistry.nameOf(c.constructor);
        if (!name || name === 'Animator') continue;
        for (const f of c.constructor.fields ?? []) {
            if (!f.animatable || (f.type !== 'number' && f.type !== 'color')) continue; // explicit opt-in: `animatable: true` on the field
            const unset = c[f.key] === null || c[f.key] === undefined;
            out.push({ path: `${name}.${f.key}`, label: `${name} / ${f.label ?? f.key}`, type: f.type, value: unset ? (f.type === 'color' ? '#00000000' : 0) : c[f.key] });
        }
    }
    return out;
}

export function applyValues(entity, values) {
    for (const [path, v] of Object.entries(values)) writeProperty(entity, path, v);
}
