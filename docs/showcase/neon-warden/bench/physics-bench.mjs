// Run: node docs/showcase/neon-warden/bench/physics-bench.mjs
// Measures Piston's own collision pipeline (SpatialGrid + PhysicsEngine) with N circle bodies in a 1920x1080 arena.
import { SpatialGrid } from '../../../../Engine/web/Physics/Colliders/SpacialGrid.js';
import { PhysicsEngine } from '../../../../Engine/web/Physics/PhysicsEngine.js';
import { CircleCollider } from '../../../../Engine/web/Physics/Colliders/CircleCollider.js';
import { Rigidbody } from '../../../../Engine/web/Physics/Rigidbody.js';
import { Transform } from '../../../../Engine/web/Transform.js';
import { Vector2 } from '../../../../Engine/web/Physics/Vector2.js';
import Constants from '../../../../Engine/web/static/Constants.js';

let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function run(n, { trigger, radius = 10, cellSize = 100 }) {
    const ents = [];
    for (let i = 0; i < n; i++) {
        const e = { tag: 'b', id: String(i), transform: new Transform(new Vector2(rnd() * 1920, rnd() * 1080), 0, new Vector2(radius * 2, radius * 2)), components: [], getComponent() {} };
        const rb = new Rigidbody(new Vector2((rnd() - .5) * 6, (rnd() - .5) * 6), 0, false, 1);
        rb.collider = new CircleCollider(e, radius); rb.collider.isTrigger = trigger; e.rigidbody = rb; ents.push(e);
    }
    const grid = new SpatialGrid(1920, 1080, cellSize, false, null), phys = new PhysicsEngine(grid);
    Constants.DELTA_TIME = 1 / 60;
    const times = [];
    for (let f = 0; f < 60; f++) {
        const t0 = performance.now();
        grid.update(ents);
        for (const e of ents) { e.rigidbody.update(e.transform); e.transform.update(e.rigidbody); }
        phys.handleCollisions(ents);
        for (const e of ents) e.rigidbody.updateRestState();
        if (f >= 10) times.push(performance.now() - t0);
    }
    return times.reduce((a, b) => a + b, 0) / times.length;
}
// GameLoop constructs its grid with cellSize 10000 (one cell for the whole world = brute force O(n^2)); 100 is what a tuned grid would use.
for (const cellSize of [10000, 100]) for (const trigger of [true, false]) for (const n of [100, 300, 600, 1000, 2000]) {
    try { console.log(`cell=${cellSize} ${trigger ? 'trigger' : 'solid  '} circles n=${n}: ${run(n, { trigger, cellSize }).toFixed(2)} ms/step`); } catch (e) { console.log('error', n, e.message); break; }
}
