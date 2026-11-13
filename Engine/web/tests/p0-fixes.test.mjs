// Run: node Engine/web/tests/p0-fixes.test.mjs   (no browser needed)
// Engine round 1, small P0 fixes: entities spawned from start() survive scene load, collider outlines default off, quick taps register.
import assert from 'node:assert/strict';
import { loadLoopHarness } from './_harness.mjs';
import { EntityRegistry } from '../EntityRegistry.js';

let passed = 0; const test = async (n, f) => { await f(); passed++; console.log('PASS', n); };
const { makeLoop, Entity, listeners } = await loadLoopHarness();
const { default: Debug } = await import('../static/Debug.js');
const { default: input } = await import('../static/Input.js');
const { InputController } = await import('../Input/InputController.js');

const fire = (type, e) => (listeners[type] ?? []).forEach(fn => fn(e));
const saved = (key, type, x = 0) => ({ sceneKey: key, type, tag: type.replace('P0', ''), transform: { position: { x, y: 0 }, rotation: 0, size: { x: 10, y: 10 } }, fields: {}, components: [] });

class Spawner extends Entity {
    start() { this.tag = 'Spawner'; this.children2 = [0, 1, 2].map(i => { const c = new Child(); c.index = i; c.start(); window.Piston.gameLoop.entities.push(c); return c; }); }
}
class Child extends Entity { start() { this.tag = 'Child'; } }
EntityRegistry.register('P0Spawner', Spawner, 'Test'); EntityRegistry.register('P0Child', Child, 'Test');

await test('entities spawned from start() survive loading a scene from data, after the saved ones', async () => {
    const loop = makeLoop(); window.Piston = { gameLoop: loop };
    const list = loop.replaceEntitiesFromData({ entities: [saved('a', 'P0Spawner'), saved('b', 'P0Child', 5)] });
    assert.equal(list, loop.entities);
    assert.deepEqual(loop.entities.map(e => e.tag), ['Spawner', 'Child', 'Child', 'Child', 'Child']);
    assert.equal(loop.entities.filter(e => e.tag === 'Child').length, 4);
    assert.equal(new Set(loop.entities).size, loop.entities.length);
});
await test('a scene load that throws in start() propagates the error', () => {
    class Bad extends Entity { start() { throw new Error('boom'); } }
    EntityRegistry.register('P0Bad', Bad, 'Test');
    const loop = makeLoop(); assert.throws(() => loop.replaceEntitiesFromData({ entities: [saved('x', 'P0Bad')] }), /boom/);
});
await test('Debug.showColliders defaults to false (the editor opts in)', () => { assert.equal(Debug.showColliders, false); });
await test('a tap pressed and released between two steps is still seen, exactly once', () => {
    input.endStep();
    fire('keydown', { code: 'KeyR', repeat: false }); fire('keyup', { code: 'KeyR' });
    assert.equal(input.getKeyDown('KeyR'), true); assert.equal(input.wasPressed('KeyR'), true); assert.equal(input.wasReleased('KeyR'), true);
    input.endStep();
    assert.equal(input.getKeyDown('KeyR'), false); assert.equal(input.wasPressed('KeyR'), false); assert.equal(input.wasReleased('KeyR'), false);
});
await test('held keys: edge on the first step only, key repeat is not a new press', () => {
    input.endStep(); fire('keydown', { code: 'Space', repeat: false });
    assert.ok(input.wasPressed('Space')); input.endStep();
    assert.ok(!input.wasPressed('Space')); assert.ok(input.getKeyDown('Space'));
    fire('keydown', { code: 'Space', repeat: true }); assert.ok(!input.wasPressed('Space'));
    fire('keyup', { code: 'Space' }); assert.ok(input.wasReleased('Space')); assert.ok(!input.getKeyDown('Space')); input.endStep();
});
await test('mouse clicks: quick click registers as pressed for a step; edges per button', () => {
    input.endStep(); fire('mousedown', { button: 0 }); fire('mouseup', { button: 0 });
    assert.ok(input.isMouseButtonPressed(0)); assert.ok(input.wasMousePressed(0)); assert.ok(input.wasMouseReleased(0)); assert.ok(!input.wasMousePressed(2));
    input.endStep(); assert.ok(!input.isMouseButtonPressed(0)); assert.ok(!input.wasMousePressed(0));
});
await test('GameLoop clears edges after each step, so two steps in one frame never double-fire', () => {
    const loop = makeLoop(); let seen = [];
    class Watcher extends Entity { start() {} update() { seen.push(input.wasPressed('KeyZ')); } }
    loop.entities = [new Watcher()];
    input.endStep(); fire('keydown', { code: 'KeyZ' }); fire('keyup', { code: 'KeyZ' });
    loop.update(1000 + 2000 / 60 + 0.4); // a frame long enough for two steps
    assert.deepEqual(seen, [true, false]);
});
await test('edges pressed while paused are dropped, not replayed on the first step after resuming', () => {
    const loop = makeLoop(); let seen = []; class W extends Entity { start() {} update() { seen.push(input.wasPressed('KeyP')); } }
    loop.entities = [new W()]; loop.playState = 'paused';
    fire('keydown', { code: 'KeyP' }); fire('keyup', { code: 'KeyP' }); loop.update(1016);
    loop.playState = 'playing'; loop.update(1016 + 1000 / 60); assert.deepEqual(seen, [false]);
});
await test('InputController.wasActionPressed reads key and mouse tokens', () => {
    const c = new InputController({ bindings: { jump: 'Space', fire: 'Mouse0', none: '' } });
    input.endStep(); fire('keydown', { code: 'Space' }); fire('mousedown', { button: 0 });
    assert.ok(c.wasActionPressed('jump')); assert.ok(c.wasActionPressed('fire')); assert.ok(!c.wasActionPressed('missing')); assert.ok(!c.wasActionPressed('none'));
    input.endStep(); assert.ok(!c.wasActionPressed('jump')); fire('keyup', { code: 'Space' }); fire('mouseup', { button: 0 }); input.endStep();
});
await test('a canvas with no layout box does not turn the mouse position into NaN', () => {
    input.setCanvas({ width: 200, height: 100, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) }); fire('mousemove', { clientX: 12, clientY: 34 });
    assert.deepEqual(input.getCanvasMousePosition(), { x: 12, y: 34 });
});
await test('a trail with a NaN position draws nothing instead of throwing', async () => {
    const { TrailRenderer } = await import('../TrailRenderer.js'); const t = new TrailRenderer(); t.entity = { transform: { position: { x: NaN, y: 0 }, rotation: 0, size: { x: 1, y: 1 } } };
    t.points = [{ x: 1, y: 1, age: 0 }, { x: 2, y: 2, age: 0.1 }]; const ctx = new Proxy({}, { get: (_, k) => (k === 'globalAlpha' ? 1 : () => { throw new Error('drew ' + String(k)); }), set: () => true }); t.draw(ctx);
});
console.log(`${passed} passed`);
