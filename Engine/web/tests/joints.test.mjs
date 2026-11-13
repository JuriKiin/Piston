// Run: node Engine/web/tests/joints.test.mjs   (no browser needed)
import assert from 'node:assert/strict';
import { loadLoopHarness } from './_harness.mjs';
import { solveDistance } from '../Physics/DistanceConstraint.js';
import { DistanceJoint } from '../DistanceJoint.js';
import { RopeChain } from '../RopeChain.js';
import { ComponentRegistry } from '../ComponentRegistry.js';
import { Rigidbody } from '../Physics/Rigidbody.js';
import { Vector2 } from '../Physics/Vector2.js';
import { Transform } from '../Transform.js';

let passed = 0; const test = async (n, f) => { await f(); passed++; console.log('PASS', n); };
const { makeLoop, Entity } = await loadLoopHarness();
class Body extends Entity {
    constructor(x = 0, y = 0, { dynamic = true, mass = 1, gravity = 0 } = {}) {
        super(new Transform(new Vector2(x, y), 0, new Vector2(10, 10)), dynamic ? new Rigidbody(new Vector2(0, 0), gravity, gravity !== 0, mass) : null, 'Body');
        if (this.rigidbody) this.rigidbody.physicsMaterial = { friction: 0, bounciness: 0 };
    }
    start() {}
}
const pos = (e) => [e.transform.position.x, e.transform.position.y];
const dist = (a, b) => Math.hypot(a.transform.position.x - b.transform.position.x, a.transform.position.y - b.transform.position.y);
const step = (loop, n = 1) => { for (let i = 0; i < n; i++) loop.stepOnce(); };

await test('constraint: pulls a stretched pair to length, split by inverse mass; immovable bodies stay', () => {
    const a = new Body(0, 0, { mass: 1 }), b = new Body(200, 0, { mass: 3 });
    const err = solveDistance(a, b, 100); assert.equal(err, 100);
    assert.ok(Math.abs(dist(a, b) - 100) < 1e-9); assert.ok(Math.abs(a.transform.position.x - 75) < 1e-9); assert.ok(Math.abs(b.transform.position.x - 175) < 1e-9);
    const s = new Body(0, 0, { dynamic: false }), d = new Body(300, 0); solveDistance(s, d, 100); assert.deepEqual(pos(s), [0, 0]); assert.equal(d.transform.position.x, 100);
    const st = new Body(0, 0); st.rigidbody.isStatic = true; const e = new Body(300, 0); solveDistance(st, e, 100); assert.equal(st.transform.position.x, 0);
});
await test('constraint: correction is kept as velocity; stiffness scales it; maxOnly never pushes apart', () => {
    const a = new Body(0, 0, { dynamic: false }), b = new Body(200, 0); solveDistance(a, b, 100, { stiffness: 0.5 });
    assert.equal(b.transform.position.x, 150); assert.equal(b.rigidbody.velocity.x, -50);
    const c = new Body(0, 0, { dynamic: false }), d = new Body(50, 0); solveDistance(c, d, 100, { maxOnly: true }); assert.equal(d.transform.position.x, 50);
    solveDistance(c, d, 100); assert.equal(d.transform.position.x, 100);
});
await test('constraint: coincident bodies separate deterministically along +x; NaN and no-anchor are safe', () => {
    const a = new Body(5, 5, { dynamic: false }), b = new Body(5, 5); solveDistance(a, b, 10); assert.deepEqual(pos(b), [15, 5]);
    const n = new Body(NaN, 0); assert.doesNotThrow(() => solveDistance(a, n, 10)); assert.equal(solveDistance(a, null, 10), 0);
    const p = new Body(0, 0, { dynamic: false }); const bob = new Body(0, 80); solveDistance(bob, null, 50, { anchor: { x: 0, y: 0 } }); assert.ok(Math.abs(bob.transform.position.y - 50) < 1e-9);
});
await test('DistanceJoint: registered with explicit fields; target set from code; solves in the loop', () => {
    assert.ok(ComponentRegistry.get('DistanceJoint')); const by = Object.fromEntries(DistanceJoint.fields.map(f => [f.key, f])); assert.ok(by.length.animatable && by.stiffness.animatable); assert.equal(by.rope.type, 'checkbox');
    const anchor = new Body(0, 0, { dynamic: false }), bob = new Body(300, 0); const j = bob.addComponent(new DistanceJoint({ length: 100 })); j.target = anchor;
    const loop = makeLoop(() => [anchor, bob]); step(loop); assert.ok(Math.abs(dist(anchor, bob) - 100) < 1e-6);
});
await test('DistanceJoint: a pendulum swings under gravity and keeps its length; it is identical across runs', () => {
    const run = () => { const pivot = new Body(100, 0, { dynamic: false }), bob = new Body(200, 0, { gravity: -1 }); const j = bob.addComponent(new DistanceJoint({ length: 100, iterations: 8 })); j.target = pivot;
        const loop = makeLoop(() => [pivot, bob]); const ds = []; for (let i = 0; i < 300; i++) { loop.stepOnce(); ds.push(dist(pivot, bob)); } return { ds, p: pos(bob) }; };
    const a = run(), b = run(); assert.deepEqual(a.p, b.p); assert.deepEqual(a.ds, b.ds);
    assert.ok(a.ds.every(d => Math.abs(d - 100) < 1.5), 'max error ' + Math.max(...a.ds.map(d => Math.abs(d - 100))));
    assert.ok(Math.abs(a.p[1]) > 5 && Math.abs(a.p[0] - 200) > 5, 'the bob swung: ' + a.p);
});
await test('DistanceJoint: anchor point mode, rope slack, pinSelf, destroyed target is ignored', () => {
    const bob = new Body(0, 300); const j = bob.addComponent(new DistanceJoint({ length: 100, anchorX: 0, anchorY: 0, rope: true })); const loop = makeLoop(() => [bob]);
    step(loop); assert.ok(Math.abs(bob.transform.position.y - 100) < 1e-6);
    bob.transform.position.y = 40; bob.rigidbody.velocity = new Vector2(0, 0); step(loop); assert.equal(bob.transform.position.y, 40); // slack
    j.pinSelf = true; bob.transform.position.y = 500; step(loop); assert.ok(Math.abs(bob.transform.position.y - 500) < 1e-9);
    const t = new Body(0, 0, { dynamic: false }); j.pinSelf = false; j.target = t; t.destroyed = true; bob.transform.position.y = 900; step(loop); assert.equal(bob.transform.position.y, 900);
});
await test('RopeChain: registered; a taut chain keeps every link at segment length while the head is dragged around', () => {
    assert.ok(ComponentRegistry.get('RopeChain')); const by = Object.fromEntries(RopeChain.fields.map(f => [f.key, f])); assert.ok(by.segmentLength.animatable); assert.equal(by.lineColor.type, 'color');
    const head = new Body(0, 0, { dynamic: false }), links = [head]; for (let i = 1; i <= 8; i++) links.push(new Body(-i * 50, 0));
    const chain = head.addComponent(new RopeChain({ segmentLength: 50, iterations: 10 })); chain.setLinks(links);
    const loop = makeLoop(() => links); let worst = 0;
    for (let i = 0; i < 400; i++) { const u = i * 0.02; head.transform.position.x = 200 * Math.sin(u); head.transform.position.y = 120 * Math.sin(2 * u); loop.stepOnce();
        if (i > 60) for (let k = 0; k + 1 < links.length; k++) worst = Math.max(worst, Math.abs(dist(links[k], links[k + 1]) - 50)); }
    assert.ok(worst < 3, 'worst link error ' + worst);
});
await test('RopeChain: deterministic across runs; no link explodes', () => {
    const run = () => { const head = new Body(0, 0, { dynamic: false }), links = [head]; for (let i = 1; i <= 10; i++) links.push(new Body(0, 0, { gravity: -0.3 }));
        const c = head.addComponent(new RopeChain({ segmentLength: 30, rope: true })); c.setLinks(links); const loop = makeLoop(() => links);
        for (let i = 0; i < 500; i++) { head.transform.position.x = 300 * Math.sin(i * 0.03); loop.stepOnce(); } return links.map(pos); };
    const a = run(), b = run(); assert.deepEqual(a, b); assert.ok(a.flat().every(Number.isFinite) && a.flat().every(v => Math.abs(v) < 5000));
});
await test('RopeChain rope mode: links stacked on one point unfurl as the head moves away, and never push', () => {
    const head = new Body(0, 0, { dynamic: false }), links = [head]; for (let i = 1; i <= 5; i++) links.push(new Body(0, 0));
    const c = head.addComponent(new RopeChain({ segmentLength: 40, rope: true, iterations: 8 })); c.setLinks(links); const loop = makeLoop(() => links);
    step(loop, 5); assert.ok(links.slice(1).every(l => dist(l, head) < 1e-6)); // slack: nothing moves
    for (let i = 0; i < 200; i++) { head.transform.position.x += 5; loop.stepOnce(); }
    for (let k = 0; k + 1 < links.length; k++) assert.ok(dist(links[k], links[k + 1]) <= 41, `gap ${k}`); assert.ok(dist(head, links[5]) > 150);
});
await test('RopeChain: a destroyed or inactive link is skipped and the chain closes up; draw strokes a polyline', () => {
    const head = new Body(0, 0, { dynamic: false }), mid = new Body(50, 0), tail = new Body(100, 0);
    const c = head.addComponent(new RopeChain({ segmentLength: 50, drawLine: true })); c.setLinks([head, mid, tail]); const loop = makeLoop(() => [head, mid, tail]);
    mid.destroy(); step(loop, 3); assert.ok(Math.abs(dist(head, tail) - 50) < 1e-6); assert.deepEqual(c.liveLinks, [head, tail]);
    const calls = []; const ctx = { beginPath() {}, moveTo(x, y) { calls.push(['m', x, y]); }, lineTo(x, y) { calls.push(['l', x, y]); }, stroke() { calls.push(['s']); }, set strokeStyle(v) {}, set lineWidth(v) {}, set lineJoin(v) {}, set lineCap(v) {} };
    c.draw(ctx); assert.deepEqual(calls.map(c => c[0]), ['m', 'l', 's']); c.drawLine = false; calls.length = 0; c.draw(ctx); assert.equal(calls.length, 0);
});
await test('joints on inactive entities do not solve', () => {
    const a = new Body(0, 0, { dynamic: false }), b = new Body(500, 0); const j = b.addComponent(new DistanceJoint({ length: 10 })); j.target = a; const loop = makeLoop(() => [a, b]);
    b.active = false; step(loop); assert.equal(b.transform.position.x, 500); b.active = true; step(loop); assert.ok(b.transform.position.x < 20);
});
console.log(`${passed} passed`);
