import { PlayState } from "../PlayState.js";

/**
 * Edit-mode undo/redo, built entirely on top of GameLoop's existing captureSnapshot/restoreSnapshot
 * (the same whole-scene snapshot mechanism Play<->Stop already uses) rather than a second, parallel
 * mechanism - a snapshot already includes every entity's transform/rigidbody/component state AND
 * which entities currently exist, so restoring one naturally undoes an edit, a delete (the deleted
 * entity's object is still referenced by the snapshot, just with wasDestroyed:true - see
 * GameLoop#restoreSnapshot), or an add (an entity created after the snapshot was taken simply isn't
 * in it, so restoring drops it from `entities` again) all through the exact same code path.
 *
 * push() is called by the Inspector right BEFORE a mutating action (a drag starting, a field edit
 * committing, an add/delete/duplicate/paste) - it records what the scene looked like right then, so
 * that's what undo() returns to if this turns out to be the action someone undoes.
 */
export class UndoStack {
    constructor(gameLoop, { limit = 50 } = {}) {
        this.gameLoop = gameLoop;
        this.undoStack = [];
        this.redoStack = [];
        this.limit = limit;
    }

    /** No-ops while Playing - GameLoop's own Play->Stop snapshot already fully discards any live
     * tweaks made during Play (see GameLoop#stop), so tracking them here too would just be a second,
     * conflicting source of truth for the exact same revert. */
    push() {
        if (this.gameLoop.playState === PlayState.Playing) return;
        this.undoStack.push(this.gameLoop.captureSnapshot());
        if (this.undoStack.length > this.limit) this.undoStack.shift();
        this.redoStack = []; // a fresh edit invalidates whatever was ahead of you, same as any editor
    }

    undo() {
        if (this.undoStack.length === 0) return;
        this.redoStack.push(this.gameLoop.captureSnapshot());
        this.gameLoop.restoreSnapshot(this.undoStack.pop());
    }

    redo() {
        if (this.redoStack.length === 0) return;
        this.undoStack.push(this.gameLoop.captureSnapshot());
        this.gameLoop.restoreSnapshot(this.redoStack.pop());
    }

    get canUndo() { return this.undoStack.length > 0; }
    get canRedo() { return this.redoStack.length > 0; }
}
