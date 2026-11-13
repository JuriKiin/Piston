# Renderer benchmarks (Phase 2)

Measured on an Apple M4 Pro (12 cores), the Claude desktop app's Chromium 152 (ANGLE/Metal GPU canvas), canvas 1920x1080, DPR 1, display locked at 60 Hz.
Harness: `bench/bench.html` (serve with `python3 -m http.server`, results land in `window.__results`) and `bench/physics-bench.mjs` (node).
Method: each case draws one 1920x1080 frame per `requestAnimationFrame` for 75 frames (first 15 discarded). We report the **rAF interval** (what the player gets;
pinned at 16.67 ms means "kept up with vsync") and the **JS time** spent issuing draw calls. A case "breaks" when the interval leaves 16.7 ms. Cases were
laddered (x2) until they broke, so the numbers below are the last passing step and the first failing step.

## Canvas2D results (this machine)

| What | Holds 60 fps up to | Breaks at | JS cost at the last good step | Verdict |
|---|---|---|---|---|
| `fillRect` | 80,000 / frame | 160,000 (30 ms) | 5.5 ms | not a limit |
| `drawImage` sprites, save/translate/rotate/restore (sheet frames 128px) | 16,000 | 32,000 (33 ms) | 13 ms | 8,000 draws = 3.4 ms JS. Plenty. |
| `drawImage` sprites with `setTransform` instead of save/restore | 16,000 | 32,000 (29 ms) | 9.8 ms | ~25 % cheaper than save/restore |
| particles as `arc()+fill()` (what `ParticleEmitter` does today) | 64,000 | not reached | 14.6 ms | 12,000 particles = 3.3 ms. Cheap. |
| particles as prebaked glow sprite, normal blend | 16,000 | 32,000 (23 ms) | 8.9 ms | |
| particles as prebaked glow sprite, **additive** (`lighter`) | 16,000 | 32,000 (23 ms) | 8.8 ms | additive blending is **free** vs normal |
| additive 64px glows | 16,000 | n/a | 8.8 ms | |
| additive 256px glows (fill-rate heavy: 65k px each) | 3,200 | 6,400 (32 ms) | 1.0 ms JS, GPU bound | 3,000 full-size lights = fine |
| **`shadowBlur` 20 on circles** | **100** | **200 (33 ms)** | 0.04 ms JS, GPU bound | **the cliff. Never use per-object shadowBlur for glow.** |
| **`shadowBlur` 20 on sprites** | **100** | **200 (29 ms)** | | same |
| `ctx.filter = 'blur(8px)'` full-screen self-copy | 32 passes | not reached | 0.4 ms | filters are surprisingly cheap on the GPU canvas |
| `ctx.filter` contrast/saturate/hue full-screen | 32 passes | not reached | 0.3 ms | free colour grading |
| full-screen opaque `drawImage` overdraw | 512 layers | not reached | | |
| bloom (scene -> 1/2 -> 1/4 -> 1/8 mip chain, blur filter, additive composite) | 12,000 scene glows | 24,000 (17.3 ms) | the bloom pass itself is **below measurement noise** (delta vs scene-only = 0.1 ms JS) | bloom is affordable |
| lightmap (1/2 res canvas, N radial lights `lighter`, then `multiply` over the scene) | 4,800 lights | not reached | 3.9 ms | dynamic lighting is affordable |
| vector path bodies redrawn every frame (gradient + 2 curves + stroke) | 12,000 | 24,000 (34 ms) | 8.9 ms | |
| same bodies from a cached bitmap | 16,000 | 32,000 (24 ms) | 9.1 ms | cache ~1.5-2x faster; not a game-changer |
| ribbon trails as one `lineTo` polyline each (30 pts) | 4,800 | not reached | 2.7 ms | |
| ribbon trails drawn as 29 alpha segments each | 2,400 | 4,800 (24 ms) | 6.2 ms | polygon/gradient ribbons win |

Notes on honesty: the interval is clamped at 16.67 ms, so a "holds" row says "at least this much headroom", not "exactly this much". GPU time is not visible to JS;
the break points (the first row where the interval degrades) are the real GPU+CPU limits. This is a very fast GPU; expect an Intel iGPU or a phone to be 3-10x
slower, so budgets in DESIGN.md are set at roughly one tenth of the measured breaking points.

## Engine-level measurements

`bench/physics-bench.mjs` runs Piston's own `SpatialGrid` + `PhysicsEngine` with N circle bodies in a 1920x1080 world:

| N bodies | `GameLoop` as shipped (grid cell = 10000 px, i.e. one cell, O(n^2)) | grid cell = 100 px |
|---|---|---|
| 100 | 0.48 ms | 0.03 ms |
| 300 | 4.1 ms | 0.13 ms |
| 600 | 16.1 ms (a whole frame) | 0.42 ms |
| 1000 | 40.8 ms | 1.0 ms |
| 2000 | 160 ms | 3.8 ms |

**Finding: `GameLoop` constructs `SpatialGrid(w, h, 10000, ...)`, so the broadphase never prunes anything.** A bullet-hell with 300 projectiles costs 4 ms a frame
just to detect collisions. This is a one-line engine fix (fixed in this branch, see PROGRESS.md) and a real finding for the gap list.

Other engine observations from reading the code (not microbenchmarked):
* `Entity.render` copies and sorts the component list and the `GameLoop` render pass filters + sorts all entities every frame (allocations per frame, O(n log n)).
* `ParticleEmitter.draw` builds a CSS colour string per particle per frame; `parseColor` runs every frame. Fine at hundreds of particles, wasteful at tens of thousands.
* Rigidbody velocities and friction are per *frame*, not per second (`Transform.update` adds `velocity` each frame), so physics speed depends on the display refresh rate. `DELTA_TIME` is clamped to 1/30.
* Simulation and rendering are one coupled `requestAnimationFrame` loop (no fixed time step, no interpolation).

## Conclusion

**Canvas2D can carry this showcase.** On a modern Mac GPU, bloom, an additive light layer, thousands of additive glow sprites and 10k+ particles all fit inside
16 ms. The real costs are *not* in the pixels:

1. `shadowBlur` (must be replaced by baked glow sprites or the bloom pass).
2. Engine CPU overhead per entity/particle (allocation, sorting, per-particle colour strings) and the O(n^2) collision broadphase.
3. Anything that needs a per-pixel shader: normal-mapped sprite lighting, real soft shadows/occlusion, refraction/distortion, dissolve/energy shaders, true HDR bloom
   (Canvas2D is 8-bit clamped so "bright" cannot exceed white), per-pixel colour grading LUTs, motion blur. These cannot be done honestly in Canvas2D.
4. Lower-end hardware: every fill-rate number above shrinks 3-10x on integrated GPUs and phones.

**A WebGL2 backend is not required for the showcase, but it is required for the games after it** (anything shader-based, anything targeting phones, anything
over ~10k draw calls on weak GPUs). Sketch of how it plugs in without breaking existing games:

* Introduce a `Renderer` service (the engine contract already lists "Render" as a platform service): `begin(camera)`, `drawSprite(image, frameRect, transform, {alpha, blend, tint})`,
  `drawShape`, `drawText`, `pushTarget/popTarget`, `end()`. The existing Canvas2D path becomes `Canvas2DRenderer`, a thin wrapper that forwards to the same ctx calls components make now.
* Components keep a `draw(ctx)` that works unchanged against the `Canvas2DRenderer` (the ctx stays reachable as `renderer.ctx`), and gain an optional `render(renderer)` fast path that
  the `WebGLRenderer` batches (texture atlas + one instanced draw per blend mode). A component with only `draw(ctx)` is rendered by blitting it to a cached canvas texture, so every
  existing plugin and sample keeps working.
* `GameLoop` picks the renderer from `project.piston.json` (`"renderer": "canvas2d" | "webgl2" | "auto"`), and the post-process stack (`PostProcess`, `Light2D`) is written against
  the `Renderer` interface so the same components get real shaders on WebGL2 and the cheap Canvas2D approximation otherwise.
* Prerequisite: the texture atlas / image pool (gap list), since batching needs few textures.

## In-game stress test (the real game, real engine)

Measured in the built Neon Warden (boss phase, player invulnerable, 1920x1080 canvas in a 1280x720 pane, M4 Pro), by wrapping `gameLoop.update` with a timer
(script time for simulation + issuing all draw calls; GPU time hides behind vsync) and sampling `requestAnimationFrame` intervals. Every orb is a full entity: sprite sheet
renderer + `Light2D` + circle trigger collider, all drawn through the bloom + lighting pipeline.

| Stationary orbs on screen | Entities | `update()` ms (avg / p95) | rAF interval ms | Verdict |
|---|---|---|---|---|
| ~50 (normal play) | ~100 | under 1 | 16.7 | |
| 500 | 539 | 3.2 / 3.5 | 16.7 | holds 60 fps |
| 1,000 | 1,043 | 6.1 / 6.4 | 16.7 | holds 60 fps |
| 2,000 | 2,047 | 17.2 / 18.2 | 17.5 | **breaks 60 fps** (this is the engine's per-entity ceiling) |
| 3,000 | 3,047 | 45.9 / 67.3 | 46 | ~22 fps |
| 4,500 | 4,547 | 115 / 152 | 115 | slideshow: cost is super-linear (collision narrowphase on a dense cloud) |

Also measured during a burst-spawn stress (16 orbs every 120 ms moving outward, plus an explosion every 0.5 s with textured additive sparks, smoke and debris):
530 orbs, 602 entities, 1,189 components, 371 particles alive: `update()` 3.3 ms avg / 4.1 p95, rAF 16.68 ms avg, p95 18.5 ms. 60 fps held.

Conclusions: the engine's per-entity cost is about 6 us (1,000 entities = 6 ms) and grows super-linearly past ~1,500 entities, so **about 1,500 simultaneous entities is the real
ceiling for a 60 fps game today** (the draw calls themselves are cheap; the cost is entity update/render bookkeeping and the collision pass). The game uses about 100-250
entities in normal play, i.e. 10-15 % of that. The bloom + lightmap pipeline costs well under 1 ms of script time and was not visible as a GPU cost at 60 Hz on this machine.
