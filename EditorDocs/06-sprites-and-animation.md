# Sprites and animation

## SpriteRenderer
Draws an image. Set **Image Path** by typing, with the folder button, or by dragging an image from the Project panel onto the field. With Frame Width and Frame Height at 0 the whole image is drawn, scaled to the entity's size.

## Sprite sheets
A sprite sheet is one image holding many equally sized frames. Click **Sprite Sheet…** in the SpriteRenderer section to open the editor:

1. **Set cell size:** click the bottom-right corner of the first frame, or type Cell Width and Height. **Auto-detect** guesses from the image.
2. **Columns** and **Frame Count** are guessed from the image size and stay editable.
3. Frames are numbered left to right, top to bottom, starting at 0.

## Animation clips
In the same editor, add **clips**: a name, a frame range (first to last, inclusive), frames per second, and loop. Choose **Pick frames** and drag across frames to set a clip's range. The preview plays the selected clip. **Apply** writes the grid to the SpriteRenderer and the clips to a **SpriteAnimator** component (added for you).

## Playing clips from code
```js
const anim = entity.getComponent(SpriteAnimator);
anim.play('run');                       // does nothing if 'run' is already playing
anim.play('hit', { restart: true });
anim.stop();
anim.isPlaying;  anim.current;
```
A non-looping clip stops on its last frame and calls `entity.onAnimationFinished(name)` if the entity defines it. SpriteAnimator takes over the frame, so the renderer's own looping is switched off.

## Animating properties (the Animation panel)

`SpriteAnimator` plays frames from a sprite sheet. To animate *anything else* (position, rotation, size, colors, any number field) use the **Animator** component and the **Animation** tab in the panel under the viewport (next to Console).

1. Select an entity and open the **Animation** tab. Click **Add Animator** if it has none, then **New Animation**.
2. **+ Track** picks what to animate: Transform position/rotation/size, or any number or color field on the entity's components (e.g. `ShapeRenderer / Color`). Each track starts with a key holding the current value.
3. Move the playhead (drag the ruler) and click the ◇ on a track to add a key there. It starts with the value the curve already has, so nothing jumps. Click a key to edit its **time**, **value** and **easing**. Drag a key to move it. The easing on a key shapes the move *to the next key*.
4. Press ▶ to preview in the Scene view. Previewing never changes your scene: stop, or touch the entity, and it snaps back to its real values.
5. **Event** adds a flag at the playhead. When the playhead passes it, the entity's `onAnimationEvent(name, clipName)` is called, handy for sounds and spawning.

Length, **Loop** and the clip name sit in the header.

### Where animations are stored
- **In the scene (default).** The clips are part of the Animator component, saved in the scene file with the entity. Undo, Save and prefabs all work. Removing the Animator removes the clips.
- **In a file.** Open the **In scene** menu in the Animation header ▸ **Save Animations to File…**. The clips move to `assets/animations/<name>.anim.json` and the Animator's **Animation file** field points at it. Any other entity can use the same file (the empty state has **Use Animation File…**, or set the field in the Inspector), and removing the Animator keeps the file. Edits in the panel write the file immediately (they are not part of scene Undo or Save). **Stop Using File** copies the clips back into the scene.

A `.anim.json` is plain JSON (`{ "clips": [...] }`) and opens in the code editor. It ships in builds because the scene references it.

From code:

```js
const anim = entity.getComponent(Animator);
anim.play('bounce');            // starts a clip; calling it again while it runs does nothing
anim.play('bounce', { restart: true });
anim.stop();
// on the entity:
onAnimationEvent(name, clip) { if (name === 'footstep') audio.play('step.wav'); }
onAnimationFinished(clip) { /* a non-looping clip ended */ }
```

Easings: `linear`, `step` (hold until the next key), `easeIn`, `easeOut`, `easeInOut`, `cubicIn`, `cubicOut`, `cubicInOut`, `backOut`, `bounceOut`. Color tracks blend each channel.

## Painting sprites

Open any `.png` in the Project panel to paint it, or right-click a folder ▸ **New Sprite…** to make a blank one (for a sheet, make it N frames wide: four 32×32 frames is 128 × 32).

Tools: pencil, eraser, fill, color picker, line, rectangle (with a **Fill** option), a brush size, a color picker with transparency and your recent colors. Set **Frame** to your frame size to draw the frame grid over the image. Undo/Redo (⌘Z / ⇧⌘Z) work per stroke. The image saves when you close the tab or press ⌃⌘S, and the Scene view reloads it.

## Triggered animations

An Animator doesn't have to start on its own. Untick **Play on start** (and leave **Default clip** empty) and the clips wait for your code:

```js
const animator = entity.getComponent(Animator);
animator.play('hit');                       // start a clip
await animator.playAsync('sink');           // start it and wait until it has finished (never resolves for a looping clip)
```

The Mini Golf ball does this: its Animator has `sink`, `tunnelIn` and `tunnelOut` clips that scale it down and back up, and the game code just plays them at the right moment and waits for them. Because the motion lives in the clip, you tune it in the Animation panel instead of in code. Use **events** on a clip to call back into the entity at an exact moment (`onAnimationEvent`).

## Particles

Add a **ParticleEmitter** to any entity for dust, sparks, smoke or confetti.

- **Continuous:** tick **Emitting** and set **Rate**.
- **Bursts:** call `entity.getComponent(ParticleEmitter).burst()` (or `burst(40)`) from code, for example when something lands or is collected.
- **Look:** shape, start and end size, start and end color, **Fade out**, lifetime, speed, **Angle** and **Spread** (the fan the particles leave in), and **Gravity**.
- **World space** (on by default) leaves particles where they were emitted when the entity moves, like a trail; off, they travel with it.
- An entity can have several emitters (the Mini Golf hole has three, in different colors, and fires them all).

Particles only run while the game is playing. **Pixel art:** tick **Pixel art (no smoothing)** on a SpriteRenderer so a small sprite scaled up stays crisp.
