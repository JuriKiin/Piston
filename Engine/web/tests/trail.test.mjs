// Run: node Engine/web/tests/trail.test.mjs   (no browser needed)
import assert from 'node:assert/strict';
import { TrailRenderer, buildRibbon } from '../TrailRenderer.js';
import { ComponentRegistry } from '../ComponentRegistry.js';
import Constants from '../static/Constants.js';

const entity = (x = 0, y = 0, rotation = 0) => ({ transform: { position: { x, y }, rotation, size: { x: 10, y: 10 } }, components: [] });
const make = (opts = {}, e = entity()) => { const c = new TrailRenderer(opts); c.entity = e; return c; };
const tick = (c, dt = 1 / 60) => { Constants.DELTA_TIME = dt; c.update(); };
const ctxMock = () => { const calls = []; const stops = [];
    return { calls, stops, globalAlpha: 1, globalCompositeOperation: 'source-over', set fillStyle(v) { calls.push(['fillStyle', typeof v]); },
        createLinearGradient(...a) { calls.push(['gradient', ...a]); return { addColorStop(o, c) { stops.push([o, c]); } }; },
        beginPath() { calls.push(['begin']); }, moveTo(x, y) { calls.push(['moveTo', x, y]); }, lineTo(x, y) { calls.push(['lineTo', x, y]); },
        closePath() {}, fill() { calls.push(['fill', this.globalCompositeOperation]); } }; };
let passed = 0; const test = (n, f) => { f(); passed++; console.log('PASS', n); };

test('registered with explicit, animatable fields and a description', () => {
    assert.ok(ComponentRegistry.get('TrailRenderer'));
    assert.ok(TrailRenderer.description.length > 20);
    const by = Object.fromEntries(TrailRenderer.fields.map(f => [f.key, f]));
    assert.ok(by.startWidth.animatable && by.startColor.animatable && by.opacity.animatable);
    assert.equal(by.blendMode.type, 'select'); assert.ok(by.blendMode.options.includes('additive'));
});
test('samples only after the entity has moved min distance, and expires old points', () => {
    const e = entity(0, 0), t = make({ minDistance: 10, lifetime: 0.5 }, e);
    tick(t); assert.equal(t.points.length, 1);
    e.transform.position.x = 5; tick(t); assert.equal(t.points.length, 1);
    e.transform.position.x = 12; tick(t); assert.equal(t.points.length, 2);
    for (let i = 0; i < 40; i++) tick(t); assert.ok(t.points.every(p => p.age <= 0.5) && t.points.length <= 1); // the old samples expired; a stationary entity keeps one fresh sample
});
test('stops sampling when not emitting and honours maxPoints', () => {
    const e = entity(), t = make({ minDistance: 1, maxPoints: 5, lifetime: 100 }, e);
    for (let i = 0; i < 20; i++) { e.transform.position.x += 3; tick(t); }
    assert.equal(t.points.length, 5);
    t.emitting = false; const n = t.points.length; e.transform.position.x += 50; tick(t); assert.equal(t.points.length, n);
});
test('ribbon is pushed out by half the width on each side of a straight line', () => {
    const { left, right } = buildRibbon([{ x: 0, y: 0, w: 10 }, { x: -10, y: 0, w: 4 }, { x: -20, y: 0, w: 0 }]);
    assert.deepEqual([left[0].y, right[0].y].map(Math.abs), [5, 5]);
    assert.ok(Math.abs(left[1].y) === 2 && Math.abs(right[1].y) === 2);
    assert.equal(left[2].y, 0);
});
test('draw fills one gradient ribbon in the chosen blend mode, restoring state afterwards', () => {
    const e = entity(100, 100), t = make({ minDistance: 1, startColor: '#ff0000', endColor: '#0000ff', blendMode: 'additive' }, e);
    for (let i = 0; i < 4; i++) { e.transform.position.x += 10; tick(t); }
    const ctx = ctxMock(); t.draw(ctx);
    assert.equal(ctx.calls.filter(c => c[0] === 'fill').length, 1);
    assert.equal(ctx.calls.find(c => c[0] === 'fill')[1], 'lighter');
    assert.equal(ctx.globalCompositeOperation, 'source-over'); assert.equal(ctx.globalAlpha, 1);
    assert.equal(ctx.stops[0][1], '#ff0000'); assert.ok(ctx.stops[1][1].startsWith('rgba(0,0,255,0')); // fades to transparent
    const g = ctx.calls.find(c => c[0] === 'gradient'); assert.ok(g[3] < 0, 'tail is behind the head (negative local x)');
});
test('rotating the entity does not rotate the trail in world space', () => {
    const e = entity(0, 0, 90), t = make({ minDistance: 1 }, e);
    t.points = [{ x: 10, y: 0, age: 0 }];       // 10 px to the world right; the entity is rotated 90deg, so in its local space that is "up"
    const ctx = ctxMock(); t.draw(ctx);
    const g = ctx.calls.find(c => c[0] === 'gradient'); assert.ok(Math.abs(g[3]) < 1e-9 && Math.abs(Math.abs(g[4]) - 10) < 1e-9);
});
test('clear() and restoreState() forget the trail', () => {
    const t = make(); t.points = [{ x: 1, y: 1, age: 0 }]; t.clear(); assert.equal(t.points.length, 0);
    t.points = [{ x: 1, y: 1, age: 0 }]; t.restoreState(); assert.equal(t.points.length, 0);
});
console.log(`${passed} passed`);
