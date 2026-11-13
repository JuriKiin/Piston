# NEON WARDEN: design

## Choice and why
Candidates were (A) a twin-stick arena shooter with a segmented boss, (B) a rope/jelly physics puzzle, (C) a one-screen side-view action slice.
**A was chosen.** It is the candidate that stresses the *renderer and effects* (what this showcase is for) the hardest while only needing the physics we
already have as trigger overlaps:

* Constant additive light sources (bolts, orbs, explosions, engine flames) make **bloom + dynamic lights** the visual centrepiece, and they are exactly the
  features the engine lacks.
* Hundreds of simultaneous projectiles and thousands of particles are the honest test of Canvas2D, the entity render loop and the collision broadphase.
* The boss is a chain of segments that wants **joints / rope / soft-body** constraints. We build the chain as game-side follow logic and record precisely
  what an engine `DistanceJoint` / `Chain` / soft-body component would replace.
* B needs a real joint solver we do not have (the slice would be mostly the missing feature, with nothing to look at); C is the least demanding on the renderer.

## Concept and fantasy
You are **SPARK**, a salvage drone dropped into the containment arena of **THE WARDEN**, a mile-long mechanical serpent that guards a dead city's power core.
Survive the drone swarm and the turret ring, then cut the Warden apart plate by plate until its head is exposed, and kill it. One arena, one fight, about
three to four minutes. Short, loud, shiny, readable.

## Art direction
* **Palette.** Void indigo `#070a1a` / `#0d1230` for the floor, gunmetal `#1b2240` and `#2a3358` for hulls. Player and friendly light: **cyan `#33e6ff`** with white-hot cores.
  Enemy and danger: **magenta `#ff2e88`** and **amber `#ffb02e`** (amber = the Warden's weak points / armor seams). Explosions: white -> amber -> magenta -> smoke.
  Rule: only things that can hurt you or can be hurt glow warm; everything else cool.
* **Lighting model.** Authored at the sprite level: every sprite is generated with baked ambient occlusion, a top-left key light, a cyan rim light and emissive seams.
  The *game level* adds dynamic light with engine components: a darkened ambient (`PostProcess.ambient`), `Light2D` on the player, every bolt, orb, explosion and
  boss seam that lights the floor and neighbours, then bloom on top. Baked light rotates with the sprite (a known cost; see gap "normal-mapped sprites").
* **Material look.** Dark anodised metal with bevelled plates, thin emissive channels, soft contact shadows (a separate un-rotated shadow sprite offset from
  each body), a faint hex-grid floor with etched circuitry, glass-like bolt cores. Everything authored at 2x display size with 4x supersampling and downscaled
  with Lanczos, so edges are anti-aliased and stay crisp when the engine scales them.
* **Typography/UI.** Thin, wide-tracked sans for HUD, a custom stroke-built logo with baked glow. HUD is minimal: player pips (top-left), boss plate bar (top-centre),
  score and time (top-right), dash charge ring around the ship (in-world).

## Effects list
Every item says what makes it and whether the engine does it today (E = needs an engine addition we make in this branch, G = game script, B = baked asset).

| Effect | Implementation |
|---|---|
| Muzzle flash (4-frame sheet, additive, + light pop) | `SpriteRenderer` additive (E: blend mode) + `Light2D` (E) |
| Player bolts with glowing streak trail | `SpriteRenderer` additive + `TrailRenderer` (E) + `Light2D` (E) |
| Hit sparks (sheet + spark particles with drag) | sheet via `SpriteRenderer`, particles via `ParticleEmitter` texture/blend/drag (E) |
| Hit flash on enemies (additive white silhouette) | `SpriteRenderer.flash` animated by `Animator` (E) |
| Hit-stop and slow-mo on kills/boss death | `gameLoop.timeScale` (E) driven from game script |
| Camera shake with trauma decay, zoom punch | G (moves the Camera entity; `Camera.zoom` animatable) |
| Shockwave rings (drone death, boss ring attack) | ring sprite scaled and faded by `Animator` clips, additive; damages via game logic |
| Explosions (16-frame sheets, small and boss) + debris + smoke + embers | sheets, `ParticleEmitter` bursts (textured, additive and normal) |
| Engine flame (6-frame loop that scales with speed) and exhaust particles | `SpriteAnimator` + continuous `ParticleEmitter` |
| Dash afterimages and speed streak | `TrailRenderer` + fading ghost sprites |
| Boss chain: segments follow the head with spring lag, armor plates crack, seams glow brighter as HP drops | G (chain follow); 4-frame damage sheet; `Light2D` per seam |
| Turret charge telegraph (growing laser line + charge glow), recoil | `SpriteAnimator` clips + stretched additive sprite + `Animator` |
| Boss laser sweep (long additive beam with core, light along the beam) | stretched sprite segments + `Light2D` |
| Bloom, vignette, colour grade, chromatic aberration pulse on damage, full-screen flash | `PostProcess` (E), fields animated from game script |
| Ambient darkness + dynamic floor light, additive floor pulse ring that travels along the arena edge | `PostProcess.ambient` + `Light2D` (E); animated ring via `Animator` |
| Drifting data-dust / embers in the background | continuous `ParticleEmitter` |
| Title screen: logo shimmer, floor sweep, drifting ship | scene with `Animator` tracks and `ParticleEmitter` |
| Win: chain-reaction explosions along the corpse, slow-mo, white flash, score count-up | G + the effects above |
| Lose: ship disintegrates, red vignette, "system failure" | G + `PostProcess` |

## Animation list (every thing and its states)
| Thing | Sprite sheet / clips | Property animation (`Animator`) |
|---|---|---|
| Spark (player) | body (1 frame); `flame` 6-frame loop; shield ring | spawn pop (scale backOut), dash squash, hit flash, death |
| Drone (enemy 1) | `spin` 8-frame loop | spawn warp-in (scale+glow), windup pulse before dive, hit flash |
| Turret (enemy 2) | base (static), head sheet: `idle`, `charge` (4), `fire` (2), `hurt` | rise-from-floor, recoil, hit flash, destruction |
| Warden head (boss) | `idle`, `snarl`, `damaged`, `critical` | roar scale pulse, hit flash, death |
| Warden segment | 4 frames: intact, plate-cracked, core-exposed, wreck | pulse glow, hit flash, break |
| Warden tail core | 8-frame pulse | enrage speed-up |
| Player bolt | 1 frame streak | none (trail does the work) |
| Enemy orb / boss orb | 4-frame pulse | spawn pop |
| Explosion small / big | 16-frame sheets | scale/alpha curves on companion light |
| Muzzle / hit spark | 4 / 6 frames | n/a |
| Shockwave ring | single ring | scale 0.1 -> 1 easeOut, alpha 1 -> 0 |
| HUD | pips, boss bar fill, logo | pip pop/shake on damage, bar chip animation, title pulse |

## Mechanics
* **Controls.** WASD/arrows move, mouse aims, hold left mouse (or J) to fire, Space/Shift dashes (0.18 s, i-frames, 0.9 s cooldown), R restarts, Enter/click starts.
* **Player.** 5 HP pips, 0.9 s of invulnerability after a hit, fire rate 12 shots/s from alternating barrels, 1500 px/s bolts, slight spread.
* **Drone.** 2 HP. Orbits at range, telegraphs (pulses and brightens 0.5 s), dives at the player. Contact = 1 damage and a small shockwave when it dies.
* **Turret.** 12 HP, four fixed on the arena rim. Rise, charge for 1.1 s (growing aim line), fire a three-orb fan, recoil, repeat. Shots are slow enough to dodge.
* **The Warden.** Head + 10 segments + tail core on a lissajous orbit with spring-lag chain follow. Segments have 5 HP and fire radial orb bursts when pulsing.
  Destroying a segment shocks the chain (breaks the pattern, chain-explodes the next one at low HP) and speeds the head up. Head: 40 HP.
  Phase 1 (100-66 %): aimed fans. Phase 2 (66-33 %): expanding ring shockwaves (jump them with a dash) + faster chain. Phase 3 (below 33 %): sweeping laser beam, enrage.
* **Scoring.** Kills give points with a combo multiplier that decays; final time and score on the result screen.

## Level layout and flow
Single circular arena, radius 470 px centred at (960, 540) in a 1920x1080 frame, floor art baked; hex-grid, rim channels, four turret bays at 45/135/225/315 degrees.

`title` scene (logo, "press Enter / click", drifting dust, ship idles) -> `arena` scene:
1. **Intro** (3 s): lights power on, "WARDEN ONLINE", player drops in with pop animation.
2. **Wave 1** (about 25 s): drones in groups of 4-8 from the rim, escalating to ~20 live.
3. **Wave 2** (about 30 s): the four turrets rise; drones keep spawning at a low rate.
4. **Boss**: turrets sink, the Warden bursts out of the floor with a shockwave and a boss bar appears. Music switches to the intense loop.
5. **Win**: slow-mo chain explosion, white flash, "WARDEN DOWN", score count-up, press R / click to play again (scene restart).
   **Lose** (0 HP): ship explosion, "SYSTEM FAILURE", press R / click to retry (restarts the arena scene, back to the title with Esc).

## Audio plan (all synthesised by `Tools/neon-warden/make_audio.py`, no recordings)
SFX: bolt fire (3 pitch variants), bolt impact, enemy hit tick, drone windup chirp, drone/segment explosion, big explosion, turret charge whine (rising), turret shot,
shockwave sweep, boss roar (low growl), segment break crunch, dash whoosh, player hurt, low-HP alarm, UI click, win jingle, lose sting, boss alarm.
Music: two seamless loops, 128 BPM dark synthwave in A minor (8 bars): "calm" (bass pulse, pad, hat) for the waves and "boss" (adds kick, snare, arpeggio, lead).
Buses: `music` ducked briefly on big explosions by the game script; `sfx` and `ui` as standard.

## Performance budget: 60 fps at 1920x1080
Targets are about one tenth of the measured Canvas2D breaking points (BENCHMARKS.md), to leave room for weaker GPUs and the engine's own overhead.

| Item | Budget (simultaneous) | Notes |
|---|---|---|
| Entities rendered | 600 | bolts 60, enemy orbs 120, drones 25, boss 13, turrets 4, fx 150, HUD 30 |
| Sprite draws | 800 | |
| Particles | 3,000 | textured, mostly additive |
| Additive glow draws | 400 | |
| `Light2D` | 150 | lightmap at half resolution |
| Colliders | 350 | needs the broadphase grid fix; below that the engine cannot hold 350 |
| `shadowBlur` | 0 | forbidden: glow is baked sprites + bloom |
| Frame time | game script <= 3 ms, engine update+render <= 8 ms JS | measured in PROGRESS.md |

## ENGINE GAPS
Effort: S = under a day, M = a few days, L = a week or more. Priority: P0 blocks games like this, P1 big quality win, P2 nice to have.
"Built" means implemented in this branch (generic, tested, documented, Inspector-declared); "Game-side" means the showcase works around it with a script.

| # | Gap | Why the game needs it | Proposed API | Effort | Priority | State in this branch |
|---|---|---|---|---|---|---|
| 1 | Collision broadphase is O(n^2) (`GameLoop` grid cell = 10000) | hundreds of bolts/orbs | cell size 128 | S | P0 | **Fixed** |
| 2 | Blend modes + sprite flash | additive glows, hit flash | `SpriteRenderer.blendMode`, `.flash` | S | P0 | **Built** |
| 3 | Textured, blendable, spinning, draggy particles | sparks, smoke, embers, glows | `ParticleEmitter.imagePath/blendMode/drag/spin` | M | P0 | **Built** |
| 4 | Post-processing stack | bloom, vignette, grade, chromatic aberration, flash | `PostProcess` component | M | P0 | **Built** (Canvas2D approximation) |
| 5 | 2D dynamic lights | lit floor from bolts/explosions | `Light2D`, `PostProcess.ambient` | M | P0 | **Built** (additive lightmap, no shadows) |
| 6 | Trail renderer | bolt and dash streaks | `TrailRenderer` | S-M | P1 | **Built** |
| 7 | Time scale | hit-stop, slow-mo | `Piston.gameLoop.timeScale` | S | P1 | **Built** |
| 8 | Physics is per-frame, not per-second; no fixed time step; no CCD | speed varies with refresh rate; fast bolts can tunnel | fixed-step accumulator + dt-scaled rigidbody + swept circles | M | P0 | Documented; game moves bodies itself |
| 9 | Joints / chains / ropes | the Warden's body | `DistanceJoint`, `RopeChain`, `SpringJoint` | L | P1 | Game-side chain follow |
| 10 | Soft bodies | jelly boss segments, squishy pickups | verlet soft-body component | L | P2 | Documented only |
| 11 | Object pooling | bolts/fx spawn and die constantly (GC hitches) | `Pool` service + `entity.recycle()` | M | P1 | Game-side pool |
| 12 | Texture atlas packing | many small textures, batching | build-step atlas + `SpriteRenderer.atlasFrame` | M | P1 | Not built |
| 13 | WebGL2 renderer backend | shaders, real HDR bloom, normal-mapped lights, phones | `Renderer` service (see BENCHMARKS.md) | L | P1 (P0 for mobile) | Designed only |
| 14 | Normal-mapped / rotation-aware sprite lighting | baked light rotates with sprites | `SpriteRenderer.normalMap` + shader lights | L | P2 | Needs 13 |
| 15 | Light occlusion / soft shadows | walls and bodies casting shadows | `ShadowCaster` + shadow-map lights | L | P2 | Needs 13 |
| 16 | Tilemaps and parallax layers | bigger levels | `Tilemap`, `ParallaxLayer` | M each | P1 | Not needed for one arena |
| 17 | Skeletal / bone animation | richer characters than frame sheets | `Skeleton` + editor | L | P2 | Not built |
| 18 | Entity render loop allocates per frame | filter+sort per frame, per-entity component copy | cached sorted lists, dirty flags | M | P1 | Measured, documented |
| 19 | Sprite tint / colour multiply | team colours, damage colours | `SpriteRenderer.tint` | S | P1 | Use baked variants |
| 20 | Audio: music layering, looping with loop points, bus ducking, reverb | boss music switch, ducking | `audio.crossfade`, `setBusDuck` | S-M | P1 | Game-side |
| 21 | Editor: no way to author Light2D/PostProcess gizmos or preview lights in Scene view | | Scene view renders post stack | M | P2 | Works for free (same loop), untested in editor |
