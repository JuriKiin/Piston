// Run: node Engine/web/tests/rendering-effects.test.mjs   (no browser needed)
// Blend modes and flash on SpriteRenderer, textured/blended/spinning particles, tint cache, and GameLoop.timeScale wiring.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SpriteRenderer } from '../SpriteRenderer.js';
import { ParticleEmitter } from '../ParticleEmitter.js';
import { BLEND_MODES, compositeOp } from '../Rendering/Blend.js';
import { Surface, tintedImage, silhouetteImage, quantizeColor, variantCount } from '../Rendering/Surface.js';
import Constants from '../static/Constants.js';

let made = 0;
Surface.create = (w, h) => { made++; const ops = []; const ctx = { ops, drawImage() { ops.push('draw'); }, fillRect() { ops.push('fill'); }, set globalCompositeOperation(v) { ops.push(v); }, set fillStyle(v) {} };
    return { width: w, height: h, getContext: () => ctx }; };
const image = { width: 128, height: 64 };
const recorder = () => { const calls = []; return { calls, globalAlpha: 1, globalCompositeOperation: 'source-over', imageSmoothingEnabled: true, imageSmoothingQuality: 'low', fillStyle: '',
    drawImage(src, ...a) { calls.push({ op: 'drawImage', src, args: a, comp: this.globalCompositeOperation, alpha: this.globalAlpha }); },
    fillRect(...a) { calls.push({ op: 'fillRect', comp: this.globalCompositeOperation, alpha: this.globalAlpha, style: this.fillStyle }); },
    translate() {}, rotate() {}, beginPath() {}, arc(...a) { calls.push({ op: 'arc', comp: this.globalCompositeOperation, alpha: this.globalAlpha, style: this.fillStyle }); }, fill() {} }; };
const sprite = (opts = {}) => { const s = new SpriteRenderer({ frameWidth: 64, frameHeight: 64, frameCount: 2, columns: 2, ...opts });
    s.entity = { transform: { size: { x: 32, y: 32 } } }; s._entry = { loaded: true, image }; return s; };
let passed = 0; const test = (n, f) => { f(); passed++; console.log('PASS', n); };

test('blend modes map to canvas composite operations', () => {
    assert.deepEqual(BLEND_MODES, ['normal', 'additive', 'screen', 'multiply']);
    assert.equal(compositeOp('additive'), 'lighter'); assert.equal(compositeOp('normal'), 'source-over'); assert.equal(compositeOp('bogus'), 'source-over');
});
test('SpriteRenderer declares blendMode and flash explicitly (select / animatable number)', () => {
    const by = Object.fromEntries(SpriteRenderer.fields.map(f => [f.key, f]));
    assert.equal(by.blendMode.type, 'select'); assert.deepEqual(by.blendMode.options, BLEND_MODES);
    assert.equal(by.flash.type, 'number'); assert.equal(by.flash.animatable, true);
});
test('an additive sprite draws with lighter and restores the context afterwards', () => {
    const s = sprite({ blendMode: 'additive' }), ctx = recorder(); ctx.globalAlpha = 0.5; s.opacity = 0.5; s.draw(ctx);
    assert.equal(ctx.calls[0].comp, 'lighter'); assert.equal(ctx.calls[0].alpha, 0.25);
    assert.equal(ctx.globalCompositeOperation, 'source-over'); assert.equal(ctx.globalAlpha, 0.5);
});
test('flash draws a white silhouette on top at the flash alpha; no flash draws once', () => {
    const s = sprite(), plain = recorder(); s.draw(plain); assert.equal(plain.calls.length, 1);
    s.flash = 0.6; const ctx = recorder(); s.draw(ctx);
    assert.equal(ctx.calls.length, 2); assert.notEqual(ctx.calls[1].src, image); assert.equal(ctx.calls[1].alpha, 0.6);
    assert.deepEqual(ctx.calls[1].args, ctx.calls[0].args, 'same frame rectangle');
    s.flash = 5; const hot = recorder(); s.draw(hot); assert.equal(hot.calls[1].alpha, 1, 'clamped');
});
test('the silhouette and tint copies are cached per image', () => {
    const img = { width: 8, height: 8 }; made = 0;
    const a = silhouetteImage(img), b = silhouetteImage(img); assert.equal(a, b); assert.equal(made, 1);
    const t1 = tintedImage(img, '#ff0000'), t2 = tintedImage(img, '#ff0000'), t3 = tintedImage(img, '#00ff00');
    assert.equal(t1, t2); assert.notEqual(t1, t3); assert.equal(tintedImage(img, '#ffffff'), img, 'white needs no copy'); assert.equal(variantCount(img), 3);
});
test('quantizeColor bounds the number of tinted copies a smooth colour ramp can create', () => {
    const seen = new Set(); for (let i = 0; i <= 255; i++) seen.add(quantizeColor([255 - i, i, 128]));
    assert.ok(seen.size < 30, `${seen.size}`);
});

const entity = { transform: { position: { x: 0, y: 0 }, rotation: 0, size: { x: 10, y: 10 } }, components: [] };
const seeded = (seed = 3) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const emitter = (opts = {}) => { const p = new ParticleEmitter(opts); p.entity = entity; p.random = seeded(); return p; };
const step = (p, s) => { for (let t = 0; t < s - 1e-9; t += 1 / 60) { Constants.DELTA_TIME = 1 / 60; p.update(); } };

test('ParticleEmitter declares texture, blend, drag and spin fields explicitly', () => {
    const by = Object.fromEntries(ParticleEmitter.fields.map(f => [f.key, f]));
    assert.equal(by.imagePath.accept, 'image'); assert.equal(by.blendMode.type, 'select');
    for (const k of ['drag', 'spin', 'spinVariation', 'sizeVariation']) assert.equal(by[k].type, 'number', k);
    assert.equal(by.randomRotation.type, 'checkbox');
});
test('drag slows particles exponentially; zero drag leaves speed alone', () => {
    const d = emitter({ angle: 0, spread: 0, speed: 100, speedVariation: 0, drag: 3, lifetime: 5 }); d.burst(1); step(d, 1);
    const sp = Math.hypot(d.particles[0].vx, d.particles[0].vy); assert.ok(Math.abs(sp - 100 * Math.exp(-3)) < 3, sp);
    const n = emitter({ angle: 0, spread: 0, speed: 100, speedVariation: 0, lifetime: 5 }); n.burst(1); step(n, 1); assert.ok(Math.abs(n.particles[0].vx - 100) < 1e-6);
});
test('spin advances rotation and random rotation varies the start', () => {
    const s = emitter({ spin: 90, spinVariation: 0, lifetime: 5 }); s.burst(1); step(s, 1); assert.ok(Math.abs(s.particles[0].rot - Math.PI / 2) < 0.05);
    const r = emitter({ randomRotation: true }); r.burst(20); assert.ok(new Set(r.particles.map(p => p.rot.toFixed(3))).size > 10);
    const v = emitter({ sizeVariation: 0.5 }); v.burst(20); assert.ok(v.particles.some(p => p.sizeMul < 0.9) && v.particles.some(p => p.sizeMul > 1.1));
});
test('textured additive particles draw tinted copies in lighter and restore the context', () => {
    const p = emitter({ imagePath: '', blendMode: 'additive', startColor: '#ff0000', endColor: '#0000ff', startSize: 20, endSize: 20, lifetime: 1 });
    p._entry = { loaded: true, image: { width: 32, height: 32 } }; p.burst(3); const ctx = recorder(); p.draw(ctx);
    assert.equal(ctx.calls.length, 3); assert.ok(ctx.calls.every(c => c.op === 'drawImage' && c.comp === 'lighter'));
    assert.equal(ctx.globalCompositeOperation, 'source-over');
});
test('without an image the shape path is used, in the chosen blend mode', () => {
    const p = emitter({ blendMode: 'screen', shape: 'circle' }); p.burst(2); const ctx = recorder(); p.draw(ctx);
    assert.ok(ctx.calls.filter(c => c.op === 'arc').length === 2 && ctx.calls.every(c => c.comp === 'screen'));
});
test('GameLoop scales simulated time by timeScale and resets it when a scene loads', () => {
    const src = readFileSync(new URL('../GameLoop.js', import.meta.url), 'utf8');
    assert.match(src, /Constants\.DELTA_TIME = this\.fixedDelta \* Math\.max\(0, this\.timeScale\)/);
    assert.match(src, /this\.timeScale = 1;[^\n]*\n\s*setLastSceneId/);
    assert.match(src, /import \{ PostProcess \}/); assert.match(src, /import \{ Light2D \}/);
});
console.log(`${passed} passed`);
