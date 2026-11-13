# Engine contract

What a Piston runtime must do, written down so the web engine, an Android runtime and an iOS runtime all behave the same. If a scene, a clip or a component works on one, it works on all. This is the reference for people writing a port, a plugin or a tool; game makers rarely need it.

## 1. Layers

| Layer | What it is | Portable? |
|---|---|---|
| **Contracts** | The scene file, the schema format, the animation clip format, the bridge messages. Plain JSON. | Shared by every runtime. |
| **Engine core** | Entities, components, physics, animation, scene flow. Written in JavaScript today. | Runs unchanged on Android (QuickJS) and iOS (JavaScriptCore). |
| **Platform services** | Audio, rendering, input, assets, storage, time. | Implemented natively per platform. |

## 2. Scene file

```json
{
  "version": 1, "sceneName": "hole1", "backgroundColor": "#1a1a1a", "deletedKeys": [],
  "entities": [{
    "sceneKey": "added:1a0c12167802", "type": "Ball", "tag": "Ball", "name": null, "parentKey": null,
    "transform": { "position": { "x": 328, "y": 895 }, "rotation": 0, "size": { "x": 24, "y": 24 } },
    "fields": { "radius": 12 },
    "components": [{ "type": "ShapeRenderer", "fields": { "shape": "circle", "color": "#ffffff" } }],
    "rigidbody": { "velocity": { "x": 0, "y": 0 }, "angularVelocity": 0, "mass": 1, "isStatic": false, "useGravity": false },
    "collider": { "enabled": true, "isTrigger": false, "isInverse": false }
  }]
}
```

- `fields` are the entity type's declared fields. A component's `fields` are that component's declared fields. Nothing else is saved.
- Unregistered entity or component types are **skipped with a warning**, never a crash.
- `deletedKeys` lists entities removed from a code-built scene.

## 3. Identity

Every entity has a **`sceneKey`**: a string, **unique within the scene, permanent once saved**. Parenting (`parentKey`), selection, saved edits and plugins all refer to entities by it.

- Entities added in the editor get `added:<random>` and never change.
- A scene built by code gets `Tag#N` by creation order. To make such an entity's key independent of order, set `this.sceneId = 'ball'` in its constructor.
- A file with a missing or repeated `sceneKey` is repaired on open (the editor gives the extras new ids and clears dangling parents, then asks you to save).
- `parentKey` is another entity's `sceneKey` in the same scene, or null. No self-parenting, no cycles. Parenting is **world-space grouping**: moving a parent moves its children; rotation and scale do not cascade.

## 4. Entities and components

An entity has a transform, optional rigidbody and collider, and a list of components. Lifecycle, in order, for each:

1. `start()` runs when it is created. A scene builds a component **before** applying its saved fields, so anything that depends on saved fields must wait for the first `update()` (the engine's animators and audio sources do this).
2. `update()` runs every simulation step while playing, only for enabled components.
3. `draw(ctx)` runs every frame, in the entity's local space (translated and rotated), sorted by `sortingOrder`.
4. `captureState()` / `restoreState(state)`: Play snapshots these and Stop restores them, so a run never changes the edited scene.

Entities may define `onAnimationEvent(name, clip)` and `onAnimationFinished(clip)`.

## 5. Schemas

A class describes its editable data with `static fields = [{ key, label, type, ... }]` and `static description`. The editor builds its Inspector and docs from this; the scene file and validator use it too.

| `type` | JSON value | Extras |
|---|---|---|
| `number` | finite number | `animatable: true` to allow animating it |
| `checkbox` | boolean | |
| `text` | string | `accept: 'image' \| 'audio' \| 'any'` adds a file chooser |
| `color` | CSS color string: `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, or a name | `animatable: true` |
| `select` | one of `options` | |
| `vertices`, `clips`, `animation`, `bindings` | structured, owned by the component | |

An unset value (`null`) is always allowed. Only declared fields round-trip.

## 6. Animation

A clip: `{ name, duration, loop, tracks: [{ path, keys: [{ t, v, ease }] }], events: [{ t, name }] }`, stored inline on the `Animator`'s `clips`, or in a shared file `{ "clips": [...] }` named by its `asset`.

- **Paths:** `transform.position.x`, `transform.position.y`, `transform.rotation`, `transform.size.x`, `transform.size.y`, or `Component.field` for any field declared `animatable: true`.
- **Sampling:** before the first key hold the first value, after the last hold the last. A key's `ease` shapes the move to the next key. Colors blend per channel (including alpha); anything else holds until the next key.
- **Easings:** `linear`, `step`, `easeIn`, `easeOut`, `easeInOut`, `cubicIn`, `cubicOut`, `cubicInOut`, `backOut`, `bounceOut`.
- **Events:** `onAnimationEvent` fires for each event the playhead passes, once per loop.

## 7. Services

The engine core only talks to these.

- **Audio** (`Piston.audio`): buses `master`, `sfx`, `music`, `ui` with volume and mute; every play is its own voice; a clip is capped at 16 simultaneous voices (the oldest stops); `unlock()` after the first user gesture.
- **Scenes** (`Piston.scenes`): `list`, `current`, `load(id)`, `next()`, `restart()`; order from `project.piston.json`.
- **Rendering, input, assets, storage, time:** still reached through web APIs; abstracting them is the next porting step.

## 8. Editor bridge

The editor drives a runtime with JSON requests `{ id, type, ...payload }` answered by `{ replyTo, ok, result | error }`. `type` is reserved, so a payload field that means "type" is `entityType` or `componentType`.

| Request | Purpose |
|---|---|
| `loadScene` | Replace the scene from data. |
| `getSchemas` | Every entity and component schema, with descriptions. |
| `createEntity`, `duplicateEntity`, `getEntityData`, `getEntities` | Build and read entities. |
| `applyPatch`, `editComponent` | Change transforms, fields and components. |
| `getBounds`, `hitTest`, `getSceneBounds`, `setEditorCamera` | Viewport picking and framing. |
| `animationProperties`, `previewAnimation`, `sampleAnimation`, `endPreview` | Animation panel. |
| `validateScene` | Check scene data against this contract. |

## 9. Conformance

A runtime conforms when:

1. `validateScene` (Engine/web/SceneValidator.js) reports **no errors** for every sample and template scene, and behaves as `Engine/web/tests/contract.test.mjs` specifies.
2. It loads a scene and produces the same entities, keys and parents.
3. Sampling any clip gives the same values as the reference (`Engine/web/tests/animator.test.mjs`).
4. Play then Stop leaves the scene exactly as it was.

In the editor: **Build ▸ Validate Scene** runs the validator on the open scene and lists problems in the Console. It also runs quietly each time you open a scene.

The validator's rules: valid scene shape; every entity has a unique `sceneKey`; finite transform numbers; no self-parenting or cycles; field values match their declared types; colors are recognisable; Animator clips are well formed (positive duration, key times, easing names, animatable paths, default clip exists). Missing parents and unregistered types are warnings, not errors.
