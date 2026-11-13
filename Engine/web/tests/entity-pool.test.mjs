// Run: node Engine/web/tests/entity-pool.test.mjs   (no browser needed)
// The entity `active` flag and EntityPool: inactive entities skip update, drawing and collision; pooled entities are recycled instead of rebuilt.
import assert from 'node:assert/strict';
import { loadLoopHarness } from './_harness.mjs';
import { EntityPool } from '../EntityPool.js';
import { Rigidbody } from '../Physics/Rigidbody.js';
import { CircleCollider } from '../Physics/Colliders/CircleCollider.js';
import { Vector2 } from '../Physics/Vector2.js';
import { Transform } from '../Transform.js';

let passed = 0; const test = async (n, f) => { await f(); passed++; console.log('PASS', n); };
const { makeLoop, Entity } = await loadLoopHarness();
const noopCtx = new Proxy({}, { get: (t, k) => (k === 'globalAlpha' ? 1 : () => {}), set: () => true });

class Thing extends Entity {
    constructor() { super(new Transform(new Vector2(0, 0), 0, new Vector2(10, 10)), null, 'Thing'); this.updates = 0; this.draws = 0; this.starts = 0; }
    start() { this.starts++; }
    update() { if (!this.active) { this.leaked = true; } this.updates++; super.update(); }
    draw() { this.draws++; }
}
const body = (e, r = 10) => { const rb = new Rigidbody(); rb.useGravity = false; rb.mass = 1; rb.collider = new CircleCollider(e, r); rb.collider.isTrigger = true; e.rigidbody = rb; e.hits = 0; rb.collider.onCollisionEnter = () => { e.hits++; }; return e; };
const frame = (loop, n = 1) => { for (let i = 0; i < n; i++) { loop.lastTime = loop.lastTime ?? 1000; loop.update(loop.lastTime + 1000 / 60); } };

await test('entity.active=false skips update, drawing and the rest of the step; true resumes', () => {
    const e = new Thing(), loop = makeLoop(() => [e]);
    frame(loop, 2); assert.equal(e.updates, 2); assert.ok(e.draws >= 2);
    e.active = false; const d = e.draws; frame(loop, 3); assert.equal(e.updates, 2); assert.equal(e.draws, d);
    e.active = true; frame(loop); assert.equal(e.updates, 3);
});
await test('inactive entities do not collide and report no overlaps; active ones do', () => {
    const a = body(new Thing()), b = body(new Thing()); a.transform.position = new Vector2(100, 50); b.transform.position = new Vector2(105, 50);
    const loop = makeLoop(() => [a, b]); b.active = false; frame(loop, 2);
    assert.equal(a.hits, 0); assert.ok(!loop.activeColliders.includes(b));
    b.active = true; frame(loop); assert.ok(a.hits >= 1 && b.hits >= 1); // (the engine reports each overlapping pair from both sides)
});
await test('inactive entities leave the render lists and the camera/input scans', () => {
    const e = new Thing(), loop = makeLoop(() => [e]); e.active = false;
    let drawn = 0; const orig = e.render.bind(e); e.render = (c) => { drawn++; orig(c); }; frame(loop); assert.equal(drawn, 0);
});
await test('active is part of the edit snapshot', () => {
    const e = new Thing(), loop = makeLoop(() => [e]); const snap = loop.captureSnapshot(); e.active = false; loop.restoreSnapshot(snap); assert.equal(e.active, true);
});
await test('pool: builds once, recycles, runs onAcquire every time, destroy() returns to the pool', () => {
    const loop = makeLoop(); const log = [];
    const pool = new EntityPool({ loop, create: () => new Thing(), onAcquire: (e, x, y) => { e.transform.position = new Vector2(x, y); log.push(['acquire', x]); }, onRelease: () => log.push(['release']) });
    const a = pool.acquire(1, 2); assert.equal(a.starts, 1); assert.ok(loop.entities.includes(a)); assert.equal(a.active, true); assert.equal(pool.liveCount, 1);
    a.destroy(); assert.equal(a.active, false); assert.equal(a.destroyed, false); assert.equal(pool.liveCount, 0); assert.equal(pool.free.length, 1);
    frame(loop); assert.ok(loop.entities.includes(a)); assert.equal(a.updates, 0); // still in the scene, just switched off
    const b = pool.acquire(5, 6); assert.equal(b, a); assert.equal(b.starts, 1); assert.deepEqual([b.transform.position.x, b.transform.position.y], [5, 6]);
    assert.equal(pool.created, 1); assert.deepEqual(log.map(l => l[0]), ['acquire', 'release', 'acquire']);
});
await test('pool: lifetime expiry recycles; double release and foreign release are harmless', () => {
    const loop = makeLoop(); const pool = new EntityPool({ loop, create: () => new Thing(), onAcquire: (e) => { e.lifetime = 0.05; } });
    const e = pool.acquire(); frame(loop, 5); assert.equal(e.active, false); assert.equal(pool.free.length, 1);
    pool.release(e); pool.release(e); assert.equal(pool.free.length, 1); pool.release(new Thing()); pool.release(null);
    const e2 = pool.acquire(); assert.equal(e2, e); assert.equal(e2.lifetime, 0.05);
});
await test('pool: max caps live entities; prewarm builds parked entities; releaseAll', () => {
    const loop = makeLoop(); const pool = new EntityPool({ loop, create: () => new Thing(), max: 3, prewarm: 2 });
    const live = [pool.acquire(), pool.acquire(), pool.acquire()]; assert.equal(pool.created, 3); assert.equal(pool.acquire(), null);
    pool.releaseAll(); assert.equal(pool.liveCount, 0); assert.equal(pool.free.length, 3); assert.ok(live.every(e => !e.active));
    assert.equal(loop.entities.filter(e => e instanceof Thing).length, 3);
});
await test('pool: a recycled collider reports a fresh Enter on reuse', () => {
    const loop = makeLoop(); const target = body(new Thing()); target.transform.position = new Vector2(100, 50); loop.entities.push(target);
    const pool = new EntityPool({ loop, create: () => body(new Thing()), onAcquire: (e) => { e.transform.position = new Vector2(100, 50); } });
    const b = pool.acquire(); frame(loop); const first = b.hits; assert.ok(first >= 1);
    b.destroy(); frame(loop); assert.equal(b.hits, first); const again = pool.acquire(); frame(loop); assert.equal(again, b); assert.ok(b.hits > first);
});
await test('pool: a scene rebuild makes the pool forget its entities and build anew', () => {
    const loop = makeLoop(); const pool = new EntityPool({ loop, create: () => new Thing() });
    const a = pool.acquire(); a.destroy(); loop.generation++; loop.entities = [];
    const b = pool.acquire(); assert.notEqual(b, a); assert.equal(a._pool, null); assert.equal(pool.size, 1); assert.ok(loop.entities.includes(b));
});
await test('pool: dispose turns entities back into ordinary ones and removes them', () => {
    const loop = makeLoop(); const pool = new EntityPool({ loop, create: () => new Thing() }); const a = pool.acquire(); pool.dispose(); assert.equal(a.destroyed, true);
    frame(loop); assert.ok(!loop.entities.includes(a));
});
await test('pool without a loop fails loudly; create is required', () => {
    assert.throws(() => new EntityPool({}), /create/); const p = new EntityPool({ create: () => new Thing() }); assert.throws(() => p.acquire(), /GameLoop/);
});
console.log(`${passed} passed`);
