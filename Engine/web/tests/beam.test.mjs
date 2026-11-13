// Run: node Engine/web/tests/beam.test.mjs   (no browser needed)
import assert from 'node:assert/strict';
import { BeamRenderer, beamGeometry } from '../BeamRenderer.js';
import { ComponentRegistry } from '../ComponentRegistry.js';
import { BLEND_MODES } from '../Rendering/Blend.js';
import { validateScene } from '../SceneValidator.js';

globalThis.window ??= { Image: class { set src(v) { this._src = v; } } }; // ImageCache creates real Images in a browser
const rec = () => { const calls = [];
    return { calls, globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: null, stops: [],
        save() { calls.push(['save']); }, restore() { calls.push(['restore']); }, translate(x, y) { calls.push(['translate', x, y]); }, rotate(a) { calls.push(['rotate', a]); },
        createLinearGradient(...a) { calls.push(['gradient', ...a]); const stops = this.stops; return { addColorStop(o, c) { stops.push([o, c]); } }; },
        fillRect(...a) { calls.push(['fillRect', ...a, this.globalAlpha, this.globalCompositeOperation]); },
        drawImage(img, ...a) { calls.push(['drawImage', img, ...a, this.globalAlpha, this.globalCompositeOperation]); } }; };
const make = (o = {}) => new BeamRenderer(o);
let passed = 0; const test = (n, f) => { f(); passed++; console.log('PASS', n); };

test('registered as an engine component with explicit fields; animatable ones are flagged', () => {
    assert.ok(ComponentRegistry.get('BeamRenderer')); assert.ok(BeamRenderer.description.length > 20);
    const by = Object.fromEntries(BeamRenderer.fields.map(f => [f.key, f]));
    for (const k of ['length', 'angle', 'width', 'color', 'glow', 'opacity', 'fromX', 'toY']) assert.ok(by[k].animatable, k);
    assert.deepEqual(by.mode.options, ['length-angle', 'from-to']); assert.deepEqual(by.blendMode.options, BLEND_MODES);
    assert.equal(by.imagePath.accept, 'image'); assert.equal(by.color.type, 'color');
    const c = make(); for (const f of BeamRenderer.fields) assert.ok(f.key in c, f.key); // every declared field exists on a fresh instance
});
test('geometry: length-angle starts startDistance out and points at the angle', () => {
    const g = beamGeometry({ mode: 'length-angle', length: 200, angle: 90, startDistance: 50 });
    assert.ok(Math.abs(g.x0) < 1e-9 && Math.abs(g.y0 - 50) < 1e-9); assert.equal(g.length, 200); assert.ok(Math.abs(g.angle - Math.PI / 2) < 1e-12);
});
test('geometry: from-to derives length and angle from the points', () => {
    const g = beamGeometry({ mode: 'from-to', fromX: 10, fromY: 10, toX: 10, toY: 110 });
    assert.deepEqual([g.x0, g.y0, g.length], [10, 10, 100]); assert.ok(Math.abs(g.angle - Math.PI / 2) < 1e-12);
});
test('geometry: zero, negative and non-finite lengths yield no beam', () => {
    assert.equal(beamGeometry({ mode: 'from-to', fromX: 1, fromY: 1, toX: 1, toY: 1 }), null);
    assert.equal(beamGeometry({ mode: 'length-angle', length: -5, angle: 0, startDistance: 0 }), null);
    assert.equal(beamGeometry({ mode: 'length-angle', length: NaN, angle: 0, startDistance: 0 }), null);
    assert.equal(make({ length: 0 }).geometry(), null);
});
test('colour beam: gradient strip across the width in the chosen blend mode; state restored', () => {
    const c = make({ length: 400, width: 20, color: '#ff0000', blendMode: 'additive', angle: 30, startDistance: 10, opacity: 0.5 }), ctx = rec(); ctx.globalAlpha = 0.8; c.draw(ctx);
    const fill = ctx.calls.filter(x => x[0] === 'fillRect'); assert.equal(fill.length, 1);
    assert.deepEqual(fill[0].slice(1, 5), [0, -10, 400, 20]); assert.ok(Math.abs(fill[0][5] - 0.4) < 1e-12); assert.equal(fill[0][6], 'lighter');
    assert.deepEqual(ctx.calls.find(x => x[0] === 'gradient').slice(1), [0, -10, 0, 10]);
    assert.equal(ctx.stops[0][1], 'rgba(255,0,0,0)'); assert.equal(ctx.stops[1][1], '#ff0000'); assert.equal(ctx.stops[2][1], 'rgba(255,0,0,0)');
    const rot = ctx.calls.find(x => x[0] === 'rotate'); assert.ok(Math.abs(rot[1] - Math.PI / 6) < 1e-12);
    assert.equal(ctx.globalAlpha, 0.8); assert.equal(ctx.globalCompositeOperation, 'source-over');
    assert.equal(ctx.calls.filter(x => x[0] === 'save').length, ctx.calls.filter(x => x[0] === 'restore').length);
});
test('glow adds one wider, fainter pass first; no glow draws once', () => {
    const c = make({ width: 10, glow: 0.4, glowWidth: 4, opacity: 1 }), ctx = rec(); c.draw(ctx);
    const fills = ctx.calls.filter(x => x[0] === 'fillRect'); assert.equal(fills.length, 2);
    assert.equal(fills[0][4], 40); assert.ok(Math.abs(fills[0][5] - 0.4) < 1e-12); assert.equal(fills[1][4], 10); assert.equal(fills[1][5], 1);
    const plain = rec(); make({ glow: 0 }).draw(plain); assert.equal(plain.calls.filter(x => x[0] === 'fillRect').length, 1);
});
test('textured beam stretches the image along the beam; waits for the image to load', () => {
    const c = make({ imagePath: './beam.png', length: 500, width: 30 }), ctx = rec();
    c._entry = { loaded: false }; c.draw(ctx); assert.equal(ctx.calls.filter(x => x[0] === 'drawImage').length, 0); // not loaded yet
    const img = { name: 'img' }; c._entry = { loaded: true, image: img }; c.draw(ctx);
    const d = ctx.calls.find(x => x[0] === 'drawImage'); assert.deepEqual(d.slice(1, 6), [img, 0, -15, 500, 30]);
    c.imagePath = ''; assert.equal(c._entry, null); const col = rec(); c.draw(col); assert.equal(col.calls.filter(x => x[0] === 'fillRect').length, 1);
});
test('from-to beam translates to the start point', () => {
    const ctx = rec(); make({ mode: 'from-to', fromX: 5, fromY: 6, toX: 105, toY: 6, width: 4 }).draw(ctx);
    assert.deepEqual(ctx.calls.find(x => x[0] === 'translate').slice(1), [5, 6]); assert.equal(ctx.calls.find(x => x[0] === 'rotate')[1], 0);
});
test('invisible beams draw nothing: zero width, zero opacity, no length', () => {
    for (const o of [{ width: 0 }, { opacity: 0 }, { length: 0 }, { width: NaN }]) { const ctx = rec(); make(o).draw(ctx); assert.equal(ctx.calls.length, 0, JSON.stringify(o)); }
});
test('scene validator accepts a BeamRenderer saved from its own fields', () => {
    const fields = Object.fromEntries(BeamRenderer.fields.map(f => [f.key, make()[f.key]]));
    const r = validateScene({ version: 1, entities: [{ sceneKey: 'a', type: 'Empty', tag: 'Empty', transform: { position: { x: 0, y: 0 }, rotation: 0, size: { x: 1, y: 1 } }, fields: {}, components: [{ type: 'BeamRenderer', fields }] }] },
        { entities: [{ name: 'Empty', fields: [] }], components: [{ name: 'BeamRenderer', fields: BeamRenderer.fields.map(f => ({ ...f })) }] });
    assert.equal(r.errors.length + r.warnings.length, 0, JSON.stringify([...r.errors, ...r.warnings]));
});
console.log(`${passed} passed`);
