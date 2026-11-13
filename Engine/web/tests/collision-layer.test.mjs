// Run: node Engine/web/tests/collision-layer.test.mjs   (no browser needed)
import assert from 'node:assert/strict';
import { CollisionLayerComponent } from '../CollisionLayerComponent.js';
import { Layers, CollisionMatrix } from '../Physics/CollisionMatrix.js';
import { ComponentRegistry } from '../ComponentRegistry.js';

const entity = () => ({ rigidbody: { collider: { layer: Layers.Default } }, components: [] });
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('PASS', name); };

test('registered, with layer and ignores fields', () => {
    assert.ok(ComponentRegistry.get('CollisionLayer')); assert.deepEqual(CollisionLayerComponent.fields.map(f => f.key), ['layer', 'ignores']);
});
test('a scene-built component applies the SAVED layer (fields arrive after start), once, on the first update', () => {
    const e = entity(); const c = new CollisionLayerComponent(); c.entity = e; c.start();
    assert.equal(e.rigidbody.collider.layer, Layers.Default);             // start() must not lock in the defaults
    Object.assign(c, { layer: 'Wall', ignores: 'Enemy, Pickup' });         // SceneIO applies the saved fields
    c.update(); assert.equal(e.rigidbody.collider.layer, Layers.Wall);
    assert.equal(CollisionMatrix.shouldCollide(Layers.Wall, Layers.Enemy), false); assert.equal(CollisionMatrix.shouldCollide(Layers.Wall, Layers.Pickup), false);
    assert.equal(CollisionMatrix.shouldCollide(Layers.Wall, Layers.Player), true);
});
test('unknown layer names are ignored, and Stop → Play applies again', () => {
    const e = entity(); const c = new CollisionLayerComponent({ layer: 'Nope' }); c.entity = e; c.update(); assert.equal(e.rigidbody.collider.layer, Layers.Default);
    c.layer = 'Player'; c.restoreState(); c.update(); assert.equal(e.rigidbody.collider.layer, Layers.Player);
    CollisionMatrix.ignore(Layers.Wall, Layers.Enemy, false); CollisionMatrix.ignore(Layers.Wall, Layers.Pickup, false);
});
console.log(`\n${passed} passed`);
