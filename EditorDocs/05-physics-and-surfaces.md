# Physics and surfaces

Entities with a **rigidbody** take part in the engine's 2D physics: velocity, mass, collisions and friction. A rigidbody has a **collider** (circle or polygon) and a **physics material**.

## Static, trigger and solid
- **Static** bodies never move (walls, ground).
- **Trigger** colliders detect overlap but never push anything. They raise `onCollisionEnter` and `onCollisionExit`. Holes, pickups and zones are triggers.
- Everything else is solid and resolved by the physics engine.

## Physics materials
A material is **friction** (rolling resistance) plus **restitution** (bounce). In code:

```js
import { PhysicsMaterial } from '@piston/Physics/PhysicsMaterial.js';
rb.physicsMaterial = PhysicsMaterial.Turf;   // Default, Bouncy, Frictionless, Turf
```

## The PhysicsMaterial component
Put the **PhysicsMaterial** component on an entity to set a material from the Inspector.

- On a **solid** collider, it sets the entity's own material: a bouncy bumper, a slick wall.
- As a **zone** (a trigger collider, or the Zone box ticked), bodies inside it get the material while they are in it and get their original back when they leave. Zones with different materials can overlap safely.

Presets: `turf`, `sand`, `ice`, `mud`, `bouncy`, `boost`, `custom`. A blank friction or bounce leaves that value alone. **boost** pushes bodies along the entity's facing direction (set the speed in "Boost"). "Zone affects tag" limits which entities are affected (default `Ball`).

## Stepping physics
Use **Pause** and **Step** (⌘') to advance the simulation one frame at a time while debugging. **Show colliders** in the Scene view header draws collision shapes.


## Collision layers

Everything collides with everything by default. A **CollisionLayer** component puts an entity's collider on a named layer and lists layers it should *not* collide with (`Ignores`, comma-separated). Uses: a bullet that skips its shooter, a ghost that passes through walls, or sections of a level that only hold the ball while it is inside them (the Mini Golf tunnel hole: each fairway is on its own layer, and the ball switches layer when it comes out of the tunnel). In code, `collider.layer = Layers.Player` does the same.

Surface presets: a zone's blank **Friction** and **Bounce** fields use the preset (sand, ice, mud, boost); type a number to override it. Speeds in the sample game are in pixels per frame, so friction 0.08 loses 8% of the ball's speed every frame.
