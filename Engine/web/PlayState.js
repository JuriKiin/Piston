// The engine's Edit/Play/Pause state, mirroring Unity's editor modes.
// Edit: simulation (physics, entity.update()) is frozen; entities still render every frame so
//       you can position things and see the result before pressing Play.
// Playing: entity.update() and physics run normally.
// Paused: same as Edit (simulation frozen, rendering continues), but Play resumes rather than
//         re-snapshotting - GameLoop only takes an edit-state snapshot on the Edit -> Playing
//         transition.
export const PlayState = {
    Edit: 'edit',
    Playing: 'playing',
    Paused: 'paused',
};
