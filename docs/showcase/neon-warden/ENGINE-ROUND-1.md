# Engine round 1

Branch `engine/round-1` (from `main` at the Neon Warden merge). Nothing pushed. Guides: `EditorDocs/17-simulation-and-pipeline.md` (new) and `15-rendering-effects.md` (BeamRenderer). Node tests: `Engine/web/tests` (new files: `fixed-step`, `p0-fixes`, `beam`, `entity-pool`, `joints`; shared `_harness.mjs` gives a headless `GameLoop`).

## What shipped
| # | Item | Gap row | Notes |
|---|---|---|---|
| 1 | **Fixed timestep** | 8 | `GameLoop` simulates in fixed steps (default 60/s, `loop.fixedHz`, ctor option `fixedHz`) from an accumulator (`FixedStep.js`). `DELTA_TIME` = step x `timeScale`. Rigidbody velocities stay per step, so Mini Golf-style "pixels per frame" values behave as before at 60 Hz. Editor Step runs `loop.stepOnce()`: exactly one step. Frame times within 5 % of a whole number of steps are snapped (a jittery 60 Hz display never runs 0 or 2 steps). Catch-up after a hitch is limited by measured step cost (at most 5 steps, 1 when a step costs as much as a step is long), so heavy scenes slow down instead of spiralling. Input edges clear after every step. |
| 2 | **P0 fixes** | 22, 23, 24 | Entities pushed to the loop from `start()` survive a scene load (`GameLoop.replaceEntitiesFromData`, also used by the editor's Game view). `Debug.showColliders` defaults false (the editor's Game view and the legacy dev toolbar turn it on). `Input.wasPressed/wasReleased/wasMousePressed/wasMouseReleased`, `getKeyDown`/`isMouseButtonPressed` also true for a tap between steps, `InputController.wasActionPressed`. NeonWarden: own key listener (`Taps`) and the `showColliders = false` lines removed; Director/Title spawn from `start()`. |
| 3 | **BeamRenderer** | (new) | `length-angle` or `from-to`, width, texture or colour gradient, blend mode, glow halo, opacity; animatable fields declared in the schema. NeonWarden boss laser (aim line + beam) and turret aim line use it; their hand-drawn `draw(ctx)` code is gone. |
| 4 | **`active` flag + `EntityPool`** | 11, 25 | Inactive entities skip update, drawing, collision and the spatial grid. `EntityPool` (`create`, `onAcquire`, `onRelease`, `prewarm`, `max`; `destroy()` and `lifetime` return a pooled entity; the pool resets when the scene is rebuilt, via `GameLoop.generation`). Bolts, orbs and particle bursts in NeonWarden are pooled. |
| 5 | **DistanceJoint, RopeChain** | 9 | Position-based distance constraints (`Physics/DistanceConstraint.js`), solved once per step after entity updates and before collisions in entity order, so deterministic (test: identical positions across runs). **Warden chain ported** (below). |
| extra | NaN guards | | A canvas with no layout box no longer makes the mouse position NaN, and a trail with a NaN position no longer throws out of the frame loop (found when the pooled bolts logged this in the Browser pane). |

## Numbers (item 4)
Method: `bench/stress-ingame.js`, the BENCHMARKS.md in-game stress test, same machine and Browser pane (Apple M4 Pro, Chromium 152, 1920x1080 canvas in a 1206x577 pane, 60 Hz), boss phase, player invulnerable. "Before" = the `main` engine and sample (the base commit, built and served the same way); "after" = this branch. One run each; run-to-run noise is at least +-0.5 ms.

| Case | Before (main) | After (this branch) |
|---|---|---|
| Spawn 500 orbs in one frame, cold (first batch) | 1.7 ms | 1.1 ms |
| Spawn 500 orbs again (recycled / rebuilt) | 0.7 ms | 0.4 ms |
| Burst stress (16 orbs / 120 ms + explosion / 0.5 s, 10 s): `update()` avg / p95 / max | 2.45 / 2.9 / 6.5 ms | 1.9 / 2.6 / 4.7 ms |
| same: rAF interval avg / p95 / max | 16.67 / 17.5 / 17.7 ms | 16.68 / 17.5 / 17.7 ms |
| same: entities at the end | 423 | 361 |
| same: JS heap delta over the run | +4.0 MB | -8.3 MB |
| 500 stationary orbs: `update()` avg | 3.48 ms | 2.92 ms |
| 1,000 stationary orbs | 7.35 ms | 7.02 ms |
| 2,000 stationary orbs | 19.3 ms (rAF 19.4) | 20.8 ms (rAF 20.8) |

Reading it honestly: pooling cuts construction and removes most per-shot garbage (a 0.4 ms saving on a 500-orb burst, lower and steadier heap), but the game was never allocation-bound at its normal 100-250 entities, so no frame-rate change is visible at 60 Hz. **Per-entity update cost did not change** (the 2,000-orb row is slightly worse: the fixed-step bookkeeping and the extra `active` checks cost about 1.5 ms there). A first version of the loop allowed up to 5 catch-up steps and fell to 83 ms per frame at 2,000 entities; the step-cost limit fixed that and is the reason it is there. Cached sort lists (gap row 18) and `rigidbody.kinematic` (row 29) were not part of this round.

## Warden chain port (item 5)
Done: the head is the pinned first link of a `RopeChain` (segment length 98, rope mode, 8 iterations); the 11 body segments are the other links. The path-history `layoutChain` is deleted. In rope mode the segments start stacked on the head and unfurl as it moves away, as before. A destroyed segment drops out of the chain and the rest close up on the next step. Differences to expect: the segments now trail the head by distance constraints instead of walking its recorded path, so they cut corners on the figure-eight tighter than before and swing a little. The mechanics tested are only numeric (constraint accuracy, determinism, unfurl); the Warden fight ran headless with the bot (BALANCE.md) with the chain in place and no errors, but **nobody looked at the chain move**.

## Balance pass (extra request A) and title controls (B), Swift sample (C)
See `BALANCE.md`. Title screen: the control sentence is replaced by keycap, mouse and dash glyphs in the lower-left (`icon_move/aim/dash.png` from `make_art.py`); Esc and R behaviour unchanged. Neon Warden is a second built-in sample (Hub button "Open Sample: Neon Warden", same `openSample` code path and `sampleRevision` logic as Mini Golf, so an existing copy is never overwritten; `bundle.sh` no longer ships a sample's local `dist/`).

## What I could NOT verify
* **No human played anything.** Feel, readability of the new telegraphs, whether the Warden chain looks right, and the balance numbers (bot only) are unchecked by a person. The audio was not listened to.
* Visual output was checked only through one title-screen screenshot in the small Browser pane and absence of console errors; the beam, laser, turret telegraph and chain were exercised in headless fast-forward (rendering off), not looked at.
* The editor GUI beyond `--selftest` (Inspector showing the new components' fields, the Hub button) was not clicked through.
* Retina/other refresh rates: the fixed step was tested with simulated 30-240 Hz frame schedules in Node and at 60 Hz in the browser; not on a 120 Hz ProMotion display.
* The Scene view (edit mode) builds scenes without running `start()`-spawned entities, by design; I did not check that NeonWarden's Director `start()` is harmless there beyond `--selftest` opening the scene.

## What is left
* Swept (continuous) collision for fast bolts; per-second physics units (round 1 keeps per-step velocities).
* `rigidbody.kinematic` and cached sorted render lists (gap rows 29, 18): per-entity cost is unchanged.
* `fixedHz` from `project.piston.json` and an Inspector/Project setting (it is a script property today).
* Joints: hinge/angle limits, anchor offsets, SpringJoint, soft bodies (row 10); the chain's collision with the world.
* BeamRenderer: curved beams, end caps, hit-test helper against colliders.
* Sample controls glyphs and the boss pattern numbers should be tuned by an actual player.
