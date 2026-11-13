# Engine architecture

## Layers
1. **Contracts**, owned by Piston and independent of any language: the scene and prefab JSON, component schemas (names and field types), the bridge protocol between editor and runtime, and written behaviour rules.
2. **The engine core**: entities, components, scenes, physics, rendering. Today it is JavaScript and runs in a browser. The core is written to run anywhere a JavaScript engine can, including embedded in an Android or iOS app.
3. **Platform services**: the small set of things that differ per platform: **audio, rendering, input, assets, storage, time**. Components call these instead of the browser directly.

## Platform services
| Service | Today (web) | Interface |
|---|---|---|
| Audio | `Piston.audio` (Web Audio) | `play`, `stopAll`, `setBusVolume`, `setBusMuted`, `load`, `unlock` |
| Scenes | `Piston.scenes` | `load`, `next`, `restart`, `nextScene`, `current` |
| Input | `Input.js` | key and pointer state |
| Render | Canvas 2D | draw calls from components |

Anything a new platform provides must keep these names and behaviour. That is the porting surface.

## Multiplatform direction
Android and iOS will run the same engine core inside an embedded JavaScript engine, with native implementations of the platform services (native audio, a native canvas for rendering, native touch input). Game scripts stay portable. Visual scripting, stored as data, is the portable authoring layer.

## The editor and the runtime
The editor is a native macOS app. It runs your game in two separate runtime instances: the **Scene view** (renders only, never simulates) and the **Game view** (a snapshot that really plays). They talk to the editor over a **bridge**: requests like `loadScene`, `getSchemas`, `applyPatch`. The Inspector is generated from the schemas the runtime reports, so anything you register appears automatically.

## Globals available to game code
| Name | What |
|---|---|
| `Piston.gameLoop` | the running game loop |
| `Piston.scenes` | scene flow |
| `Piston.audio` | audio service |
