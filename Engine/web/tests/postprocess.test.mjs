// Run: node Engine/web/tests/postprocess.test.mjs   (no browser needed)
import assert from 'node:assert/strict';
import { PostProcess, brightPassParams, gradeFilter } from '../PostProcess.js';
import { Light2D } from '../Light2D.js';
import { Surface } from '../Rendering/Surface.js';
import { ComponentRegistry } from '../ComponentRegistry.js';

// A recording fake canvas so the whole pipeline can be checked without a browser.
const log = [];
Surface.create = (w, h) => {
    const id = log.length, ctx = { id, filter: 'none', globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', imageSmoothingEnabled: true,
        save() {}, restore() {}, setTransform() {}, scale() {}, translate() {}, clearRect() {}, fillRect(...a) { log.push([id, 'fillRect', this.globalCompositeOperation, this.fillStyle]); },
        drawImage(src, ...a) { log.push([id, 'drawImage', src.tag, this.globalCompositeOperation, this.filter, this.globalAlpha]); },
        createRadialGradient() { return { addColorStop() {} }; } };
    w = Math.round(w); h = Math.round(h); const canvas = { width: w, height: h, tag: `c${log.length}:${w}x${h}`, getContext() { return ctx; } };
    log.push(['made', w, h]); return canvas;
};
const dst = () => { const ctx = { filter: 'none', globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', save() {}, restore() {}, setTransform() {}, clearRect() {},
    fillRect() { this.calls.push(['fillRect', this.globalCompositeOperation, this.fillStyle]); },
    drawImage(src, ...a) { this.calls.push(['drawImage', src.tag, this.globalCompositeOperation, this.filter, this.globalAlpha]); }, calls: [] }; return ctx; };
let passed = 0; const test = (n, f) => { log.length = 0; f(); passed++; console.log('PASS', n); };

test('registered with explicit field types and animatable effect strengths', () => {
    assert.ok(ComponentRegistry.get('PostProcess')); assert.ok(ComponentRegistry.get('Light2D'));
    const by = Object.fromEntries(PostProcess.fields.map(f => [f.key, f]));
    for (const k of ['bloom', 'vignette', 'chromatic', 'flashAmount', 'exposure', 'tintAmount']) assert.ok(by[k].animatable, k);
    for (const k of ['ambient', 'tintColor', 'vignetteColor', 'flashColor']) assert.equal(by[k].type, 'color');
    assert.ok(PostProcess.description.length > 30 && Light2D.description.length > 30);
});
test('defaults are neutral: not active, so the loop skips the offscreen pass', () => {
    assert.equal(new PostProcess().active, false);
    assert.equal(new PostProcess({ bloom: 0.5 }).active, true);
    assert.equal(new PostProcess({ ambient: '#202030' }).active, true);
    assert.equal(new PostProcess({ saturation: 1.2 }).active, true);
});
test('bright-pass filter maps the threshold to black and keeps white white', () => {
    for (const t of [0, 0.3, 0.6, 0.9]) {
        const { brightness, contrast } = brightPassParams(t), f = (x) => Math.max(0, Math.min(1, (Math.min(1, x * brightness) - 0.5) * contrast + 0.5));
        assert.ok(Math.abs(f(t)) < 1e-9, `threshold ${t} -> ${f(t)}`); assert.ok(Math.abs(f(1) - 1) < 1e-9);
    }
});
test('grade filter is "none" when neutral and lists only what changed', () => {
    assert.equal(gradeFilter({}), 'none');
    assert.equal(gradeFilter({ saturation: 1.5 }), 'saturate(1.5)');
    assert.equal(gradeFilter({ exposure: 0.8, contrast: 1.1 }), 'brightness(0.8) contrast(1.1)');
});
test('a neutral-but-forced render is one plain copy of the scene', () => {
    const p = new PostProcess(), d = dst(); p.render(d, { width: 1920, height: 1080 });
    assert.equal(d.calls.filter(c => c[0] === 'drawImage').length, 1); assert.equal(d.calls[0][3], 'none');
});
test('bloom builds the mip chain (bright pass first) and adds it back additively', () => {
    const p = new PostProcess({ bloom: 1 }), d = dst(); p.render(d, { width: 1920, height: 1080 });
    const sizes = log.filter(l => l[0] === 'made').map(l => `${l[1]}x${l[2]}`);
    for (const s of ['960x540', '480x270', '240x135', '120x68']) assert.ok(sizes.includes(s), s);
    const bright = log.find(l => l[1] === 'drawImage' && String(l[4]).includes('contrast')); assert.ok(bright, 'a bright-pass filter draw exists');
    const adds = d.calls.filter(c => c[0] === 'drawImage' && c[2] === 'lighter'); assert.equal(adds.length, 1, 'the mip chain is folded into one final additive draw');
    assert.ok(adds.every(c => c[4] <= 1));
});
test('vignette canvas is cached until its settings change', () => {
    const p = new PostProcess({ vignette: 0.5 }), d = dst(); p.render(d, { width: 100, height: 100 });
    const made = log.filter(l => l[0] === 'made').length; p.render(d, { width: 100, height: 100 });
    assert.equal(log.filter(l => l[0] === 'made').length, made);
    p.vignette = 0.9; p.render(d, { width: 100, height: 100 }); assert.equal(log.filter(l => l[0] === 'made').length, made); // redrawn in place, not re-created
});
test('lighting: ambient darkens with a multiply pass and lights add to it', () => {
    const p = new PostProcess({ ambient: '#303040' }), d = dst();
    p.render(d, { width: 200, height: 100, lights: [{ x: 50, y: 50, radius: 40, rgb: [255, 200, 100], intensity: 1.5 }] });
    assert.ok(log.some(l => l[1] === 'fillRect' && l[3] === '#303040'), 'ambient fill');
    assert.ok(log.some(l => l[1] === 'drawImage' && l[3] === 'multiply'), 'multiply over the scene');
    assert.ok(log.filter(l => l[1] === 'drawImage' && l[3] === 'lighter').length >= 3, 'two passes for intensity 1.5, plus the lightmap add');
});
test('chromatic aberration draws three channel copies additively', () => {
    const p = new PostProcess({ chromatic: 6 }), d = dst(); p.render(d, { width: 200, height: 100 });
    assert.equal(d.calls.filter(c => c[0] === 'drawImage' && c[2] === 'lighter').length, 3);
});
test('Light2D only reports itself while a post-process pass is collecting, in world space with its offset and colour', () => {
    const l = new Light2D({ color: '#ff8000', radius: 120, intensity: 2, offsetX: 10 }); l.entity = { transform: { position: { x: 100, y: 200 } } };
    Light2D.collected.length = 0; Light2D.collecting = false; l.draw(); assert.equal(Light2D.collected.length, 0);
    Light2D.collecting = true; l.draw(); Light2D.collecting = false;
    assert.deepEqual(Light2D.collected[0], { x: 110, y: 200, radius: 120, rgb: [255, 128, 0], intensity: 2 });
    Light2D.collected.length = 0;
});
console.log(`${passed} passed`);
