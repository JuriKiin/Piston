// Run: node Engine/web/tests/fixed-step.test.mjs   (no browser needed)
// Fixed-timestep simulation: accumulator maths, GameLoop stepping, timeScale, stepOnce (editor Step), and per-frame velocity behaviour at 60 Hz.
import assert from 'node:assert/strict';
import { FixedStep } from '../FixedStep.js';
import { loadLoopHarness } from './_harness.mjs';
import Constants from '../static/Constants.js';
import { Vector2 } from '../Physics/Vector2.js';
import { Rigidbody } from '../Physics/Rigidbody.js';
import { Transform } from '../Transform.js';

let passed = 0; const test = async (n, f) => { await f(); passed++; console.log('PASS', n); };
const { makeLoop, Entity } = await loadLoopHarness();

class Mover extends Entity {
    constructor() { super(new Transform(new Vector2(0, 0), 0, new Vector2(10, 10)), new Rigidbody(new Vector2(3, 0), 0, false), 'Mover'); this.rigidbody.physicsMaterial = { friction: 0, bounciness: 0 }; this.updates = 0; this.seenDt = []; }
    start() {}
    update() { this.updates++; this.seenDt.push(Constants.DELTA_TIME); super.update(); }
}

await test('accumulator: whole display frames at the step rate give one step each', () => {
    const f = new FixedStep({ hz: 60 }); let n = 0;
    for (let i = 0; i < 60; i++) n += f.advance(1 / 60);
    assert.equal(n, 60);
});
await test('accumulator: jittery 60 Hz frame times still give exactly one step per frame', () => {
    const f = new FixedStep({ hz: 60 }); let n = 0, t = 0;
    for (let i = 0; i < 600; i++) { const dt = (16 + (i % 3) * 0.7) / 1000; /* 16.0 / 16.7 / 17.4 ms */ const s = f.advance(dt); assert.ok(s <= 1, `frame ${i} ran ${s} steps`); n += s; t += dt; }
    assert.ok(n >= 595 && n <= 600, String(n));
});
await test('accumulator: 144 Hz and 30 Hz displays simulate the same amount per second', () => {
    for (const fps of [30, 59.94, 75, 120, 144, 240]) {
        const f = new FixedStep({ hz: 60 }); let n = 0;
        for (let i = 0; i < Math.round(fps * 10); i++) n += f.advance(1 / fps);
        assert.ok(Math.abs(n - 600) <= 4, `${fps} fps ran ${n} steps in 10 s`);
    }
});
await test('accumulator: a stall runs at most maxSteps and drops the backlog; configurable rate', () => {
    const f = new FixedStep({ hz: 60, maxSteps: 5 });
    assert.equal(f.advance(2), 5); assert.equal(f.advance(1 / 60), 1);
    f.setRate(120); assert.equal(f.step, 1 / 120); assert.equal(f.advance(1 / 60), 2);
    f.setRate(NaN); assert.equal(f.hz, 60); f.setRate(99999); assert.equal(f.hz, 1000);
    assert.equal(f.advance(-1), 0); assert.equal(f.advance(NaN), 0);
});
await test('GameLoop: a 144 Hz display moves a per-step body as far per second as a 60 Hz one', () => {
    const run = (fps) => { const m = new Mover(); const loop = makeLoop(() => [m]); let now = 1000;
        for (let i = 0; i < Math.round(fps * 2); i++) { now += 1000 / fps; loop.update(now); } return m; };
    const a = run(60), b = run(144), c = run(30);
    assert.equal(a.updates, 120); assert.ok(Math.abs(b.updates - 120) <= 2, String(b.updates)); assert.ok(Math.abs(c.updates - 120) <= 2, String(c.updates));
    assert.equal(a.transform.position.x, 360); // 3 px per step, 120 steps: MiniGolf-style "pixels per frame" velocities behave exactly as before at 60 Hz
    assert.ok(Math.abs(b.transform.position.x - 360) <= 6);
});
await test('GameLoop: DELTA_TIME inside a step is the fixed step times timeScale', () => {
    const m = new Mover(); const loop = makeLoop(() => [m]); let now = 1000;
    const frame = () => { now += 1000 / 60; loop.update(now); };
    frame(); loop.timeScale = 0.5; frame(); loop.timeScale = 0; frame();
    assert.ok(Math.abs(m.seenDt[0] - 1 / 60) < 1e-12); assert.ok(Math.abs(m.seenDt[1] - 1 / 120) < 1e-12); assert.equal(m.seenDt[2], 0);
    assert.equal(m.updates, 3); // timeScale 0 still steps (hit-stop freezes time-based things, per-step velocities keep their old behaviour)
});
await test('GameLoop: fixedHz is configurable and changes the step length', () => {
    const m = new Mover(); const loop = makeLoop(() => [m], { fixedHz: 120 }); assert.equal(loop.fixedHz, 120);
    loop.update(1000 + 1000 / 60); assert.equal(m.updates, 2); assert.ok(Math.abs(m.seenDt[0] - 1 / 120) < 1e-12);
    loop.fixedHz = 30; assert.equal(loop.fixedDelta, 1 / 30);
});
await test('GameLoop: stepOnce advances exactly one step even when paused or time stopped; Paused frames do not simulate', () => {
    const m = new Mover(); const loop = makeLoop(() => [m]);
    loop.playState = 'paused'; loop.update(1016); loop.update(1032); assert.equal(m.updates, 0);
    loop.stepOnce(); assert.equal(m.updates, 1); assert.equal(loop.simSteps, 1); assert.equal(m.transform.position.x, 3);
    loop.update(6000); assert.equal(m.updates, 1); // a long pause then a paused frame: nothing banked
    loop.playState = 'playing'; loop.lastTime = 6000; loop.update(6000 + 1000 / 60); assert.equal(m.updates, 2); // resume: one step, no catch-up burst
    loop.timeScale = 0; loop.playState = 'paused'; loop.stepOnce(); assert.equal(m.updates, 3);
});
await test('GameLoop: when steps are expensive, catch-up is limited so heavy scenes slow down instead of spiralling', () => {
    const m = new Mover(); const loop = makeLoop(() => [m]); loop.stepCostMs = 16; // each step takes as long as a step is
    loop.update(1000 + 1000 / 15); assert.equal(m.updates, 1); // a 66 ms frame owes 4 steps but only 1 may run
    const cheap = new Mover(); const l2 = makeLoop(() => [cheap]); l2.stepCostMs = 1;
    l2.update(1000 + 1000 / 15); assert.equal(cheap.updates, 4); // cheap steps catch up fully
});
await test('GameLoop: a 100 ms stall runs a bounded number of steps', () => {
    const m = new Mover(); const loop = makeLoop(() => [m]);
    loop.update(1100); assert.ok(m.updates >= 1 && m.updates <= 5, String(m.updates));
});
await test('GameLoop: destroyed entities are swept between steps and gravity integrates per step', () => {
    const e = new Mover(); e.rigidbody.useGravity = true; e.rigidbody.gravity = -60; e.rigidbody.velocity = new Vector2(0, 0);
    const loop = makeLoop(() => [e]); let now = 1000;
    for (let i = 0; i < 60; i++) { now += 1000 / 60; loop.update(now); }
    assert.ok(Math.abs(e.rigidbody.velocity.y - 60) < 1e-6, String(e.rigidbody.velocity.y)); // a * 1 s, regardless of the frame schedule
    e.destroy(); now += 16.7; loop.update(now); assert.ok(!loop.entities.includes(e));
});
console.log(`${passed} passed`);
