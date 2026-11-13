# Neon Warden: progress

Branch `showcase/neon-warden`, worktree `/Users/jurikiin/Documents/GitHub/Piston-showcase`. Nothing was pushed. The main checkout was not touched.

## What exists
| Area | State |
|---|---|
| `DESIGN.md` | concept, art direction, effects, animation list, mechanics, flow, audio plan, perf budget, 29-row engine gap table |
| `BENCHMARKS.md` + `bench/` | Canvas2D micro-benchmarks, engine collision benchmark, in-game stress test |
| Engine additions (generic, tested, documented in `EditorDocs/15-rendering-effects.md`) | broadphase fix; `SpriteRenderer.blendMode/.flash`; `ParticleEmitter` texture/blend/drag/spin/size variation; `TrailRenderer`; `PostProcess` (bloom, ambient lighting, grade, tint, vignette, chromatic aberration, flash); `Light2D`; `gameLoop.timeScale` |
| `Samples/NeonWarden` | a playable game: title, intro, wave 1 (drones), wave 2 (turrets), the Warden boss (3 phases), win and lose screens, restart |
| `Tools/neon-warden` | `make_art.py` (all sprites + floor), `make_audio.py` (21 SFX + 2 music loops), `make_scenes.py`, `preview.py`, `rebuild.sh` |
| Screenshots | `shots/` (real captures from the running game in the Browser pane, plus art contact sheets) |

## Verified, and how
* `node Engine/web/tests/*.test.mjs`: all 13 files pass (new: `spatial-grid`, `trail`, `postprocess`, `rendering-effects`). These use mock canvases: they prove call sequences and maths, not pixels.
* `./Piston.app/Contents/MacOS/Piston --selftest`: first run had 2 failures (`getBounds returns screen rect for selection`, `applyPatch moves entity; bounds follow`), rerun: **ALL CHECKS PASSED** (107 checks). The two failing checks are the known timing-sensitive editor ones; I did not find a link to my changes but cannot rule out a rare race.
* The game builds (`--build`, 159 files, 9.9 MB) and runs in the Browser pane (Chromium 152, Metal GPU), with no console errors. Played and checked by simulating input events from JavaScript (key/mouse events on `window`) and reading `window.NeonWarden` state:
  * title -> click -> arena; intro message; wave 1 drones spawn, chase, telegraph, dive; bolts kill them and score/combo count up.
  * wave 2: four turrets rise, track, charge (aim line), fire amber fans. (Jumped to with `NeonWarden.director.enter('wave2'); .spawnTurrets()`.)
  * boss: spawns with shockwave rings, chain unfurls, fan attacks, shockwave rings at 66 %, laser at 33 % ("ENRAGED" shown; the laser beam itself I did not capture on screen), segments break (HP bar chip animation), head dies -> chain explosion, slow-mo, flash, "WARDEN DOWN" with results.
  * lose: five hits -> explosion, "SYSTEM FAILURE", R restarts the scene (state back to `intro`, HP 5).
  * Game was driven with a bot that aims perfectly, so **balance is untested by a human**; the boss died in about 15 s of perfect aim with the player invulnerable.
* Performance (see BENCHMARKS.md): 60 fps held with 530 orbs + explosions; 1,000 stationary orbs 6.1 ms; the engine breaks 60 fps at about 2,000 entities.

## Not verified / known gaps in the slice
* **No human playtest. Audio was synthesised but never listened to** (no ears here): levels, loop seams and the quality of the music are assumed, not checked. The code ran without audio errors.
* Not opened in the editor GUI (Inspector, Animation panel, Scene view with PostProcess). The `--selftest` editor checks passed with the new engine, the scenes use only registered components, and the editor shares the same loop, but I did not look.
* The Warden laser beam, the turret aim-line draw path and some phase transitions were exercised in code paths but I only have screenshots of the earlier phases.
* Retina/4K sharpness was not inspected on a 4K display; sprites are authored at 2x display size.
* Sprite art is good but not hand-polished: the Warden head reads a bit like a fish; baked lighting rotates with the sprite (no normal maps), sprite shadows are blobs.
* Lights cast no shadows; bloom is 8-bit (no HDR).
* The game uses the editor's Play/Stop snapshot poorly: entities spawned at runtime are not part of the edit snapshot (they are rebuilt when the scene reloads, which the game does itself).

## Run it
```bash
cd /Users/jurikiin/Documents/GitHub/Piston-showcase
./bundle.sh                                              # about a minute; already built in this worktree
./Piston.app/Contents/MacOS/Piston --build Samples/NeonWarden
./Piston.app/Contents/MacOS/Piston --serve Samples/NeonWarden/dist/web   # prints http://127.0.0.1:PORT/ ; open it in a browser
```
Or in the editor: run this worktree's app (`./Piston.app/Contents/MacOS/Piston`, directly rather than via `open`, because both apps share a bundle id), then Open Project and choose `Samples/NeonWarden`.
Controls: WASD move, mouse aim, hold mouse or J to fire, Space/Shift dash, R restart, Esc title. Debug handle in the browser console: `NeonWarden` (state, player, boss, `director.enter('wave2')`, `director.toBoss()`).
Regenerate assets: `python3 Tools/neon-warden/make_art.py && python3 Tools/neon-warden/make_audio.py && python3 Tools/neon-warden/make_scenes.py`.

## Engine gap list: recommended build order
1. **Fixed time step + dt-scaled physics + swept circles (8, M, P0).** Everything else is built on a deterministic loop; today speed depends on refresh rate.
2. **Entity pipeline performance (18, 25, 11, 29: M).** Cached sort lists, `active` flag, pooling, kinematic bodies. The ceiling is ~1,500 entities.
3. **Small P0 fixes: spawn-from-start (22), collider debug default (24), input edges (23): S each, one day total.**
4. **Joints / chains / ropes (9, L)** then **soft bodies (10, L)**: the Warden's chain is hand-rolled follow logic; a `DistanceJoint` + `RopeChain` would replace `layoutChain` and give real physical interaction.
5. **Texture atlas + sprite tint (12, 19: M+S)**, prerequisite for batching.
6. **WebGL2 `Renderer` backend (13, L)** (design in BENCHMARKS.md). Unlocks normal-mapped lights (14), shadows (15), HDR bloom, distortion, phones.
7. Text effects (26), richer particles (27), audio layering/ducking (20), camera features (28): M each, quality-of-life.
8. Tilemaps and parallax (16), skeletal animation (17): needed for other game types, not this one.
