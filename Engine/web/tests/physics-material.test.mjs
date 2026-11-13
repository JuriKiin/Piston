// Run: node Engine/web/tests/physics-material.test.mjs
import assert from 'node:assert/strict';
import { PhysicsMaterialComponent as Zone } from '../PhysicsMaterialComponent.js';
import { LevelFlow, LevelInfo } from '../LevelFlow.js';
import { SceneRegistry } from '../SceneRegistry.js';
import { Scene } from '../Scene.js';
import { PhysicsMaterial } from '../Physics/PhysicsMaterial.js';
import Constants from '../static/Constants.js';

let passed = 0;
const test = (n, f) => { f(); passed++; console.log('PASS', n); };
const ball = () => ({ tag: 'Ball', rigidbody: { velocity: { x: 0, y: 0 }, physicsMaterial: PhysicsMaterial.Turf } });
const zone = (opts) => {
    const collider = { isTrigger: false };
    const z = new Zone({ zone: true, ...opts });
    z.entity = { transform: { rotation: 0 }, rigidbody: { collider } };
    z.update(); // hooks the collider
    return { z, collider };
};

test('presets fill friction and boost; custom keeps your numbers', () => {
    assert.equal(new Zone({ kind: 'ice' }).resolved().friction, 0);
    assert.equal(new Zone({ kind: 'bouncy' }).resolved().restitution, 0.9);
    assert.equal(new Zone({ kind: 'boost' }).resolved().boost, 400);
    assert.equal(new Zone({ kind: 'custom', friction: 0.4, boost: 10 }).resolved().friction, 0.4);
});
test('the zone becomes a trigger and swaps friction only while the ball is inside', () => {
    const { z, collider } = zone({ kind: 'sand' });
    const b = ball(); const before = b.rigidbody.physicsMaterial;
    assert.equal(collider.isTrigger, true);
    collider.onCollisionEnter({ entity: b });
    assert.equal(b.rigidbody.physicsMaterial.friction, 0.25);
    assert.equal(b.rigidbody.physicsMaterial.restitution, 0.1);
    collider.onCollisionExit({ entity: b });
    assert.equal(b.rigidbody.physicsMaterial, before);
});
test('overlapping zones restore the original material only after the last exit', () => {
    const a = zone({ kind: 'sand' }), c = zone({ kind: 'mud' });
    const b = ball(); const before = b.rigidbody.physicsMaterial;
    a.collider.onCollisionEnter({ entity: b }); c.collider.onCollisionEnter({ entity: b });
    a.collider.onCollisionExit({ entity: b });
    assert.notEqual(b.rigidbody.physicsMaterial, before);
    c.collider.onCollisionExit({ entity: b });
    assert.equal(b.rigidbody.physicsMaterial, before);
});
test('a solid entity applies the material to its own rigidbody', () => {
    const z = new Zone({ kind: 'bouncy' });
    z.entity = { transform: { rotation: 0 }, rigidbody: { collider: { isTrigger: false }, physicsMaterial: PhysicsMaterial.Default } };
    z.update();
    assert.equal(z.entity.rigidbody.physicsMaterial.restitution, 0.9);
    assert.equal(z.entity.rigidbody.collider.isTrigger, false);
});
test('only the affected tag is touched', () => {
    const { collider } = zone({ kind: 'ice' });
    const other = { tag: 'Wall', rigidbody: { velocity: { x: 0, y: 0 }, physicsMaterial: PhysicsMaterial.Default } };
    collider.onCollisionEnter({ entity: other });
    assert.equal(other.rigidbody.physicsMaterial.friction, PhysicsMaterial.Default.friction);
});
test('boost pushes along the zone rotation each frame', () => {
    const { z, collider } = zone({ kind: 'boost' });
    z.entity.transform.rotation = 90; Constants.DELTA_TIME = 0.5;
    const b = ball(); collider.onCollisionEnter({ entity: b });
    z.update();
    assert.ok(Math.abs(b.rigidbody.velocity.x) < 1e-6 && Math.abs(b.rigidbody.velocity.y - 200) < 1e-6);
});
test('LevelFlow records results, replaces a replayed level, totals vs par, and finds the next scene', () => {
    SceneRegistry.register(new Scene({ id: 'h2', name: 'H2', backgroundColor: '#000' }));
    LevelFlow.reset();
    const info1 = new LevelInfo({ title: 'One', par: 3, nextScene: 'h2' });
    const r1 = LevelFlow.complete('h1', 4, info1);
    assert.equal(r1.next?.id, 'h2'); assert.equal(r1.done, false);
    const r2 = LevelFlow.complete('h2', 2, new LevelInfo({ par: 3 }));
    assert.equal(r2.done, true);
    assert.deepEqual(r2.totals, { strokes: 6, par: 6, over: 0, levels: 2 });
    LevelFlow.complete('h1', 3, info1); // replay replaces
    assert.equal(LevelFlow.totals().strokes, 5);
    assert.equal(LevelFlow.infoOf([{ components: [info1] }]), info1);
});
test('a scene-built zone takes its numbers from the preset named by the SAVED kind (kind arrives after the constructor)', () => {
    const z = new Zone(); Object.assign(z, { kind: 'sand', zone: true });
    assert.equal(z.resolved().friction, 0.25); z.kind = 'ice'; assert.equal(z.resolved().friction, 0);
    z.friction = 0.08; assert.equal(z.resolved().friction, 0.08);               // an explicit number overrides the preset
    assert.equal(new Zone({ kind: 'boost' }).resolved().boost, 400);
});
console.log(`\n${passed} physics-material/levelflow checks passed`);
