# Input and UI

## Input
```js
import input from '@piston/static/Input.js';

input.getKeyDown('Space');            // held (also true for a quick tap)
input.wasPressed('Space');            // went down this step - exactly once, never misses a tap
input.isMouseButtonPressed(0);        // left button held
input.getCanvasMousePosition();       // mouse in canvas pixels
Piston.gameLoop.getMouseWorldPosition();  // mouse in WORLD units (accounts for the camera)
```
Use world position for anything that aims at the scene. Canvas position is for screen-space UI.

More on edges in [Simulation, input and the entity pipeline](doc:17-simulation-and-pipeline).

The Game view scales the canvas to fit its window; input already accounts for that.

## Named actions
**InputController** and **InputBindingLayer** map keys to named actions (like `jump`) so game code asks for actions instead of raw keys, and players can rebind them.

## Screen-space UI
**UIElement** entities stay fixed on screen instead of moving with the camera: **Text** for labels and scores, **Button** for clickable things, **UIContainer** for panels. Their positions are in screen pixels.


## Fonts

A Text component's **Font** is a font family name **or a font file**: type a name, use the folder button to pick a `.ttf`, `.otf`, `.woff` or `.woff2` from your project (it opens in `assets/fonts`, where the Google Fonts plugin saves downloads), or drop a font file from the Project panel onto the field. A file is drawn under its own name. If the family has been downloaded into the project (see the Google Fonts plugin in *Plugins*), it loads from `assets/fonts/` with no network. Otherwise the engine asks Google Fonts' servers for it by name, which needs a connection while the game runs. Generic names (`serif`, `sans-serif`, `monospace`…) always work.
