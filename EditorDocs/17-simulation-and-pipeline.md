# Simulation, input and the entity pipeline

How the game loop advances time, what input edges are, and the tools for lots of short-lived entities. Everything here is generic engine infrastructure; game feel (camera follow, shake, hit-stop policy) stays in your game scripts.

## Fixed time step
The simulation runs in **fixed steps**, 60 per second by default, no matter how fast the display refreshes. A 144 Hz monitor draws about 2.4 frames per step, a 30 Hz one runs 2 steps per frame, and the game plays at the same speed on both. Drawing still happens once per display frame (there is no interpolation, so a 120 Hz display shows each simulated state twice).

```js
const loop = window.Piston.gameLoop;
loop.fixedHz = 120;        // steps per second (default 60). Set it once at startup.
loop.fixedDelta;           // length of one step in seconds (1 / fixedHz)
loop.simSteps;             // steps run while playing
```

Inside a step, `Constants.DELTA_TIME` is `fixedDelta * timeScale` (see Time scale in [Rendering effects](doc:15-rendering-effects)), so scripts that scale by `DELTA_TIME` need no changes. **Rigidbody velocities stay per step**: a velocity of `3` moves the body 3 pixels every step, which at the default 60 Hz is exactly what "pixels per frame" meant before (the Mini Golf sample plays the same). If you raise `fixedHz`, divide per-step velocities and friction accordingly.

A long stall (switching tabs, a breakpoint) runs at most 5 steps and drops the rest, so the game never tries to catch up.

**Pause and Step.** While paused or editing no steps run. **Step** (⌘') advances exactly one fixed step (1/60 s by default), whatever `timeScale` is, then redraws. From code: `loop.stepOnce()`.

## Entities spawned from `start()`
An entity may create more entities in its own `start()` (`loop.entities.push(child)`, `loop.add(child)`). They are kept and added after the entities of the scene file. (Before, they were silently dropped when the scene finished loading, which forced scripts to postpone their setup to the first `update()`.) The editor's Scene view builds the scene the same way it always did and ignores such entities, so they only appear when the game runs.

## Debug collider outlines
`Debug.showColliders` is **off** by default, so a built game never draws collision shapes. The editor turns it on in its Game view; the Scene view's **Show colliders** toggle is unchanged. In your own tooling set `Debug.showColliders = true`.

## Input edges
Held-key state alone misses a quick tap: if a key goes down and up between two steps, `getKeyDown` used to never see it. Input now records **edges** as the events happen and keeps them until the next simulation step ends:

```js
import input from '@piston/static/Input.js';

input.getKeyDown('Space');        // held, or tapped since the last step
input.wasPressed('Space');        // true for exactly one step after the key went down (not on key repeat)
input.wasReleased('Space');       // true for exactly one step after it came up
input.isMouseButtonPressed(0);    // held, or clicked since the last step
input.wasMousePressed(0);         // one step, per button (0 left, 1 middle, 2 right)
input.wasMouseReleased(0);
```

`InputController.wasActionPressed('fire')` does the same for a named action. With a fixed step, a press that arrives while two steps run in one frame is seen by the first step only, so an action never fires twice.

Catch-up after a hitch is limited by cost: the loop allows as many extra steps as fit in one step's length of real time (at most 5). A very heavy scene therefore slows down rather than spiralling into ever longer frames.

## Active flag
`entity.active = false` switches an entity off without removing it: no `update()`, no drawing, no collisions (it is also left out of the spatial grid), and `lifetime` stops counting. Set it back to `true` to resume. It is not saved in scene files, and Stop restores whatever it was when you pressed Play.

## EntityPool
Bullets, sparks and damage numbers appear and disappear constantly; building each one (components, collider) and throwing it away makes garbage. An **EntityPool** builds each entity once and recycles it.

```js
import { EntityPool } from '@piston/EntityPool.js';

const bullets = new EntityPool({
    create: () => new Bullet(),                              // neutral entity; the pool calls start() and adds it to the scene
    onAcquire: (b, x, y, angle) => b.launch(x, y, angle),    // runs on EVERY use, new or recycled
    onRelease: (b) => {},                                    // optional
    prewarm: 20, max: 200,                                   // optional
});
const b = bullets.acquire(x, y, angle);   // null when `max` are live
b.destroy();                              // for a pooled entity this returns it to the pool (so does running out of `lifetime`)
```
Rules: put all per-use setup in `onAcquire` (position, velocity, lifetime, `trail.clear()`), never rely on the constructor; a pool belongs to one scene and forgets its entities when the scene is rebuilt; an entity returned during a collision pass is skipped for the rest of that step, but a callback already running can still see it, so check `other.active` if it matters. `pool.dispose()` really destroys everything.

Measured on Neon Warden (see `docs/showcase/neon-warden/ENGINE-ROUND-1.md`): the pool removes per-shot construction cost and allocation; the per-entity update cost is unchanged, and a switched-off entity costs a flag check per frame.

## Joints and chains
Joints keep entities a set distance apart. They are solved once per simulation step, after every entity has moved and before collisions, so a scene with joints plays back identically every run.

**DistanceJoint** (add it in the Inspector, or `entity.addComponent(new DistanceJoint({ length: 120 }))`) keeps its entity `length` pixels from another entity or a fixed point. A reference cannot be an Inspector field, so give it the other entity from a script: `joint.target = other;` or leave `target` empty and set **Anchor X/Y** (a world point, e.g. the pivot of a pendulum).

| Field | Effect |
|---|---|
| Length | rest distance. `joint.useCurrentLength()` copies the present distance |
| Stiffness (0-1) | share of the error removed per pass; 1 is rigid, lower is springy |
| Damping (0-1) | removes relative speed along the joint |
| Rope | only pulls when stretched; slack is allowed (a rope), off means a rod |
| Pin this entity | the joint never moves this entity |
| Iterations | passes per step; more is stiffer when several joints share a body |

**RopeChain** joins a list of entities end to end: `chain.setLinks([head, a, b, c])`. Fields: **Segment length**, **Stiffness**, **Iterations**, **Damping**, **Rope**, **Pin first link**, and **Draw line** (strokes a polyline through the links, with **Line width** and **Line color**). Links are normal entities: give them sprites and colliders. A destroyed or switched-off link is skipped and the chain closes up. With **Rope** on, links stacked on one point unfurl as the head moves away.

Which bodies move: an entity **without a Rigidbody** (moved by your script), a **static** Rigidbody, or a pinned entity is never moved by a joint. Any other Rigidbody is moved in proportion to its inverse mass and keeps the correction as velocity, so hanging chains swing. Rigidbody velocities are per step, so gravity on a dynamic link is a per-step value too. The joints are centre-to-centre (no rotation, no anchor offsets) and distance-only: there is no angular limit or hinge.
