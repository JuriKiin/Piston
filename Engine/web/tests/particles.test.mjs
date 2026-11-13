// Run: node Engine/web/tests/particles.test.mjs   (no browser needed)
import assert from 'node:assert/strict';
import { ParticleEmitter } from '../ParticleEmitter.js';
import { Animator } from '../Animator.js';
import { ComponentRegistry } from '../ComponentRegistry.js';
import Constants from '../static/Constants.js';

const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const entity = (x = 100, y = 50, rotation = 0) => ({ transform: { position: { x, y }, rotation, size: { x: 10, y: 10 } }, components: [] });
const make = (opts = {}, e = entity()) => { const p = new ParticleEmitter(opts); p.entity = e; p.random = seeded(); return p; };
const tick = (c, seconds, step = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += step) { Constants.DELTA_TIME = step; c.update(); } };
const ctxMock = () => { const calls = []; return { calls, globalAlpha: 1, set fillStyle(v) { calls.push(['fill', v]); }, beginPath() {}, arc(x, y, r) { calls.push(['arc', x, y, r]); }, fill() {}, fillRect(x, y, w, h) { calls.push(['rect', x, y, w, h]); } }; };
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };

await test('registered, with animatable rate and colors', () => {
    assert.ok(ComponentRegistry.get('ParticleEmitter'));
    assert.ok(ParticleEmitter.fields.find(f => f.key === 'rate').animatable);
    assert.ok(ParticleEmitter.description.length > 20);
});
await test('burst spawns the burst count at the entity and respects maxParticles', () => {
    const p = make({ burstCount: 8 }); p.burst(); assert.equal(p.particles.length, 8);
    assert.ok(p.particles.every(q => q.x === 100 && q.y === 50));
    const capped = make({ maxParticles: 5 }); capped.burst(50); assert.equal(capped.particles.length, 5);
});
await test('particles move along the angle, fan within the spread, and expire after their lifetime', () => {
    const p = make({ angle: 0, spread: 0, speed: 100, speedVariation: 0, lifetime: 1 }); p.burst(1);
    tick(p, 0.5); assert.ok(Math.abs(p.particles[0].x - 150) < 3 && Math.abs(p.particles[0].y - 50) < 1e-6);
    tick(p, 0.8); assert.equal(p.particles.length, 0);
    const fan = make({ angle: -90, spread: 60, speed: 100, speedVariation: 0 }); fan.burst(40);
    for (const q of fan.particles) { const deg = (Math.atan2(q.vy, q.vx) * 180) / Math.PI; assert.ok(deg >= -120.01 && deg <= -59.99, deg); }
});
await test('gravity pulls particles down; the entity rotation turns the emission direction', () => {
    const g = make({ angle: 0, spread: 0, speed: 0, gravity: 200, lifetime: 2 }); g.burst(1); tick(g, 0.5); assert.ok(g.particles[0].vy > 90);
    const r = make({ angle: 0, spread: 0, speed: 100, speedVariation: 0 }, entity(0, 0, 90)); r.burst(1);
    assert.ok(Math.abs(r.particles[0].vx) < 1e-6 && r.particles[0].vy > 99);   // rotated 90 degrees: right becomes down
});
await test('continuous emission follows the rate and stops when switched off', () => {
    const p = make({ emitting: true, rate: 60, lifetime: 10 }); tick(p, 1); assert.ok(p.particles.length >= 58 && p.particles.length <= 62, p.particles.length);
    p.emitting = false; const n = p.particles.length; tick(p, 1); assert.equal(p.particles.length, n);
});
await test('drawing: size and color change over the lifetime, world-space particles stay put when the entity moves', () => {
    const e = entity(0, 0); const p = make({ angle: 0, spread: 0, speed: 0, startSize: 10, endSize: 0, startColor: '#000000', endColor: '#ffffff', fade: true, lifetime: 1 }, e);
    p.burst(1); tick(p, 0.5);
    const k = p.particles[0].age / p.particles[0].life;                                  // lifetime is jittered a little per particle
    const c = ctxMock(); p.draw(c); assert.ok(Math.abs(c.calls.find(x => x[0] === 'arc')[3] - (10 * (1 - k)) / 2) < 0.01);   // radius = size/2, shrinking 10 -> 0
    const grey = Math.round(255 * k).toString(16).padStart(2, '0'); assert.equal(c.calls.find(x => x[0] === 'fill')[1], `#${grey}${grey}${grey}`);
    e.transform.position.x = 40; const c2 = ctxMock(); p.draw(c2); assert.ok(Math.abs(c2.calls.find(x => x[0] === 'arc')[1] + 40) < 0.5); // drawn 40 to the left in local space
    const local = make({ worldSpace: false, angle: 0, spread: 0, speed: 0 }, e); local.burst(1); const c3 = ctxMock(); local.draw(c3); assert.equal(c3.calls.find(x => x[0] === 'arc')[1], 0);
});
await test('restoreState clears particles (Stop must not leave confetti behind)', () => { const p = make(); p.burst(5); p.restoreState(); assert.equal(p.particles.length, 0); });

await test('Animator.playAsync resolves when a one-shot clip finishes, and false for an unknown clip', async () => {
    const e = { transform: { position: { x: 0, y: 0 }, rotation: 0, size: { x: 1, y: 1 } }, components: [] };
    const a = new Animator({ clips: [{ name: 'sink', duration: 0.2, loop: false, tracks: [{ path: 'transform.size.x', keys: [{ t: 0, v: 1 }, { t: 0.2, v: 0 }] }], events: [] }], playOnStart: false }); a.entity = e;
    let done = false; const promise = a.playAsync('sink').then((v) => { done = v; });
    tick(a, 0.1); await Promise.resolve(); assert.equal(done, false);
    tick(a, 0.2); await promise; assert.equal(done, true); assert.equal(e.transform.size.x, 0);
    assert.equal(await a.playAsync('nope'), false);
});
console.log(`\n${passed} passed`);
