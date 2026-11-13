// Every game-specific Entity type registers itself with EntityRegistry (for the +Add menu and for
// SceneIO to reconstruct it from a level file) as a side effect of its own file being imported
// somewhere. That import used to happen incidentally - whichever scene's create() referenced a
// type was the only reason it ever got registered - which meant a level file could reference an
// entity type that nothing had actually loaded, and it would silently fail to reconstruct (see the
// MiniGolfHole1 "why did Bounds/Hole/Flag disappear" incident this fixed). Now every scene's
// content depends only on its own scenes/<id>.json, not on which of these happens to be
// imported by a create() somewhere, so registration needs its own scene-independent anchor -
// this file, imported once from main.js - instead.
import './Wall.js';
import './Ball.js';
import './Hole.js';
import './Flag.js';
import './Bumper.js';
import './SandTrap.js';
import './Rock.js';
import './Decor.js';
import './Blade.js';
import './Tunnel.js';
// Registers every scene so game code can switch scenes by id (SceneRegistry.get).
import '../scenes/index.js';
