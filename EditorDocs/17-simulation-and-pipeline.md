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
