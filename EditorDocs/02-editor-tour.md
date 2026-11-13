# Editor tour

## Layout
- **Left, top: Scene panel.** Your scenes, and the Hierarchy of entities in the open scene.
- **Left, bottom: Project panel.** Your files. Drag the divider to resize; every panel edge can be dragged.
- **Center: tabs.** Scene view, Game view, open scripts, and this documentation. Right-click a tab to open it in its own window.
- **Right: Inspector.** Values for whatever is selected.
- **Console** at the bottom of the center area shows logs and errors from the game.

## The Scene view
- **Click** an entity to select it. **Drag** it to move. **Drag empty space** to pan. Pinch or use the zoom buttons to zoom.
- **Fit** frames the whole scene. **100%** shows actual size.
- **Handles:** drag a corner to scale, drag the round knob above the box to rotate.
- **Snapping:** the magnet turns grid snapping on; the picker sets the grid size. Hold **Option** to flip snapping for one drag. Rotation snaps to 15 degrees.
- **Game frame** (dashed rectangle button): shows what the player will see, based on the game resolution.
- **Vertex tool:** with a polygon selected, drag points, click an edge to add one, Option-click a point to remove it.
- **Right-click** the viewport to create an Empty, any entity, or a prefab at the cursor.

## Selecting groups
Click a child inside a group (for example a flag on a hole) and the **topmost parent** is selected first, so dragging moves the whole group. Click again without dragging to select the child. Shift-click adds to a selection.

## Hierarchy and parenting
Drag an entity onto another to make it a **child**. Drop it on empty space to unparent. Moving a parent moves its children. Rotation and scale do not cascade. Duplicating a parent copies its children too.

## Prefabs
Select an entity and choose **Save as Prefab** in the Inspector. Place prefabs from the **+** menu, the right-click menu, or by dragging a file from `prefabs/` into the Scene view.

## Undo and redo
⌘Z and ⇧⌘Z undo scene edits. Inside a script tab they go to the text editor instead.

## Game view and resolution
The game runs at a fixed **design resolution** (the aspect picker in the Game tab header) and is scaled to fit the window, keeping its shape. It is saved as `resolution` in `project.piston.json`.

## Keyboard shortcuts
| Action | Keys |
|---|---|
| Play / Stop | ⌘R / ⌘. |
| Pause / Step | ⇧⌘P / ⌘' |
| Save / Save All | ⌘S / ⌥⌘S |
| Undo / Redo | ⌘Z / ⇧⌘Z |
| Duplicate | ⌘D |
| Copy / Paste entity | ⇧⌘C / ⇧⌘V |
| Delete | Delete key |
| Build Development / Release | ⌘B / ⇧⌘B |
