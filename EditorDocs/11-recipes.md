# Recipes

## A sound when the ball hits something
Add an **AudioSource** (Bus `sfx`, Clip `./assets/hit.wav`) to the ball. In its entity's `onCollisionEnter(other)`, call `this.getComponent(AudioSource).play()`. Repeated hits layer instead of cutting each other off.

## Sand, ice and mud
Add a **PhysicsMaterial** component to an entity with a trigger collider and choose the preset. Anything with the tag `Ball` that enters changes friction until it leaves. See [Physics and surfaces](doc:05-physics-and-surfaces).

## A multi-level game
1. Create one scene per level; the files in `scenes/` are your levels, in natural order.
2. Add **LevelInfo** to each scene for a title and par.
3. When the player finishes: `await LevelFlow.finish(Piston.gameLoop, score)`.

## An animated character
1. Add **SpriteRenderer**, set the image, open **Sprite Sheet…**.
2. Set the cell size, add clips named `idle` and `run`, and Apply.
3. In code: `entity.getComponent(SpriteAnimator).play(moving ? 'run' : 'idle')`.

## A group that moves together
Drag the children onto a parent in the Hierarchy. Drag the parent in the Scene view.

## A reusable obstacle
Build it, select the parent, **Save as Prefab**, then drag it from `prefabs/` into other scenes.
