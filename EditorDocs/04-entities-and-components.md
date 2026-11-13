# Entities and components

An **entity** is a thing in the world: a transform (position, rotation, size), an optional physics body, and a list of **components**. A **component** adds one behaviour or look to an entity: drawing a shape, playing a sound, slowing a ball down.

Entity types and components are plain JavaScript classes in `scripts/`. When a script registers a class, it appears in the editor's menus and Inspector automatically.

## Writing a component
Create one from the Project panel: **New Component Script…**.

```js
import { Component } from '@piston/Component.js';
import { ComponentRegistry } from '@piston/ComponentRegistry.js';
import Constants from '@piston/static/Constants.js';

export class Spin extends Component {
    static description = 'Rotates the entity at a steady speed.';

    static fields = [
        { key: 'speed', label: 'Speed (deg/s)', type: 'number' },
    ];

    constructor({ speed = 90 } = {}) {
        super();
        this.speed = speed;
    }

    update() {
        this.entity.transform.rotation += this.speed * Constants.DELTA_TIME;
    }
}

ComponentRegistry.register('Spin', Spin, 'game');
```

## Writing an entity type
Create one with **New Entity Script…**.

```js
import { Entity } from '@piston/Entity.js';
import { EntityRegistry } from '@piston/EntityRegistry.js';

export class Crate extends Entity {
    constructor() { super(); this.tag = 'Crate'; }
    start() { /* build the transform, rigidbody, components */ }
}
EntityRegistry.register('Crate', Crate, 'Props');   // 'Props' is the menu group
```

## Lifecycle
| Where | Method | When |
|---|---|---|
| Entity | `start(canvas)` | once, when created or loaded |
| Entity, Component | `update()` | every frame while playing |
| Component | `draw(ctx)` | every render frame |
| Entity | `onCollisionEnter(other)` / `onCollisionExit(other)` | physics contacts |
| Entity | `destroy()` / `onDestroy()` | removal |
| Component | `captureState()` / `restoreState(s)` | keep or revert runtime state between Edit and Play |

Useful members: `entity.transform`, `entity.tag`, `entity.name`, `entity.addComponent(c)`, `entity.getComponent(Type)`, `entity.setParent(p)`, `entity.moveBy(dx, dy)`.

## Fields and the Inspector
The Inspector is built from each class's `static fields` array. Declare a field once and it can be edited, saved in scenes, and shown in this documentation.

| `type` | Control | Notes |
|---|---|---|
| `number` | number box | |
| `checkbox` | toggle | |
| `text` | text box | |
| `color` | color picker plus hex | stored as `#rrggbb` or `#rrggbbaa` |
| `select` | menu | needs `options: ['a', 'b']` |
| `text` + `accept` | file chooser, drag-and-drop from the Project panel | `accept: 'image'`, `'audio'` or `'any'` |
| `vertices` | point count | edit points with the vertex tool |
| `clips` | animation clips | edited in the Sprite Sheet editor |

The Inspector never guesses from field names. A color picker needs `type: 'color'`; a file chooser needs `accept`. Add a `static description` string to a class and it shows up in the reference.

## Parenting
A parent is a world-space group: moving a parent moves its children, while rotation and scale do not cascade. Children are saved with a `parentKey`.

## Prefabs
A prefab is a saved entity (`prefabs/<id>.json`) you can place many times.

See the [Component reference](doc:ref-components) for every built-in component and its fields.
