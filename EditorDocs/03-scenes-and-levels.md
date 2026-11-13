# Scenes and levels

A **scene** is one `.json` file in `scenes/`. The file name is the scene's id: `hole1.json` is scene `hole1`. You do not need to register scenes in code; Piston finds them.

## Order
Scenes are ordered naturally (`hole2` before `hole10`). To pin an order, list ids in `project.piston.json`:

```json
{ "startScene": "hole1", "sceneOrder": ["hole1", "hole2", "bonus"] }
```

Scenes you do not list follow in natural order.

## Moving between scenes from code
The engine owns scene flow. From any script:

```js
await Piston.scenes.next();        // the next scene in order; false when there is none
await Piston.scenes.load('hole3'); // a scene by id
await Piston.scenes.restart();     // reload the current scene
Piston.scenes.nextScene;           // the Scene that would load next, or null
Piston.scenes.current;             // the running Scene
```

## Finishing a level
`LevelFlow.finish` is the one call a game makes when the player completes a level. It records the score, then continues to the level's `nextScene` if it names one, otherwise to the next scene in order.

```js
import { LevelFlow } from '@piston/LevelFlow.js';

const { totals, done } = await LevelFlow.finish(window.Piston.gameLoop, strokes);
// totals: { strokes, par, over, levels }   done: true when there was nowhere left to go
```

Add a **LevelInfo** component to any entity in a scene to give it a title, a **par**, and an optional **Next scene id**. `LevelFlow.results` and `LevelFlow.totals()` hold the run so far, which is what a scoreboard reads.

## Hand-registered scenes (optional)
If you want a scene to have its own display name or a `create()` fallback, you can still register it in a script with `new Scene({ id, name })` and `SceneRegistry.register`. The scene's file remains the source of truth for its content, and your order still applies.
