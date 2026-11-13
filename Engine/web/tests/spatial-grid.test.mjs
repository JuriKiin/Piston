// Run: node Engine/web/tests/spatial-grid.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SpatialGrid } from '../Physics/Colliders/SpacialGrid.js';
import { CircleCollider } from '../Physics/Colliders/CircleCollider.js';
import { Rigidbody } from '../Physics/Rigidbody.js';
import { Transform } from '../Transform.js';
import { Vector2 } from '../Physics/Vector2.js';

const body = (x, y, r = 10) => { const e = { id: `${x},${y}`, transform: new Transform(new Vector2(x, y), 0, new Vector2(r * 2, r * 2)), components: [] };
    e.rigidbody = new Rigidbody(new Vector2(0, 0), 0, false, 1); e.rigidbody.collider = new CircleCollider(e, r); return e; };
let passed = 0; const test = (n, f) => { f(); passed++; console.log('PASS', n); };

test('with small cells a body only sees its neighbours', () => {
    const g = new SpatialGrid(1920, 1080, 128, false, null);
    const a = body(100, 100), b = body(110, 100), far = body(1500, 900);
    g.update([a, b, far]);
    const near = g.getNearby(a);
    assert.ok(near.includes(b)); assert.ok(!near.includes(far));
});
test('inverse (containment) colliders are always nearby', () => {
    const g = new SpatialGrid(1920, 1080, 128, false, null);
    const a = body(100, 100), wall = body(1500, 900, 50); wall.rigidbody.collider.isInverse = true;
    g.update([a, wall]);
    assert.ok(g.getNearby(a).includes(wall));
});
test('GameLoop builds its broadphase with small cells and no always-on debug drawing', () => {
    const src = readFileSync(new URL('../GameLoop.js', import.meta.url), 'utf8');
    const m = /new SpatialGrid\(canvas\.width, canvas\.height, (\d+), (true|false)/.exec(src);
    assert.ok(m, 'SpatialGrid construction not found');
    assert.ok(Number(m[1]) <= 256, `cell size ${m[1]} is too large for a useful broadphase`);
    assert.equal(m[2], 'false');
});
console.log(`${passed} passed`);
