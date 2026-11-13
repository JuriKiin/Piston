# Rendering effects

Glow, light and screen effects, all built from components you add in the Inspector and animate in the Animation panel. They are drawn by the engine's Canvas2D renderer: 8-bit colour, no shaders, and they run at 60 fps at 1920 x 1080 on a Mac with thousands of glowing sprites on screen.

## Blend modes
**SpriteRenderer**, **ParticleEmitter** and **TrailRenderer** have a **Blend mode**:

| Mode | What it does | Use it for |
|---|---|---|
| `normal` | covers what is behind | everything by default |
| `additive` | adds its colour to what is behind, so overlaps get brighter | glows, fire, sparks, lasers, light shafts |
| `screen` | like additive but never clips as harshly | soft haze, lens glows |
| `multiply` | darkens | shadows, tinted glass |

An additive sprite works best on a **dark background**, with a soft round image that is white or coloured at the centre and fades to transparent at the edge. Additive costs the same as normal drawing: use as many as you like. Do not use `shadowBlur` for glow in game code: 100 glowing objects already drop a Mac below 60 fps. A baked glow sprite plus Bloom does the same job for free.

## Hit flash
**SpriteRenderer ▸ Flash (0-1)** draws a white copy of the sprite on top. Animate it from 1 to 0 over 0.1 s with an Animator clip, or set `sprite.flash = 1` from code and let it fall.

## Particles with images
In **ParticleEmitter** set **Image** to a white soft-edged texture and the particles draw that instead of a circle, tinted by **Start color** to **End color**. Together with **Blend mode: additive**, **Drag**, **Spin**, **Random start rotation** and **Size variation** you get sparks, embers, smoke puffs and glowing dust from one component. Many emitters can share one image; the tinted copies are cached.

## Trails
**TrailRenderer** draws a ribbon behind a moving entity: each frame it remembers the entity's position (every **Min distance** pixels) for **Lifetime** seconds and fills a tapering ribbon through the points, **Start width** at the entity to **End width** at the tail, colour **Start color** to **End color**, fading out if **Fade out** is on. Call `trail.clear()` when you teleport or reuse an entity so no streak jumps across the screen.

## PostProcess: whole-screen effects
Add a **PostProcess** component to any entity (the camera's is a good home). It processes the world, then the HUD is drawn on top untouched. Everything starts off, and a PostProcess that changes nothing costs nothing.

| Field | Effect |
|---|---|
| Bloom intensity, threshold, radius | bright pixels glow. Threshold 0 blooms everything; 0.6 only the bright parts |
| Ambient light | darkens the world to this colour (`#ffffff` = no darkening). With **Light2D** components the lights brighten the dark |
| Light glow strength | how much extra additive glow each light adds on top |
| Exposure, Contrast, Saturation | colour grade (all 1 = neutral) |
| Tint color, Tint amount | soft colour wash over the whole screen |
| Vignette, Vignette color | darkened edges; animate the colour to red for a damage flash |
| Chromatic aberration (px) | red/blue fringing that grows toward the screen edge; a short pulse sells impacts |
| Flash color, Flash amount | full-screen flash; animate 1 to 0 for explosions |

Every number and colour above is animatable. Limits of the Canvas2D version: colours are 8-bit so nothing can be "brighter than white" (a light cannot overexpose a surface beyond its own colour), there are no shadows from lights, and there is no per-pixel distortion or blur-by-depth.

## Light2D
A soft round light with **Color**, **Radius** and **Intensity**, centred on its entity (plus an offset). Put one on a bullet, a torch, an explosion or an engine flame. Lights only show once a PostProcess in the scene has a dark **Ambient**; they add up where they overlap. Around 150 lights at once is fine.

## Time scale
`Piston.gameLoop.timeScale` multiplies the simulated time of every fixed step (see [Simulation, input and the entity pipeline](doc:17-simulation-and-pipeline)): `0` freezes the game for a few frames (hit-stop), `0.3` is slow motion, `1` is normal. Animators, particles, trails and anything that reads `Constants.DELTA_TIME` follow it. Rigidbody velocities are per step and are not scaled. A scene load resets it to 1.

```js
const loop = window.Piston.gameLoop;
loop.timeScale = 0;                              // hit-stop...
setTimeout(() => { loop.timeScale = 1; }, 60);   // ...for 60 ms of real time
```

## Performance notes
Measured on an Apple M4 Pro (see `docs/showcase/neon-warden/BENCHMARKS.md`): 8,000 sprites cost about 3 ms of script time, 12,000 simple particles about 3 ms, 3,000 full-size additive glows are fine. The costs that bite are `shadowBlur`, thousands of colliders without the spatial grid, and per-frame allocations in your own scripts.
