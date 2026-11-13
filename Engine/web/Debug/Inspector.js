import { Layers } from "../Physics/CollisionMatrix.js";
import { Vector2 } from "../Physics/Vector2.js";
import { PlayState } from "../PlayState.js";
import Debug from "../static/Debug.js";
import { ComponentRegistry } from "../ComponentRegistry.js";
import { EntityRegistry } from "../EntityRegistry.js";
import { PolygonRenderer } from "../PolygonRenderer.js";
import { SpriteRenderer } from "../SpriteRenderer.js";
import { serializeEntity } from "../SceneIO.js";
import { PrefabRegistry } from "../PrefabRegistry.js";
import { savePrefab } from "../PrefabIO.js";
import { promptDialog } from "./Dialogs.js";
import { buildAddMenuContent } from "./AddMenu.js";
import { UndoStack } from "./UndoStack.js";

const layerNames = Object.fromEntries(Object.entries(Layers).map(([name, value]) => [value, name]));
const TOOLS = [['move', 'Move (T)'], ['rotate', 'Rotate (R)'], ['scale', 'Scale (S)']];
const VERTEX_HANDLE_RADIUS = 7;
const CURVE_HANDLE_RADIUS = 5;
// How close (world/local units, unaffected by zoom since neither drag path currently accounts for
// it) a dragged position has to land to a candidate before it snaps to it outright.
const SNAP_THRESHOLD = 8;

/**
 * An in-page overlay panel (not a popup window) listing every entity in the scene with live,
 * editable fields - transform, rigidbody, collider - bound directly to the running objects.
 * Also supports clicking an entity directly on the canvas to select it, then dragging it with
 * the Move/Rotate/Scale tool (W/E/R shortcuts) to edit the scene visually.
 * Toggled by DevToolbar's "Inspector" button; only polls/listens for input while open.
 */
export class Inspector {
    constructor(gameLoop) {
        this.gameLoop = gameLoop;
        this.knownIds = [];
        this.panelsByEntityId = new Map();
        this._refreshHandle = null;

        this.selectedEntity = null; // the "primary" selection - see select()/toggleSelection()
        this.selectedEntities = new Set(); // the full multi-selection; always a superset of {selectedEntity} when non-empty
        this._clipboard = null; // last copied entity's data, as serializeEntity() shaped plain JSON - see #copyEntities
        // Edit-mode undo/redo, built on GameLoop's own Play<->Stop snapshot mechanism (see
        // UndoStack.js) - lives on the GameLoop itself (not just this Inspector instance) so
        // DevToolbar's Undo/Redo buttons and the Add-menu's various entry points can push/call it
        // too without needing a reference back to this Inspector for anything but its own
        // selection-repair logic (see undo()/redo() below).
        this.gameLoop.undoStack = new UndoStack(gameLoop);
        this.tool = 'move';
        this._drag = null;
        // Whatever #findEntityAt's most recent canvas click resolved to - see its own doc comment
        // on why this has to be tracked separately from selectedEntity (a group-click "second click
        // drills into the child" mechanism).
        this._lastClickHit = null;
        // Set only while a Move/vertex drag is actually snapped to something, so renderGizmo can
        // draw the guide line(s) that made the snap visible - see #bindCanvasEvents/#snapAxis.
        this._snapGuides = null;
        // Held Space turns a plain left-drag into a camera pan - see #bindCanvasEvents.
        this._spaceHeld = false;
        // The one PolygonRenderer (if any) currently in exclusive vertex-edit mode, toggled from
        // its own Inspector section rather than being one of the Move/Rotate/Scale tools above -
        // while set, canvas interaction does ONLY vertex editing for this shape (see
        // #bindCanvasEvents), independent of whatever this.tool/selectedEntity are.
        this.editingVerticesFor = null;
        this.consoleEntries = []; // { type: 'error' | 'log', message, stack?, time }
        // Entities/components collapse by default; ids in here are the ones a user expanded, so a
        // full panel rebuild (any entity added/removed, e.g. Play/Stop or a component add/remove)
        // doesn't silently re-collapse everything the user had open.
        this.expandedEntityIds = new Set();
        // Same idea, per-component - keyed by the component instance itself (stable across a panel
        // rebuild, unlike the DOM). Without this, toggling "Edit Vertices" forces a full rebuild
        // (see #buildComponentSection) whose fresh `fields` div always starts collapsed, hiding the
        // toggle button and vertex rows the instant you open them.
        this.expandedComponents = new WeakSet();

        this.#injectStylesOnce();
        this.#buildPanel();
        this.#bindCanvasEvents();
        this.#bindKeyboardShortcuts();
        this.#bindConsoleCapture();

        // Closes any open "+ Add Component" menu on an outside click. Menus themselves and their
        // toggle buttons stop propagation, so this only ever fires for a genuine outside click.
        document.addEventListener('click', () => {
            for (const menu of document.querySelectorAll('.piston-component-menu')) {
                menu.style.display = 'none';
            }
        });

        // Docked (not a toggle-away overlay), so it's simply always open.
        this.open();
    }

    get isOpen() {
        return this.root.style.display !== 'none';
    }

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    }

    open() {
        this.root.style.display = 'flex';
        this.#refresh();
        this._refreshHandle = setInterval(() => this.#refresh(), 250);
    }

    close() {
        this.root.style.display = 'none';
        clearInterval(this._refreshHandle);
        this._refreshHandle = null;
        this._drag = null;
    }

    /** Replaces the current selection outright with just `entity` (or clears it, for null) - a
     * plain click, with no modifier held. */
    select(entity) {
        this.selectedEntity = entity;
        this.selectedEntities = new Set(entity ? [entity] : []);
        this._drag = null;
        this.#updateToolButtons();
    }

    /** Shift/Ctrl/Cmd-click: toggles `entity` in the current multi-selection rather than replacing
     * it. `selectedEntity` (the "primary" - what the Rotate/Scale gizmo and vertex editing target)
     * becomes whichever entity was just toggled ON, or an arbitrary remaining member if it was
     * toggled OFF (or null once the last one is removed). */
    toggleSelection(entity) {
        if (!entity) return;
        if (this.selectedEntities.has(entity)) {
            this.selectedEntities.delete(entity);
            this.selectedEntity = [...this.selectedEntities][0] ?? null;
        } else {
            this.selectedEntities.add(entity);
            this.selectedEntity = entity;
        }
        this._drag = null;
        this.#updateToolButtons();
    }

    isSelected(entity) {
        return this.selectedEntities.has(entity);
    }

    /** Called by DevToolbar's Undo/Redo buttons and this Inspector's own Cmd/Ctrl+Z/Y shortcuts -
     * kept here (rather than calling gameLoop.undoStack.undo() directly from both places) so the
     * selection-repair step below always runs alongside it. */
    undo() {
        this.gameLoop.undoStack.undo();
        this.#validateSelection();
    }

    redo() {
        this.gameLoop.undoStack.redo();
        this.#validateSelection();
    }

    /** A restoreSnapshot (undo, redo, or Stop) replaces `gameLoop.entities` wholesale - anything
     * selected that isn't in the restored set anymore (an undone Add, a redone Delete) would
     * otherwise leave a stale reference sitting in selectedEntity/selectedEntities. Also forces a
     * full panel rebuild, since the entity list itself may have changed (an undone add/delete). */
    #validateSelection() {
        this.selectedEntities = new Set([...this.selectedEntities].filter(e => this.#isLive(e)));
        if (!this.#isLive(this.selectedEntity)) this.selectedEntity = [...this.selectedEntities][0] ?? null;
        this.knownIds = [];
    }

    setTool(tool) {
        this.tool = tool;
        this.#updateToolButtons();
    }

    /**
     * Draws the selection outline and the active tool's handle. Called by GameLoop every frame,
     * once per render pass (see GameLoop#render) - `pass` is 'World' inside the camera-transformed
     * context entities render in, then 'Screen' again in the raw, un-transformed one HUD-style
     * entities use, and this only draws for whichever entity is actually selected/being edited if
     * IT belongs to the pass currently asking - a Screen-space entity's gizmo drawn under the
     * World transform (or vice versa) would land nowhere near what's actually on screen.
     */
    renderGizmo(ctx, pass) {
        if (!this.isOpen || this.gameLoop.playState === PlayState.Playing) return;

        // The entity actually being dragged/edited right now (if any) - snap guides belong to
        // whichever pass THAT entity is in, independent of what's separately selected.
        const dragEntity = this._drag?.entity ?? this.editingVerticesFor?.entity;
        if (this._snapGuides && this.#spaceOf(dragEntity) === pass) this.#drawSnapGuides(ctx);

        // Exclusive: while a shape's own vertex-edit toggle is on, that's ALL this draws - no
        // selection box/rotate/scale handle for whatever's separately selected, since interaction
        // is restricted to just this shape's points too (see #bindCanvasEvents).
        if (this.editingVerticesFor) {
            const { entity, renderer } = this.editingVerticesFor;
            if (!this.#isLive(entity)) { this.editingVerticesFor = null; return; }
            if (this.#spaceOf(entity) !== pass) return;
            const t = entity.transform;
            const n = renderer.vertices.length;

            // Curve control-point handles + their guide lines, drawn first so the corner handles
            // (drawn below) sit on top at any overlap - standard vector-editor convention (the
            // anchor point reads as "the real point," the control handle as its accessory).
            for (let i = 0; i < n; i++) {
                const v = renderer.vertices[i];
                if (!v.curve) continue;
                const worldV = Vector2.transform(v, t);
                const worldC = Vector2.transform(v.curve, t);
                const worldNext = Vector2.transform(renderer.vertices[(i + 1) % n], t);

                ctx.strokeStyle = '#ffa64d';
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.moveTo(worldV.x, worldV.y);
                ctx.lineTo(worldC.x, worldC.y);
                ctx.lineTo(worldNext.x, worldNext.y);
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.beginPath();
                ctx.arc(worldC.x, worldC.y, CURVE_HANDLE_RADIUS, 0, Math.PI * 2);
                ctx.fillStyle = '#ffa64d';
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }

            for (const v of renderer.vertices) {
                const world = Vector2.transform(v, t);
                ctx.beginPath();
                ctx.arc(world.x, world.y, VERTEX_HANDLE_RADIUS, 0, Math.PI * 2);
                ctx.fillStyle = '#4da6ff';
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
            return;
        }

        // Multi-select aware: every live, same-pass entity in the selection gets its outline drawn;
        // the Rotate/Scale handle only makes sense for a single target (dragging it moves/rotates/
        // scales just the primary - see #bindCanvasEvents), so it's only drawn when the selection
        // is exactly that one entity, not floating ambiguously over a multi-select group.
        const liveSelected = [...this.selectedEntities].filter(e => this.#isLive(e) && this.#spaceOf(e) === pass);
        for (const entity of liveSelected) this.#drawSelectionOutline(ctx, entity);
        if (liveSelected.length === 1 && liveSelected[0] === this.selectedEntity) {
            this.#drawToolHandle(ctx, this.selectedEntity);
        }
    }

    /** The dashed outline traced around one selected entity's actual shape - a PolygonRenderer's
     * real vertices (its shape rarely matches transform.size's generic box - nothing about a custom
     * polygon keeps that in sync) or a plain rotated bounding box otherwise. Extracted from what
     * used to be renderGizmo's own single-entity body so multi-select (see renderGizmo above) can
     * call it once per selected entity instead of just for `this.selectedEntity`. */
    #drawSelectionOutline(ctx, entity) {
        const t = entity.transform;
        const rad = t.rotation * Math.PI / 180;
        const polygonRenderer = entity.getComponent(PolygonRenderer);

        ctx.strokeStyle = '#4da6ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        if (polygonRenderer) {
            const verts = polygonRenderer.vertices.map(v => Vector2.transform(v, t));
            ctx.beginPath();
            ctx.moveTo(verts[0].x, verts[0].y);
            for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
            ctx.closePath();
            ctx.stroke();
        } else {
            ctx.save();
            ctx.translate(t.position.x, t.position.y);
            ctx.rotate(rad);
            ctx.strokeRect(-t.size.x / 2 - 3, -t.size.y / 2 - 3, t.size.x + 6, t.size.y + 6);
            ctx.restore();
        }
        ctx.setLineDash([]);
    }

    /** The active tool's own handle (Scale's corner dot, Rotate's line+dot) - only ever drawn for a
     * single-entity selection (see renderGizmo above), so this still reads `this.selectedEntity`/
     * `this.tool` directly rather than taking them as parameters, same as #handlePosition/
     * #hitTestHandle below which the Rotate handle here reuses. */
    #drawToolHandle(ctx, entity) {
        const t = entity.transform;
        const rad = t.rotation * Math.PI / 180;
        const polygonRenderer = entity.getComponent(PolygonRenderer);

        if (this.tool === 'scale' && !polygonRenderer) {
            ctx.save();
            ctx.translate(t.position.x, t.position.y);
            ctx.rotate(rad);
            ctx.fillStyle = '#4da6ff';
            ctx.fillRect(t.size.x / 2 - 4, t.size.y / 2 - 4, 8, 8);
            ctx.restore();
        }

        if (this.tool === 'rotate') {
            const handlePos = this.#handlePosition('rotate');
            ctx.strokeStyle = '#4da6ff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(t.position.x, t.position.y);
            ctx.lineTo(handlePos.x, handlePos.y);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(handlePos.x, handlePos.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#4da6ff';
            ctx.fill();
        }
    }

    // --- Canvas selection + drag-to-edit ---

    /**
     * Computed straight from the DOM event's own clientX/Y rather than the shared Input
     * singleton's tracked mouse position, which is only updated by a separate 'mousemove'
     * listener - relying on it here would mean a mousedown with no very recent mousemove
     * (synthetic events, some input devices) reads a stale position.
     */
    #worldPosFromEvent(e) {
        const canvas = this.gameLoop.canvas;
        const canvasPos = this.#canvasPosFromEvent(e);
        if (!this.gameLoop.camera) return canvasPos;
        return this.gameLoop.camera.screenToWorld(canvasPos, canvas.width, canvas.height);
    }

    /** 'Screen' or 'World' - UIElement is the only entity type that currently exposes this as an
     * editable field (see its own doc comment), so anything else defaults to 'World', same as
     * every entity behaved before Screen space existed at all. */
    #spaceOf(entity) {
        return entity?.space ?? 'World';
    }

    /**
     * The mouse position in whichever coordinate frame `entity` actually renders/lives in - raw
     * canvas pixels for a 'Screen'-space entity (a HUD element, unaffected by the camera), or the
     * camera-mapped world position for everything else. Selecting, dragging, and hit-testing all
     * need this per-ENTITY (not just once per event) since a World-space and a Screen-space entity
     * can be on screen at the same time using two different frames for what "at this pixel" means.
     */
    #pointerPosForEntity(entity, e) {
        return this.#spaceOf(entity) === 'Screen' ? this.#canvasPosFromEvent(e) : this.#worldPosFromEvent(e);
    }

    /** Raw canvas-pixel position (pre-camera) of a DOM mouse event - the shared first step behind
     * #worldPosFromEvent and the pan/zoom handlers below, which need this same conversion but a
     * camera-relative world position isn't yet meaningful for (panning has no "current" world
     * point to anchor from until AFTER this; zooming needs it both before and after changing zoom). */
    #canvasPosFromEvent(e) {
        const canvas = this.gameLoop.canvas;
        const rect = canvas.getBoundingClientRect();
        return new Vector2(
            (e.clientX - rect.left) * (canvas.width / rect.width),
            (e.clientY - rect.top) * (canvas.height / rect.height)
        );
    }

    #bindCanvasEvents() {
        const canvas = this.gameLoop.canvas;

        canvas.addEventListener('mousedown', (e) => {
            if (!this.isOpen || this.gameLoop.playState === PlayState.Playing) return;

            // Panning takes priority over everything else below (vertex editing, selection,
            // Move/Rotate/Scale) - middle-click always pans; holding Space turns the regular left
            // button into a pan too (the Figma/Photoshop convention), for anyone without a
            // convenient middle button. Camera-less GameLoops (devTools: false) never reach here
            // at all - the Inspector itself doesn't exist without one - so no guard needed for that.
            if (e.button === 1 || (e.button === 0 && this._spaceHeld)) {
                e.preventDefault();
                this._drag = { mode: 'pan', anchorWorld: this.#worldPosFromEvent(e) };
                return;
            }

            // Exclusive mode: while a shape's vertex-edit toggle is on, a click either grabs one
            // of its points to drag, or does nothing at all - no falling through to select a
            // different entity or use Move/Rotate/Scale, matching that toggle's "ONLY" vertex
            // editing while it's active. Adding/removing a point is the Inspector list's job
            // (Add/Remove buttons) instead - this only repositions an existing one.
            if (this.editingVerticesFor) {
                const { entity, renderer } = this.editingVerticesFor;
                if (!this.#isLive(entity)) {
                    this.editingVerticesFor = null;
                } else {
                    const pos = this.#pointerPosForEntity(entity, e);
                    // Curve handles checked first: a control point sitting close to its own corner
                    // (a fresh, barely-curved edge) would otherwise be unreachable, since the corner
                    // handle drawn on top of it would always win the hit test.
                    const curveIndex = this.#hitTestCurveHandle(entity, renderer, pos);
                    if (curveIndex !== -1) {
                        this.gameLoop.undoStack.push();
                        this._drag = { mode: 'curve', entity, renderer, vertexIndex: curveIndex };
                        return;
                    }
                    const vertexIndex = this.#hitTestVertexHandle(entity, renderer, pos);
                    if (vertexIndex !== -1) {
                        this.gameLoop.undoStack.push();
                        this._drag = { mode: 'vertex', entity, renderer, vertexIndex };
                    }
                    return;
                }
            }

            // The rotate/scale handles are drawn outside the entity's own bounding box, so check
            // them first - otherwise clicking a handle would miss #findEntityAt and deselect.
            if (this.#isLive(this.selectedEntity)) {
                const pos = this.#pointerPosForEntity(this.selectedEntity, e);
                if (this.#hitTestHandle(pos)) {
                    const t = this.selectedEntity.transform;
                    this.gameLoop.undoStack.push();
                    this._drag = {
                        entity: this.selectedEntity,
                        tool: this.tool,
                        offset: { x: pos.x - t.position.x, y: pos.y - t.position.y },
                    };
                    return;
                }
            }

            const hit = this.#findEntityAt(e);

            // Shift or Ctrl/Cmd-click adds/removes `hit` from the selection instead of replacing it
            // outright - clicking blank space (hit is null) with a modifier held does nothing rather
            // than clearing an in-progress multi-selection, since that's rarely what's intended.
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                if (hit) this.toggleSelection(hit);
                return;
            }

            // A plain (no-modifier) click on something that's already part of an active
            // multi-selection keeps the WHOLE group selected, rather than collapsing to just this
            // one entity the way select() below would - only the primary (used for the
            // Rotate/Scale gizmo target) changes to whichever member was actually clicked.
            // Collapsing first would fight with dragging the group: by the time a drag had moved
            // anything, the selection would already have silently shrunk to just this entity, and
            // every other member's own highlight/outline would vanish mid-drag even though it's
            // still moving. To deliberately shrink a multi-selection down to one, click something
            // NOT in it (or blank space) - both still go through select() and behave as always.
            const priorGroup = this.selectedEntities.size > 1 && this.isSelected(hit)
                ? this.#excludeDescendantsAlreadyInGroup([...this.selectedEntities].filter(en => this.#isLive(en)))
                : null;
            if (priorGroup) {
                this.selectedEntity = hit;
                this._drag = null;
                this.#updateToolButtons();
            } else {
                this.select(hit);
            }

            if (hit) {
                const pos = this.#pointerPosForEntity(hit, e);
                this.gameLoop.undoStack.push();
                // Dragging a member of an active multi-selection moves the whole group together
                // (see the 'move' branch below) - dragging anything else (a lone entity, or one
                // that happens to not be part of the current multi-select) is just that one entity,
                // same as always.
                const group = priorGroup ?? [hit];
                this._drag = {
                    entity: hit,
                    tool: this.tool,
                    offset: { x: pos.x - hit.transform.position.x, y: pos.y - hit.transform.position.y },
                    group,
                };
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (!this._drag) return;

            if (this._drag.mode === 'pan') {
                // No `entity` on a pan drag (nothing selected/live to check), so this has to run
                // before the #isLive guard below, which would otherwise treat a pan's missing
                // entity as "gone" and cancel the drag on its very first mousemove.
                const camera = this.gameLoop.camera;
                if (!camera) { this._drag = null; return; }
                const canvas = this.gameLoop.canvas;
                // Re-derives the world point currently under the cursor with the camera as it
                // stands right now, then shifts the camera by exactly the gap between that and
                // where the drag's anchor point is supposed to be - since this is a linear
                // transform, one correction fully closes the gap in a single step, not an
                // approximation that converges over several frames.
                const worldNow = camera.screenToWorld(this.#canvasPosFromEvent(e), canvas.width, canvas.height);
                camera.position.x += this._drag.anchorWorld.x - worldNow.x;
                camera.position.y += this._drag.anchorWorld.y - worldNow.y;
                return;
            }

            if (!this.#isLive(this._drag.entity)) { this._drag = null; this._snapGuides = null; return; }

            if (this._drag.mode === 'vertex') {
                const { renderer, vertexIndex } = this._drag;
                const local = this.#worldToLocal(this._drag.entity, this.#pointerPosForEntity(this._drag.entity, e));
                // Free-form, same as editing the X/Y fields directly in the Inspector's vertex
                // list - no convexity check here either. An earlier version silently refused any
                // drag that would fold the shape concave, which felt simply broken rather than
                // guarded: a handle sitting close to its neighbors (e.g. several points added via
                // "+ Add" in a row) has almost no direction it CAN move without tripping that
                // check, so it looked like dragging didn't work at all.
                //
                // Snap candidates are this shape's OWN local origin plus its OTHER vertices' local
                // x/y - not other entities' vertices, since those live in a different local frame
                // (this one's own rotation) and "aligned" would stop meaning what it looks like the
                // moment either shape is rotated.
                const others = renderer.vertices.filter((_, i) => i !== vertexIndex);
                const xCandidates = [0, ...others.map(v => v.x)];
                const yCandidates = [0, ...others.map(v => v.y)];
                const snappedX = this.#snapAxis(local.x, xCandidates);
                const snappedY = this.#snapAxis(local.y, yCandidates);
                renderer.vertices[vertexIndex] = { x: snappedX.value, y: snappedY.value };
                this._snapGuides = (snappedX.snapped || snappedY.snapped)
                    ? { space: 'local', entity: this._drag.entity, x: snappedX.snapped ? snappedX.value : null, y: snappedY.snapped ? snappedY.value : null }
                    : null;
                return;
            }

            if (this._drag.mode === 'curve') {
                this._snapGuides = null;
                const { renderer, vertexIndex } = this._drag;
                renderer.vertices[vertexIndex].curve = this.#worldToLocal(this._drag.entity, this.#pointerPosForEntity(this._drag.entity, e));
                return;
            }

            const { entity, tool, offset } = this._drag;

            const pos = this.#pointerPosForEntity(entity, e);
            const t = entity.transform;

            if (tool === 'move') {
                // Snap candidates: the viewport's own center (handy for centering something)
                // plus every other live entity IN THE SAME SPACE - a 'Screen' HUD element only
                // makes sense aligned against other 'Screen' elements (both are raw canvas
                // pixels), and likewise a 'World' entity against other 'World' ones (both are
                // camera-mapped) - mixing the two would silently compare numbers from different
                // coordinate systems and "aligned" would stop meaning what it looks like.
                const entitySpace = this.#spaceOf(entity);
                const center = this.#snapCenterFor(entitySpace);
                const others = this.gameLoop.entities.filter(o => o !== entity && !o.destroyed && this.#spaceOf(o) === entitySpace);
                const xCandidates = [center.x, ...others.map(o => o.transform.position.x)];
                const yCandidates = [center.y, ...others.map(o => o.transform.position.y)];
                const snappedX = this.#snapAxis(pos.x - offset.x, xCandidates);
                const snappedY = this.#snapAxis(pos.y - offset.y, yCandidates);
                const dx = snappedX.value - t.position.x;
                const dy = snappedY.value - t.position.y;
                // moveBy (not a plain assignment) so this also cascades to entity's own children,
                // if it has any (see Entity#moveBy/setParent) - an unparented entity just moves
                // itself, exactly as before.
                entity.moveBy(dx, dy);
                // Group move: snapping only ever applies to the dragged (primary) entity above -
                // every other selected entity just follows by the same delta (and its own children,
                // if any, cascade right along with IT the same way), keeping their relative
                // positions to each other and to the primary exactly as they were. The group was
                // already filtered (see #excludeDescendantsAlreadyInGroup) so a child never gets
                // this delta twice just because both it and its parent happen to be selected.
                const group = this._drag.group;
                if (group && group.length > 1) {
                    for (const other of group) {
                        if (other === entity) continue;
                        other.moveBy(dx, dy);
                    }
                }
                this._snapGuides = (snappedX.snapped || snappedY.snapped)
                    ? { space: 'world', x: snappedX.snapped ? snappedX.value : null, y: snappedY.snapped ? snappedY.value : null }
                    : null;
            } else if (tool === 'rotate') {
                this._snapGuides = null;
                t.rotation = t.position.angleTo(pos);
            } else if (tool === 'scale') {
                this._snapGuides = null;
                const dx = pos.x - t.position.x;
                const dy = pos.y - t.position.y;
                const rad = -t.rotation * Math.PI / 180;
                const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
                const localY = dx * Math.sin(rad) + dy * Math.cos(rad);
                t.size.x = Math.max(4, Math.abs(localX) * 2);
                t.size.y = Math.max(4, Math.abs(localY) * 2);
                this.#syncColliderSize(entity);
            }
        });

        window.addEventListener('mouseup', () => {
            this._drag = null;
            this._snapGuides = null;
        });

        const MIN_ZOOM = 0.1;
        const MAX_ZOOM = 8;
        canvas.addEventListener('wheel', (e) => {
            if (!this.isOpen || this.gameLoop.playState === PlayState.Playing) return;
            const camera = this.gameLoop.camera;
            if (!camera) return;
            e.preventDefault(); // otherwise the page itself scrolls underneath the canvas

            // Zoom-to-cursor: find the world point under the cursor BEFORE changing zoom, change
            // it, then shift the camera by however far that same world point moved AFTER - so the
            // thing you're pointing at stays under the cursor instead of the view zooming around
            // the canvas's center regardless of where you were actually looking.
            const canvasPos = this.#canvasPosFromEvent(e);
            const worldBefore = camera.screenToWorld(canvasPos, canvas.width, canvas.height);

            const zoomFactor = Math.exp(-e.deltaY * 0.001);
            camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * zoomFactor));

            const worldAfter = camera.screenToWorld(canvasPos, canvas.width, canvas.height);
            camera.position.x += worldBefore.x - worldAfter.x;
            camera.position.y += worldBefore.y - worldAfter.y;
        }, { passive: false }); // passive: false so preventDefault above actually takes effect
    }

    /** The exact center of the visible canvas, in whichever frame `space` calls for - one of the
     * Move tool's snap candidates (see #bindCanvasEvents), and the obvious "center it" reference
     * point either way: raw canvas pixels for a 'Screen' HUD element (nothing to convert - that's
     * already the frame it lives in), or the camera-mapped world point for a 'World' one, since
     * that's what's actually centered on screen right now regardless of where the camera's looking. */
    #snapCenterFor(space) {
        const canvas = this.gameLoop.canvas;
        const center = new Vector2(canvas.width / 2, canvas.height / 2);
        if (space === 'Screen' || !this.gameLoop.camera) return center;
        return this.gameLoop.camera.screenToWorld(center, canvas.width, canvas.height);
    }

    /** Snaps `value` to whichever of `candidates` it's within SNAP_THRESHOLD of (the closest one,
     * if several qualify), otherwise returns it unchanged. `snapped` tells the caller whether to
     * draw a guide line for it - only true on an actual snap, not just "happened to already match". */
    #snapAxis(value, candidates) {
        let best = null;
        let bestDist = SNAP_THRESHOLD;
        for (const c of candidates) {
            const dist = Math.abs(value - c);
            if (dist < bestDist) {
                bestDist = dist;
                best = c;
            }
        }
        return best !== null ? { value: best, snapped: true } : { value, snapped: false };
    }

    /** Draws a full-line guide for whichever axis (or both) is currently snapped - see
     * #bindCanvasEvents/#snapAxis. A vertex drag's guide is drawn through the dragged shape's own
     * local frame (so it stays a straight line through the shape's rotation on screen) rather than
     * world-axis-aligned, since that's the space the snap itself happened in. */
    #drawSnapGuides(ctx) {
        if (!this._snapGuides) return;
        const FAR = 100000;

        ctx.save();
        ctx.strokeStyle = '#ff4dd8';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);

        const drawLine = (a, b) => {
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
        };

        if (this._snapGuides.space === 'world') {
            if (this._snapGuides.x !== null) drawLine({ x: this._snapGuides.x, y: -FAR }, { x: this._snapGuides.x, y: FAR });
            if (this._snapGuides.y !== null) drawLine({ x: -FAR, y: this._snapGuides.y }, { x: FAR, y: this._snapGuides.y });
        } else {
            const t = this._snapGuides.entity.transform;
            if (this._snapGuides.x !== null) {
                drawLine(Vector2.transform({ x: this._snapGuides.x, y: -FAR }, t), Vector2.transform({ x: this._snapGuides.x, y: FAR }, t));
            }
            if (this._snapGuides.y !== null) {
                drawLine(Vector2.transform({ x: -FAR, y: this._snapGuides.y }, t), Vector2.transform({ x: FAR, y: this._snapGuides.y }, t));
            }
        }

        ctx.setLineDash([]);
        ctx.restore();
    }

    /**
     * True if `entity` is still part of the running scene. `!entity.destroyed` alone isn't
     * enough: GameLoop#revertToSavedLevel (and any other wholesale `this.entities = ...`
     * replacement) drops old entities without ever calling destroy() on them, so a stale
     * selectedEntity/editingVerticesFor reference from before a Reset would otherwise keep
     * reading as "fine" and going on drawing/dragging a shape that's no longer in the scene.
     */
    #isLive(entity) {
        return !!entity && !entity.destroyed && this.gameLoop.entities.includes(entity);
    }

    /**
     * Drops any entity in `group` that's a descendant of another entity ALSO in `group` - without
     * this, manually multi-selecting both a parent and one of its children would move that child
     * twice during a drag: once because it's directly in the drag group, and again because moving
     * its parent already cascades to it via Entity#moveBy. Only the ancestor needs to actually be
     * in the drag list; its descendants come along for free.
     */
    #excludeDescendantsAlreadyInGroup(group) {
        return group.filter(entity => {
            for (let p = entity.parent; p; p = p.parent) {
                if (group.includes(p)) return false;
            }
            return true;
        });
    }

    /** World-space position of vertex `i` of a PolygonRenderer's shape, or -1 if worldPos doesn't
     * land on any of them. */
    #hitTestVertexHandle(entity, renderer, worldPos) {
        const t = entity.transform;
        for (let i = 0; i < renderer.vertices.length; i++) {
            const world = Vector2.transform(renderer.vertices[i], t);
            const dx = worldPos.x - world.x;
            const dy = worldPos.y - world.y;
            if (Math.sqrt(dx * dx + dy * dy) <= VERTEX_HANDLE_RADIUS + 3) return i;
        }
        return -1;
    }

    /** World-space position of vertex `i`'s curve control point, or -1 if worldPos doesn't land on
     * any of them (including vertices with no curve at all, which have no handle to hit). */
    #hitTestCurveHandle(entity, renderer, worldPos) {
        const t = entity.transform;
        for (let i = 0; i < renderer.vertices.length; i++) {
            const v = renderer.vertices[i];
            if (!v.curve) continue;
            const world = Vector2.transform(v.curve, t);
            const dx = worldPos.x - world.x;
            const dy = worldPos.y - world.y;
            if (Math.sqrt(dx * dx + dy * dy) <= CURVE_HANDLE_RADIUS + 3) return i;
        }
        return -1;
    }

    /** Converts a world-space point into `entity`'s local space (inverse of Vector2.transform). */
    #worldToLocal(entity, worldPos) {
        const t = entity.transform;
        const dx = worldPos.x - t.position.x;
        const dy = worldPos.y - t.position.y;
        const rad = -t.rotation * Math.PI / 180;
        return {
            x: dx * Math.cos(rad) - dy * Math.sin(rad),
            y: dx * Math.sin(rad) + dy * Math.cos(rad),
        };
    }

    #bindKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            const active = document.activeElement;
            const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');

            // Tracked independent of the isOpen/Playing guard below (but still not while actually
            // typing in a field) so a held Space never gets stuck "on" by a state change mid-hold -
            // #bindCanvasEvents' mousedown handler is what actually gates panning to Edit/Paused.
            if (e.code === 'Space' && !typing) {
                this._spaceHeld = true;
                e.preventDefault(); // otherwise the page scrolls, or a focused button re-clicks itself
            }

            if (!this.isOpen || this.gameLoop.playState === PlayState.Playing || typing) return;

            const mod = e.metaKey || e.ctrlKey;

            if (mod && e.code === 'KeyZ') {
                e.preventDefault();
                if (e.shiftKey) this.redo(); else this.undo();
            } else if (mod && e.code === 'KeyY') {
                e.preventDefault();
                this.redo();
            } else if (mod && e.code === 'KeyC' && this.selectedEntities.size > 0) {
                e.preventDefault();
                this.#copyEntities([...this.selectedEntities].filter(en => this.#isLive(en)));
            } else if (mod && e.code === 'KeyD' && this.selectedEntities.size > 0) {
                e.preventDefault();
                this.#duplicateEntities([...this.selectedEntities].filter(en => this.#isLive(en)));
            } else if (mod && e.code === 'KeyV' && this._clipboard) {
                e.preventDefault();
                this.#pasteClipboard();
            } else if (e.code === 'KeyT') this.setTool('move');
            else if (e.code === 'KeyR') this.setTool('rotate');
            else if (e.code === 'KeyS') this.setTool('scale');
            else if (e.code === 'Escape') { this.editingVerticesFor = null; this.select(null); }
            else if ((e.code === 'Delete' || e.code === 'Backspace') && this.selectedEntities.size > 0) {
                this.gameLoop.undoStack.push();
                for (const entity of [...this.selectedEntities]) entity.destroy();
                this.select(null);
            }
        });

        window.addEventListener('keyup', (e) => {
            if (e.code === 'Space') this._spaceHeld = false;
        });
    }

    /** Stashes `entities` (serialized - see SceneIO.serializeEntity) as this Inspector's own
     * in-memory clipboard - not the real OS clipboard, since a plain page can't read/write that
     * without its own permission dance, and an internal one is all copy/paste-within-the-editor
     * actually needs. */
    #copyEntities(entities) {
        this._clipboard = entities.map(en => serializeEntity(en));
    }

    /** Duplicates every entity in `entities` (see GameLoop#duplicateEntity) and selects the
     * resulting copies - a structural change (new entities), so it forces the panel's next refresh
     * to fully rebuild rather than just sync existing rows. */
    #duplicateEntities(entities) {
        this.gameLoop.undoStack.push();
        const clones = entities.map(en => this.gameLoop.duplicateEntity(en)).filter(Boolean);
        this.selectedEntities = new Set(clones);
        this.selectedEntity = clones[clones.length - 1] ?? null;
        this.knownIds = [];
        this.#refresh();
    }

    /** Pastes this Inspector's clipboard (see #copyEntities) as fresh entities - works even if the
     * originally-copied entity has since been deleted or the selection has changed, since the
     * clipboard already holds plain, self-contained data rather than a reference to it. */
    #pasteClipboard() {
        if (!this._clipboard?.length) return;
        this.gameLoop.undoStack.push();
        const clones = this._clipboard.map(data => this.gameLoop.pasteEntityData(data)).filter(Boolean);
        this.selectedEntities = new Set(clones);
        this.selectedEntity = clones[clones.length - 1] ?? null;
        this.knownIds = [];
        this.#refresh();
    }

    /** Prompts for a name and saves `entity` as a reusable prefab (see PrefabIO.js) - needs
     * dev_server.py's PUT support the same way scene Save does, so a failure here (a plain static
     * server with no PUT) just logs why rather than pretending it worked. */
    async #saveAsPrefab(entity) {
        const name = await promptDialog('Prefab name:', entity.name);
        if (!name || !name.trim()) return;
        const id = PrefabRegistry.uniqueId(name.trim());
        try {
            await savePrefab(id, name.trim(), serializeEntity(entity));
        } catch (e) {
            console.error('Failed to save prefab (does this page have a dev server with PUT support?):', e);
        }
    }

    /** Creates a fresh Empty at the group's centroid and parents every one of `entities` under it
     * (see Entity#setParent) - the "make a group out of what I've got selected" convenience the
     * plain Parent-dropdown-per-entity route doesn't offer on its own (you'd otherwise have to add
     * the Empty yourself, then set each member's Parent to it one at a time). */
    #groupEntities(entities) {
        if (entities.length === 0) return;
        this.gameLoop.undoStack.push();
        const cx = entities.reduce((sum, e) => sum + e.transform.position.x, 0) / entities.length;
        const cy = entities.reduce((sum, e) => sum + e.transform.position.y, 0) / entities.length;
        const group = this.gameLoop.addEntityFromRegistry(EntityRegistry.get('Empty'));
        group.transform.position.x = cx;
        group.transform.position.y = cy;
        for (const entity of entities) entity.setParent(group);
        this.select(group);
        this.knownIds = [];
        this.#refresh();
    }

    /**
     * Surfaces uncaught exceptions, unhandled promise rejections, console.error calls, and game
     * code's own Debug.Log() calls into the panel's Console section - the browser console isn't
     * visible while this overlay is open (and often not visible at all during normal play), so
     * errors and debug messages from mid-game bugs would otherwise go unnoticed.
     */
    #bindConsoleCapture() {
        const record = (type, message, location, stack) => {
            this.consoleEntries.unshift({
                type,
                message: location ? `${message} (${location})` : message,
                stack,
                time: new Date().toLocaleTimeString(),
            });
            if (this.consoleEntries.length > 50) this.consoleEntries.length = 50;
            this.#renderConsole();
        };

        window.addEventListener('error', (e) => {
            // A plain ErrorEvent's own filename/lineno/colno are more reliable than parsing
            // e.error?.stack (whose exact format varies by browser), and are present even for a
            // syntax error that never got far enough to construct a real Error object at all - so
            // they're preferred when present, falling back to the stack otherwise. Without this,
            // an uncaught "Cannot read properties of undefined" showed as exactly that and nothing
            // else in the visible row - the file/line were there, just buried in the hover-only
            // title tooltip below, easy to miss during actual play-testing.
            const location = e.filename
                ? `${e.filename.split('/').slice(-2).join('/')}:${e.lineno}:${e.colno}`
                : this.#locationFromStack(e.error?.stack);
            record('error', e.message, location, e.error?.stack);
        });
        window.addEventListener('unhandledrejection', (e) => {
            const reason = e.reason;
            const message = 'Unhandled rejection: ' + (reason?.message ?? String(reason));
            record('error', message, this.#locationFromStack(reason?.stack), reason?.stack);
        });

        const originalConsoleError = console.error.bind(console);
        console.error = (...args) => {
            originalConsoleError(...args);
            const errorArg = args.find(a => a instanceof Error);
            const message = args.map(a => (a instanceof Error ? (a.stack ?? a.message) : String(a))).join(' ');
            record('error', message, this.#locationFromStack(errorArg?.stack), errorArg?.stack);
        };

        Debug.onLog((message) => record('log', message, null, null));
    }

    /** A short "file.js:line:col" pulled from an Error's stack's first frame - so a Console row's
     * headline says WHERE something happened without needing to hover it for the full stack
     * (still kept in the row's title tooltip). Just the filename, not the full dev-server URL,
     * since "GameLoop.js:82:9" reads as a location and "http://localhost:9377/js/engine/GameLoop.js:82:9"
     * reads as noise. */
    #locationFromStack(stack) {
        if (!stack) return null;
        const match = stack.match(/([\w.-]+\.js):(\d+):(\d+)/);
        return match ? `${match[1]}:${match[2]}:${match[3]}` : null;
    }

    #renderConsole() {
        this.consoleSection.style.display = this.consoleEntries.length === 0 ? 'none' : 'flex';
        this.consoleTitle.textContent = `Console (${this.consoleEntries.length})`;
        this.consoleListEl.innerHTML = '';

        for (const entry of this.consoleEntries) {
            const row = document.createElement('div');
            row.className = entry.type === 'error' ? 'piston-error-row' : 'piston-log-row';
            row.textContent = `[${entry.time}] ${entry.message}`;
            if (entry.stack) row.title = entry.stack;
            this.consoleListEl.appendChild(row);
        }
    }

    /** World-space position of the given tool's handle for the selected entity, or null if it has none. */
    #handlePosition(tool) {
        const t = this.selectedEntity.transform;
        if (tool === 'rotate') {
            const len = Math.max(t.size.x, t.size.y) / 2 + 24;
            const dir = Vector2.fromAngle(t.rotation, len);
            return { x: t.position.x + dir.x, y: t.position.y + dir.y };
        }
        if (tool === 'scale') {
            const rad = t.rotation * Math.PI / 180;
            const hw = t.size.x / 2, hh = t.size.y / 2;
            const cos = Math.cos(rad), sin = Math.sin(rad);
            return { x: t.position.x + hw * cos - hh * sin, y: t.position.y + hw * sin + hh * cos };
        }
        return null;
    }

    #hitTestHandle(worldPos) {
        const handlePos = this.#handlePosition(this.tool);
        if (!handlePos) return false;
        const dx = worldPos.x - handlePos.x;
        const dy = worldPos.y - handlePos.y;
        return Math.sqrt(dx * dx + dy * dy) <= 10;
    }

    /**
     * Checked front-to-back (topmost first) using the exact same ordering GameLoop's render pass
     * draws with (sortingOrder, ties broken by array/insertion order) - picking by raw array order
     * alone, as this used to, meant clicking two overlapping entities could select whichever was
     * simply added first, even when a sortingOrder had it drawn underneath what you actually see.
     */
    #findEntityAt(event) {
        // Ascending by sortingOrder, so the LAST entry is whatever would actually be drawn on top.
        const hits = this.gameLoop.entities
            .filter(e => !e.destroyed)
            .sort((a, b) => a.getSortingOrder() - b.getSortingOrder())
            // Per-entity, not once for the whole click: a 'Screen' HUD element and a 'World' one
            // can overlap on screen while meaning something different by "this pixel" (see
            // #pointerPosForEntity), so each candidate has to be tested in its own frame.
            .filter(e => this.#pointInEntity(this.#pointerPosForEntity(e, event), e));
        if (hits.length === 0) { this._lastClickHit = null; return null; }

        const topmost = hits[hits.length - 1];

        // A group's anchor (see Entity#setParent - often an Empty sitting at the group's centroid,
        // nowhere near any one member) usually ISN'T separately clickable at this exact pixel, so
        // requiring the ancestor to also be a hit here (an earlier version of this) meant the
        // preference below only ever kicked in for the rare case of a parent and child literally
        // overlapping - in every ordinary "Empty holding a group of walls" case it never fired at
        // all. Walking the parent chain unconditionally instead: clicking ANY member of a group
        // always grabs the group's outermost ancestor first, and only falls through to the actual
        // entity under the cursor on a genuine second click in a row at this same overlap.
        let outermost = topmost;
        for (let p = topmost.parent; p; p = p.parent) outermost = p;

        // Deliberately tracked separately from `selectedEntity`, NOT compared against it directly
        // (an earlier version did) - `selectedEntity` can already equal the outermost ancestor for
        // reasons that have nothing to do with clicking it just now (picked from the entity list,
        // still selected from unrelated earlier work), and treating that as "already selected, so
        // drill down" meant the very first canvas click on a group whose anchor happened to already
        // be selected skipped the group entirely and grabbed the child instead - the opposite of
        // what a first click should do. `_lastClickHit` only remembers what THIS method itself last
        // resolved a canvas click to, so drilling down only happens after an actual, immediately
        // preceding click on this same overlap - any other click (a different entity, blank space)
        // in between resets it.
        const resolved = (outermost !== topmost && this._lastClickHit === outermost) ? topmost : outermost;
        this._lastClickHit = resolved;
        return resolved;
    }

    /**
     * A PolygonRenderer entity is hit-tested against its own actual shape rather than
     * transform.size's generic box - that box is a fixed default (20x20) nothing about a custom
     * polygon ever updates, so a big or oddly-shaped one (most of the visible triangle, say) would
     * otherwise only be clickable/draggable through a tiny hotspot at its center that bears no
     * visible relationship to what's drawn on screen.
     */
    #pointInEntity(worldPos, entity) {
        const t = entity.transform;
        const renderer = entity.getComponent(PolygonRenderer);
        if (renderer) {
            const worldVerts = renderer.vertices.map(v => Vector2.transform(v, t));
            return Inspector.#pointInConvexPolygon(worldPos, worldVerts);
        }

        const dx = worldPos.x - t.position.x;
        const dy = worldPos.y - t.position.y;
        const rad = -t.rotation * Math.PI / 180;
        const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
        const localY = dx * Math.sin(rad) + dy * Math.cos(rad);
        return Math.abs(localX) <= t.size.x / 2 && Math.abs(localY) <= t.size.y / 2;
    }

    /** True iff `point` is on the same side of every edge of `vertices` (in order) - works for
     * either winding direction, same test PolygonCollider uses for its own contact points. */
    static #pointInConvexPolygon(point, vertices) {
        let sign = 0;
        const n = vertices.length;
        for (let i = 0; i < n; i++) {
            const a = vertices[i];
            const b = vertices[(i + 1) % n];
            const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
            if (cross !== 0) {
                const s = Math.sign(cross);
                if (sign === 0) sign = s;
                else if (s !== sign) return false;
            }
        }
        return true;
    }

    /** Keeps a resized entity's actual collision shape in sync with its (gizmo-edited)
     * transform.size - only needed for CircleCollider, whose radius is genuinely independent state
     * (Ball/Hole/Bumper each treat their own radius as the source of truth, not something derived
     * from transform.size). A rect-mode PolygonCollider needs no such step: it reads transform.size
     * live on every getBounds() call (see PolygonCollider#rectVertices), so nothing to keep in sync. */
    #syncColliderSize(entity) {
        const collider = entity.rigidbody?.collider;
        if (collider && 'radius' in collider) {
            collider.radius = Math.max(entity.transform.size.x, entity.transform.size.y) / 2;
        }
    }

    // --- Panel UI ---

    #buildPanel() {
        this.root = document.createElement('div');
        this.root.style.cssText = `
            width: 320px; height: 100%; flex: none;
            display: flex; flex-direction: column;
            font: 12px/1.4 system-ui, sans-serif; color: #ddd;
            background: #1e1e1e; border-left: 1px solid #3a3a3a;
        `;

        const toolRow = document.createElement('div');
        toolRow.style.cssText = 'display:flex; gap:4px; padding:6px 8px; background:#202020; border-bottom:1px solid #3a3a3a; flex:none;';
        this.toolButtons = {};
        for (const [tool, label] of TOOLS) {
            const btn = document.createElement('button');
            btn.textContent = label;
            btn.style.cssText = 'flex:1; cursor:pointer; border:none; border-radius:4px; padding:4px 2px; font:11px system-ui, sans-serif; background:#3a3a3a; color:#fff;';
            btn.addEventListener('click', () => this.setTool(tool));
            this.toolButtons[tool] = btn;
            toolRow.appendChild(btn);
        }

        this.consoleSection = document.createElement('div');
        this.consoleSection.style.cssText = 'flex:none; border-top:1px solid #3a3a3a; display:none; flex-direction:column;';

        const consoleHeader = document.createElement('div');
        consoleHeader.style.cssText = 'display:flex; align-items:center; gap:6px; padding:6px 8px; background:#262626; cursor:pointer;';

        this.consoleTitle = document.createElement('strong');
        this.consoleTitle.style.color = '#ddd';
        this.consoleTitle.textContent = 'Console (0)';

        const consoleSpacer = document.createElement('span');
        consoleSpacer.style.flex = '1';

        const clearConsoleBtn = document.createElement('button');
        clearConsoleBtn.textContent = 'Clear';
        clearConsoleBtn.style.cssText = 'cursor:pointer; border:none; border-radius:4px; background:#3a3a3a; color:#fff; padding:2px 7px; font:inherit;';
        clearConsoleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.consoleEntries = [];
            this.#renderConsole();
        });

        consoleHeader.append(this.consoleTitle, consoleSpacer, clearConsoleBtn);
        consoleHeader.addEventListener('click', () => this.consoleListEl.classList.toggle('collapsed'));

        this.consoleListEl = document.createElement('div');
        this.consoleListEl.className = 'piston-console-list';
        this.consoleListEl.style.cssText = 'overflow-y:auto; max-height:140px; padding:4px 8px; font:11px/1.5 ui-monospace, monospace;';

        this.consoleSection.append(consoleHeader, this.consoleListEl);

        this.statusEl = document.createElement('div');
        this.statusEl.style.cssText = 'padding: 6px 8px; opacity: 0.7; flex: none;';

        this.sceneSection = this.#buildSceneSection();

        this.listEl = document.createElement('div');
        this.listEl.style.cssText = 'padding: 6px; display:flex; flex-direction:column; gap:6px; overflow-y:auto; flex:1;';
        // Right-clicking genuinely blank space in the list (not one of its entity panel children -
        // e.currentTarget/target both being listEl itself is what distinguishes that) opens the same
        // Entity/Prefab Add picker the top bar's own "+ Add ▾" does, so adding something doesn't
        // always require reaching all the way up to the toolbar.
        this.listEl.addEventListener('contextmenu', (e) => {
            if (e.target !== this.listEl || this.gameLoop.playState === PlayState.Playing) return;
            e.preventDefault();
            this.#showAddMenuAt(e.clientX, e.clientY);
        });

        this.root.append(toolRow, this.statusEl, this.sceneSection, this.listEl, this.consoleSection);
        document.getElementById('inspector-root')?.appendChild(this.root) ?? document.body.appendChild(this.root);

        this.#updateToolButtons();
        this.#renderConsole();
    }

    /**
     * Scene-wide settings that don't belong to any one entity - currently just the background
     * color GameLoop clears the canvas to each frame (Scene's own `backgroundColor`, read live
     * every frame, so this takes effect immediately with no extra wiring - see GameLoop#update).
     * Built once, not rebuilt per entity-list refresh: every getter/setter here reads/writes
     * `this.gameLoop.scene` at call time rather than closing over one scene object, so switching
     * scenes (File > New Scene, or picking another one) is picked up for free without needing to
     * know that happened.
     */
    #buildSceneSection() {
        const section = document.createElement('div');
        section.style.cssText = 'padding:6px 8px; border-bottom:1px solid #3a3a3a; flex:none; display:grid; grid-template-columns:1fr auto; gap:4px 8px; align-items:center;';

        const title = document.createElement('div');
        title.style.cssText = 'grid-column:1/-1; font-weight:600; color:#7ec4ff;';

        const bgInput = this.#colorInput(
            () => this.gameLoop.scene?.backgroundColor,
            (v) => { if (this.gameLoop.scene) this.gameLoop.scene.backgroundColor = v; },
        );

        section.append(
            title,
            ...this.#labeled('Background', bgInput),
        );

        section._sync = () => {
            title.textContent = this.gameLoop.scene?.name ?? 'Scene';
            bgInput._sync?.();
        };
        section._sync();
        return section;
    }

    #updateToolButtons() {
        for (const [tool, btn] of Object.entries(this.toolButtons)) {
            const active = tool === this.tool;
            btn.style.background = active ? '#4da6ff' : '#3a3a3a';
            btn.style.color = active ? '#111' : '#fff';
        }
    }

    #injectStylesOnce() {
        if (document.getElementById('piston-inspector-styles')) return;
        const style = document.createElement('style');
        style.id = 'piston-inspector-styles';
        style.textContent = `
            .piston-entity { border: 1px solid #3a3a3a; border-radius: 6px; background: #262626; }
            .piston-entity.selected { outline: 2px solid #4da6ff; }
            .piston-entity-header { display:flex; align-items:center; gap:6px; padding:6px 8px; font-weight:600; cursor:pointer; }
            .piston-entity-header .tag { color:#7ec4ff; }
            .piston-entity-header .id { opacity:0.5; font-weight:400; }
            .piston-entity-header .spacer { flex:1; }
            .piston-entity-body { padding:0 8px 8px 8px; display:grid; grid-template-columns:auto 1fr; gap:4px 8px; align-items:center; }
            .piston-entity-body.collapsed { display:none; }
            .piston-section-title { grid-column:1/-1; margin-top:6px; opacity:0.6; text-transform:uppercase; font-size:10px; letter-spacing:0.05em; }
            .piston-row-label { opacity:0.8; }
            .piston-vec-inputs { display:flex; gap:4px; }
            .piston-entity input[type="number"] { width:56px; background:#1a1a1a; color:#ddd; border:1px solid #3a3a3a; border-radius:3px; padding:2px 4px; font:inherit; }
            .piston-entity input[type="checkbox"] { transform: translateY(1px); }
            .piston-error-row { padding:3px 0; border-bottom:1px solid #3a2020; color:#ff9d9d; white-space:pre-wrap; word-break:break-word; }
            .piston-log-row { padding:3px 0; border-bottom:1px solid #2a2a2a; color:#9dc4ff; white-space:pre-wrap; word-break:break-word; }
            .piston-error-row:last-child, .piston-log-row:last-child { border-bottom:none; }
            .piston-console-list.collapsed { display:none; }
            .piston-component-menu {
                display:none; position:absolute; top:100%; left:0; right:0; z-index:10; margin-top:2px;
                background:#1a1a1a; border:1px solid #3a3a3a; border-radius:4px;
                max-height:220px; overflow-y:auto; padding:4px;
            }
            .piston-component-menu input[type="text"] {
                width:100%; box-sizing:border-box; margin-bottom:4px;
                background:#262626; color:#ddd; border:1px solid #3a3a3a; border-radius:3px; padding:3px 5px; font:inherit;
            }
            .piston-component-group { opacity:0.6; text-transform:uppercase; font-size:10px; letter-spacing:0.05em; margin:4px 2px 2px; }
            .piston-component-item { padding:4px 6px; cursor:pointer; border-radius:3px; }
            .piston-component-item:hover { background:#333; }
            .piston-component-empty { opacity:0.5; padding:4px 6px; }
            .piston-component-section { grid-column:1/-1; }
            .piston-component-title { cursor:pointer; user-select:none; }
            .piston-component-fields { display:grid; grid-template-columns:auto 1fr; gap:4px 8px; align-items:center; margin-top:2px; }
            .piston-component-fields.collapsed { display:none; }
            .piston-context-menu {
                position:fixed; z-index:2147483647; min-width:140px; padding:4px;
                background:#1a1a1a; border:1px solid #3a3a3a; border-radius:4px; box-shadow:0 4px 12px rgba(0,0,0,0.4);
                font:12px/1.4 system-ui, sans-serif; color:#ddd;
            }
            .piston-context-item { padding:5px 8px; cursor:pointer; border-radius:3px; color:#ddd; }
            .piston-context-item:hover { background:#333; }
            .piston-context-item.danger { color:#ff8080; }
        `;
        document.head.appendChild(style);
    }

    #numberInput(getValue, setValue) {
        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.value = round(getValue());
        input.addEventListener('change', () => {
            const v = parseFloat(input.value);
            if (!Number.isNaN(v)) {
                this.gameLoop.undoStack.push();
                setValue(v);
            }
        });
        input._sync = () => {
            if (document.activeElement !== input) input.value = round(getValue());
        };
        return input;
    }

    #checkbox(getValue, setValue) {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!getValue();
        input.addEventListener('change', () => { this.gameLoop.undoStack.push(); setValue(input.checked); });
        input._sync = () => {
            if (document.activeElement !== input) input.checked = !!getValue();
        };
        return input;
    }

    #colorInput(getValue, setValue) {
        const input = document.createElement('input');
        input.type = 'color';
        input.value = getValue() ?? '#000000';
        // Native color pickers fire 'input' continuously while dragging - pushing on every one of
        // those would flood the undo stack with dozens of steps for a single color pick, so this
        // only pushes once per picker session (reset when it's (re)opened via focus).
        let pushedThisSession = false;
        input.addEventListener('focus', () => { pushedThisSession = false; });
        input.addEventListener('input', () => {
            if (!pushedThisSession) { this.gameLoop.undoStack.push(); pushedThisSession = true; }
            setValue(input.value);
        });
        input._sync = () => {
            if (document.activeElement !== input) input.value = getValue() ?? '#000000';
        };
        return input;
    }

    #textInput(getValue, setValue) {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = getValue() ?? '';
        input.addEventListener('change', () => { this.gameLoop.undoStack.push(); setValue(input.value); });
        input._sync = () => {
            if (document.activeElement !== input) input.value = getValue() ?? '';
        };
        return input;
    }

    /** A fixed set of choices (e.g. UIElement's `space` field) rather than free text - `options`
     * is a plain string array, used as both the value and the label. */
    #selectInput(getValue, setValue, options) {
        const select = document.createElement('select');
        select.style.cssText = 'width:100%; background:#1a1a1a; color:#ddd; border:1px solid #3a3a3a; border-radius:3px; padding:2px 4px; font:inherit;';
        for (const option of options) {
            const opt = document.createElement('option');
            opt.value = option;
            opt.textContent = option;
            select.appendChild(opt);
        }
        select.value = getValue();
        select.addEventListener('change', () => { this.gameLoop.undoStack.push(); setValue(select.value); });
        select._sync = () => {
            if (document.activeElement !== select) select.value = getValue();
        };
        return select;
    }

    /**
     * A dropdown listing every other live entity plus "None" - picking one calls entity.setParent()
     * (see Entity.js's own doc comment on parent/children), the only supported way to set it, so
     * both sides of the relationship always stay in sync. `entity` itself and anything already
     * descended from it are left out, the same cycle guard setParent() itself enforces - excluding
     * them here means a doomed choice never even shows up rather than silently failing (with a
     * console.error) after being picked. Rebuilt fresh each panel build, like the rest of
     * #buildEntityPanel, so it reflects whatever entities currently exist.
     */
    #buildParentField(entity) {
        const select = document.createElement('select');
        select.style.cssText = 'width:100%; background:#1a1a1a; color:#ddd; border:1px solid #3a3a3a; border-radius:3px; padding:2px 4px; font:inherit;';

        const isDescendantOfEntity = (candidate) => {
            for (let p = candidate.parent; p; p = p.parent) {
                if (p === entity) return true;
            }
            return false;
        };

        const noneOpt = document.createElement('option');
        noneOpt.value = '';
        noneOpt.textContent = 'None';
        select.appendChild(noneOpt);

        for (const other of this.gameLoop.entities) {
            if (other === entity || other.destroyed || isDescendantOfEntity(other)) continue;
            const opt = document.createElement('option');
            opt.value = other.id;
            opt.textContent = other.name;
            select.appendChild(opt);
        }

        select.value = entity.parent?.id ?? '';
        select.addEventListener('change', () => {
            this.gameLoop.undoStack.push();
            const target = this.gameLoop.entities.find(e => e.id === select.value) ?? null;
            entity.setParent(target);
        });
        select._sync = () => {
            if (document.activeElement !== select) select.value = entity.parent?.id ?? '';
        };
        return select;
    }

    /**
     * A vertex list (PolygonRenderer's shape) as one row of X/Y number fields per point, plus
     * Add/Remove buttons - Add appends a new point just after the last one (offset slightly so it
     * doesn't start exactly on top of it); Remove deletes whichever row is currently selected
     * (click a row to select it) and is disabled until one is. Each row also has a "+ curve" toggle
     * that rounds off the edge to the next point with a quadratic Bezier (see PolygonRenderer's own
     * doc comment on `curve`), revealing its control point's own X/Y fields once added. Edits write
     * straight into the array's own vertex objects, so PolygonCollider (which reads this same array
     * live) picks them up on its very next getBounds() call - no separate commit step.
     */
    #buildVerticesEditor(getValue) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'grid-column:1/-1; margin-top:2px;';

        const rows = document.createElement('div');
        rows.style.cssText = 'display:flex; flex-direction:column; gap:2px;';

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex; gap:4px; margin-top:4px;';

        const addBtn = document.createElement('button');
        addBtn.textContent = '+ Add';
        addBtn.style.cssText = 'flex:1; cursor:pointer; border:none; border-radius:3px; padding:3px; font:inherit; background:#2d4a2d; color:#bfe6bf;';

        const removeBtn = document.createElement('button');
        removeBtn.textContent = '- Remove';
        removeBtn.disabled = true;
        removeBtn.style.cssText = 'flex:1; cursor:pointer; border:none; border-radius:3px; padding:3px; font:inherit; background:#4a2d2d; color:#e6bfbf; opacity:0.5;';

        let selectedIndex = null;

        const renderRows = () => {
            rows.innerHTML = '';
            const vertices = getValue();
            vertices.forEach((v, i) => {
                const rowWrap = document.createElement('div');
                rowWrap.style.cssText = 'display:flex; flex-direction:column; gap:2px;';

                const row = document.createElement('div');
                row.style.cssText = `display:flex; gap:4px; align-items:center; padding:2px; border-radius:3px; cursor:pointer; background:${i === selectedIndex ? '#2d4a6a' : 'transparent'};`;

                const xInput = this.#numberInput(() => v.x, (val) => { v.x = val; });
                const yInput = this.#numberInput(() => v.y, (val) => { v.y = val; });
                // A click into either field edits it - it shouldn't also toggle row selection
                // (the row's own listener is on 'click', so that's the event to stop here too).
                xInput.addEventListener('click', (e) => e.stopPropagation());
                yInput.addEventListener('click', (e) => e.stopPropagation());

                // Curves the edge from this vertex to the next one (see PolygonRenderer's own doc
                // comment on `curve`) - toggling it on plants the control point at that edge's
                // midpoint as a sane starting default, then it's draggable on the canvas (in Edit
                // Vertices mode) or fine-tunable with the X/Y fields that appear below once curved.
                const curveBtn = document.createElement('button');
                curveBtn.style.cssText = 'cursor:pointer; border:none; border-radius:3px; padding:2px 6px; font:10px inherit; white-space:nowrap; background:#2d3a4a; color:#9fc6e6;';
                curveBtn.textContent = v.curve ? '✕ curve' : '+ curve';
                curveBtn.title = v.curve ? 'Make this edge straight again' : 'Curve this edge toward the next point';
                curveBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.gameLoop.undoStack.push();
                    if (v.curve) {
                        delete v.curve;
                    } else {
                        const next = vertices[(i + 1) % vertices.length];
                        v.curve = { x: (v.x + next.x) / 2, y: (v.y + next.y) / 2 };
                    }
                    renderRows();
                });

                row.addEventListener('click', () => {
                    selectedIndex = selectedIndex === i ? null : i;
                    removeBtn.disabled = selectedIndex === null;
                    removeBtn.style.opacity = removeBtn.disabled ? '0.5' : '1';
                    renderRows();
                });

                row.append(xInput, yInput, curveBtn);
                rowWrap.appendChild(row);

                if (v.curve) {
                    const curveRow = document.createElement('div');
                    curveRow.style.cssText = 'display:flex; gap:4px; align-items:center; padding:0 2px 2px 16px;';
                    const arrow = document.createElement('span');
                    arrow.textContent = '↳';
                    arrow.style.cssText = 'opacity:0.5; font-size:11px;';
                    const cxInput = this.#numberInput(() => v.curve.x, (val) => { v.curve.x = val; });
                    const cyInput = this.#numberInput(() => v.curve.y, (val) => { v.curve.y = val; });
                    curveRow.append(arrow, cxInput, cyInput);
                    rowWrap.appendChild(curveRow);
                }

                rows.appendChild(rowWrap);
            });
        };

        addBtn.addEventListener('click', () => {
            this.gameLoop.undoStack.push();
            const vertices = getValue();
            const last = vertices[vertices.length - 1] ?? { x: 0, y: 0 };
            vertices.push({ x: last.x + 10, y: last.y + 10 });
            renderRows();
        });

        removeBtn.addEventListener('click', () => {
            if (selectedIndex === null) return;
            const vertices = getValue();
            if (vertices.length <= 3) return; // keep a valid polygon - a triangle is the floor
            this.gameLoop.undoStack.push();
            vertices.splice(selectedIndex, 1);
            selectedIndex = null;
            removeBtn.disabled = true;
            removeBtn.style.opacity = '0.5';
            renderRows();
        });

        renderRows();
        actions.append(addBtn, removeBtn);
        wrapper.append(rows, actions);
        // The entity panel's periodic refresh syncs every <input> under it by querySelectorAll,
        // so re-rendered rows are picked up automatically - no per-row _sync bookkeeping needed.
        return wrapper;
    }

    /**
     * An { actionName: keyToken } map (InputController's `bindings`) as one row per action: a
     * name field, a plain-text key/button token field ('Space', 'KeyW', 'Mouse0'...), and a remove
     * button, plus an "+ Add" that appends a fresh, uniquely-named row. No "press a key to bind"
     * capture UI - typing the exact token is more bells-and-whistles than a first pass needed, and
     * matches how every other free-text Inspector field already works.
     */
    #buildBindingsEditor(getValue) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'grid-column:1/-1; margin-top:2px;';

        const rows = document.createElement('div');
        rows.style.cssText = 'display:flex; flex-direction:column; gap:2px;';

        const addBtn = document.createElement('button');
        addBtn.textContent = '+ Add';
        addBtn.style.cssText = 'width:100%; margin-top:4px; cursor:pointer; border:none; border-radius:3px; padding:3px; font:inherit; background:#2d4a2d; color:#bfe6bf;';

        const renderRows = () => {
            rows.innerHTML = '';
            const bindings = getValue();
            for (const action of Object.keys(bindings)) {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex; gap:4px; align-items:center;';

                const nameInput = document.createElement('input');
                nameInput.type = 'text';
                nameInput.value = action;
                nameInput.placeholder = 'action';
                nameInput.style.cssText = 'width:64px; background:#1a1a1a; color:#ddd; border:1px solid #3a3a3a; border-radius:3px; padding:2px 4px; font:inherit;';
                nameInput.addEventListener('change', () => {
                    const newName = nameInput.value.trim();
                    if (!newName || newName === action || newName in bindings) { renderRows(); return; }
                    this.gameLoop.undoStack.push();
                    const key = bindings[action];
                    delete bindings[action];
                    bindings[newName] = key;
                    renderRows();
                });

                const keyInput = this.#textInput(() => bindings[action], (v) => { bindings[action] = v; });
                keyInput.placeholder = 'e.g. Space, Mouse0';

                const removeBtn = document.createElement('button');
                removeBtn.textContent = '✕';
                removeBtn.style.cssText = 'cursor:pointer; border:none; border-radius:3px; padding:2px 6px; font:inherit; background:#4a2d2d; color:#e6bfbf;';
                removeBtn.addEventListener('click', () => {
                    this.gameLoop.undoStack.push();
                    delete bindings[action];
                    renderRows();
                });

                row.append(nameInput, keyInput, removeBtn);
                rows.appendChild(row);
            }
        };

        addBtn.addEventListener('click', () => {
            this.gameLoop.undoStack.push();
            const bindings = getValue();
            let name = 'action';
            let n = 2;
            while (name in bindings) { name = `action${n}`; n++; }
            bindings[name] = '';
            renderRows();
        });

        renderRows();
        wrapper.append(rows, addBtn);
        return wrapper;
    }

    #labeled(label, ...controls) {
        const row1 = document.createElement('div');
        row1.className = 'piston-row-label';
        row1.textContent = label;
        const row2 = document.createElement('div');
        row2.className = 'piston-vec-inputs';
        row2.append(...controls);
        return [row1, row2];
    }

    #sectionTitle(text) {
        const el = document.createElement('div');
        el.className = 'piston-section-title';
        el.textContent = text;
        return el;
    }

    /**
     * A small right-click popup: `items` is [{ label, danger?, onClick }]. Only one is ever open -
     * each call removes any previous one - and it closes itself on the next outside click.
     */
    #showContextMenu(x, y, items) {
        document.querySelectorAll('.piston-context-menu').forEach(m => m.remove());

        const menu = document.createElement('div');
        menu.className = 'piston-context-menu';
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.addEventListener('click', (e) => e.stopPropagation());

        for (const item of items) {
            const el = document.createElement('div');
            el.className = 'piston-context-item' + (item.danger ? ' danger' : '');
            el.textContent = item.label;
            el.addEventListener('click', () => {
                item.onClick();
                menu.remove();
            });
            menu.appendChild(el);
        }

        document.body.appendChild(menu);
        // Deferred so the click that opened the menu (already bubbled to document by now in most
        // browsers, but not guaranteed mid-dispatch) doesn't immediately close it again.
        setTimeout(() => {
            document.addEventListener('click', () => menu.remove(), { once: true });
        }, 0);
    }

    /** The same Entity/Prefab picker the top bar's "+ Add ▾" opens (see AddMenu.js), popped up at
     * a right-click point instead of docked under a button - used by the entity list's own
     * right-click-on-empty-space handler above. */
    #showAddMenuAt(x, y) {
        document.querySelectorAll('.piston-context-menu').forEach(m => m.remove());

        const menu = document.createElement('div');
        menu.className = 'piston-context-menu';
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.addEventListener('click', (e) => e.stopPropagation());
        menu.appendChild(buildAddMenuContent(async (kind, key) => {
            this.gameLoop.undoStack.push();
            const entity = kind === 'entity'
                ? this.gameLoop.addEntityFromRegistry(EntityRegistry.get(key))
                : await this.gameLoop.addPrefabInstance(key);
            this.select(entity);
            this.knownIds = [];
            this.#refresh();
            menu.remove();
        }));

        document.body.appendChild(menu);
        setTimeout(() => {
            document.addEventListener('click', () => menu.remove(), { once: true });
        }, 0);
    }

    /**
     * One component's Inspector section: a clickable title that collapses/expands its fields
     * (collapsed by default - see #buildEntityPanel) and can be right-clicked to remove the
     * component, plus the fields themselves, driven entirely by that component's own static
     * `fields` descriptor. This is what lets any Component (engine-provided or a game's own custom
     * logic) show up in the Inspector without Inspector needing to know anything about it
     * specifically, the same way Rigidbody/Collider above are hand-written because they predate
     * this mechanism.
     */
    #buildComponentSection(entity, component) {
        const wrapper = document.createElement('div');
        wrapper.className = 'piston-component-section';

        const title = document.createElement('div');
        title.className = 'piston-section-title piston-component-title';
        title.textContent = component.constructor.name;
        title.addEventListener('click', () => {
            fields.classList.toggle('collapsed');
            if (fields.classList.contains('collapsed')) this.expandedComponents.delete(component);
            else this.expandedComponents.add(component);
        });
        title.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.#showContextMenu(e.clientX, e.clientY, [{
                label: 'Remove Component',
                danger: true,
                onClick: () => {
                    this.gameLoop.undoStack.push();
                    entity.components = entity.components.filter(c => c !== component);
                    this.#rebuildEntityPanel(entity); // so the removed section disappears
                },
            }]);
        });

        const fields = document.createElement('div');
        fields.className = 'piston-component-fields' + (this.expandedComponents.has(component) ? '' : ' collapsed');

        // A PolygonRenderer's shape is edited directly on the canvas (dragging its points) rather
        // than through a generic field - toggled here, exclusively, rather than living alongside
        // Move/Rotate/Scale as another global tool, since it only ever applies to one specific
        // shape at a time. Computed fresh at build time (rather than tracking "the active button"
        // across rebuilds) so it still shows correctly active after e.g. adding an entity forces
        // every panel to rebuild while this one's toggle was already on.
        if (component instanceof PolygonRenderer) {
            const isActive = this.editingVerticesFor?.renderer === component;
            const toggleBtn = document.createElement('button');
            toggleBtn.style.cssText = `grid-column:1/-1; margin-bottom:4px; cursor:pointer; border:none; border-radius:4px; padding:5px; font:inherit; font-weight:600;
                background:${isActive ? '#4da6ff' : '#2d4a6a'}; color:${isActive ? '#111' : '#bfe0ff'};`;
            toggleBtn.textContent = isActive ? '✓ Editing Vertices (click to stop)' : 'Edit Vertices';
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // don't also toggle this section's collapsed state
                this.editingVerticesFor = isActive ? null : { entity, renderer: component };
                this.expandedComponents.add(component); // stay open across the rebuild below
                this.#rebuildEntityPanel(entity); // recomputes this toggle button's active state
            });
            fields.appendChild(toggleBtn);
        }

        // A spritesheet's grid (cell size, columns, frame count) is far easier to pin down by eye
        // against the actual image than by guessing pixel numbers blind - see #openSpriteSheetEditor.
        if (component instanceof SpriteRenderer) {
            const editBtn = document.createElement('button');
            editBtn.textContent = 'Edit Spritesheet…';
            editBtn.style.cssText = 'grid-column:1/-1; margin-bottom:4px; cursor:pointer; border:none; border-radius:4px; padding:5px; font:inherit; font-weight:600; background:#2d4a6a; color:#bfe0ff;';
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // don't also toggle this section's collapsed state
                this.#openSpriteSheetEditor(component);
            });
            fields.appendChild(editBtn);
        }

        this.#appendFields(fields, component, component.constructor.fields ?? []);

        wrapper.append(title, fields);
        return wrapper;
    }

    /**
     * Renders one [{ key, label, type }] field descriptor list (Component.fields or Entity.fields)
     * as Inspector rows bound directly to `target[field.key]`, appended into `container`. Shared by
     * #buildComponentSection and #buildEntityPanel's own entity-level settings so both mechanisms
     * (which are otherwise separate - a Component's fields vs. an Entity's own) stay in sync rather
     * than drifting into two slightly different field-rendering implementations.
     */
    #appendFields(container, target, fieldDefs) {
        for (const field of fieldDefs) {
            const getValue = () => target[field.key];

            // A vertex list needs its own row of Add/Remove buttons plus one X/Y pair per point,
            // not a single label+control pair like every other field type below.
            if (field.type === 'vertices') {
                const label = document.createElement('div');
                label.className = 'piston-row-label';
                label.style.gridColumn = '1/-1';
                label.textContent = field.label ?? field.key;
                container.append(label, this.#buildVerticesEditor(getValue));
                continue;
            }

            // An action-name -> key/button-token map (InputController's `bindings`) needs its own
            // row of Add/Remove buttons plus two text fields per row, not a single label+control
            // pair like every other field type here - same shape as the 'vertices' case above.
            if (field.type === 'bindings') {
                const label = document.createElement('div');
                label.className = 'piston-row-label';
                label.style.gridColumn = '1/-1';
                label.textContent = field.label ?? field.key;
                container.append(label, this.#buildBindingsEditor(getValue));
                continue;
            }

            const setValue = (v) => { target[field.key] = v; };
            let control;
            if (field.type === 'checkbox') control = this.#checkbox(getValue, setValue);
            else if (field.type === 'color') control = this.#colorInput(getValue, setValue);
            else if (field.type === 'text') control = this.#textInput(getValue, setValue);
            else if (field.type === 'select') control = this.#selectInput(getValue, setValue, field.options);
            else control = this.#numberInput(getValue, setValue);
            container.append(...this.#labeled(field.label ?? field.key, control));
        }
    }

    /**
     * A modal for pinning down a spritesheet's grid by eye instead of guessing pixel numbers -
     * click where one frame ends (its bottom-right corner) on the actual image, see the grid lines
     * land, and scrub through frames to confirm each one crops cleanly before committing. Edits a
     * working copy; nothing touches the live component until Apply.
     */
    #openSpriteSheetEditor(component) {
        const image = component.image;

        const state = {
            cellWidth: component.frameWidth || image?.width || 32,
            cellHeight: component.frameHeight || image?.height || 32,
            columns: component.columns || 1,
            frameCount: component.frameCount || 1,
            currentFrame: 0,
        };

        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position:fixed; inset:0; background:rgba(0,0,0,0.65); z-index:1000;
            display:flex; align-items:center; justify-content:center;
        `;
        overlay.addEventListener('click', () => overlay.remove()); // click outside closes

        const panel = document.createElement('div');
        panel.style.cssText = `
            background:#1e1e1e; border:1px solid #3a3a3a; border-radius:8px; padding:16px;
            display:flex; flex-direction:column; gap:10px; max-width:90vw; max-height:90vh; overflow:auto;
            font:12px system-ui, sans-serif; color:#ddd;
        `;
        panel.addEventListener('click', (e) => e.stopPropagation());

        const title = document.createElement('div');
        title.style.cssText = 'font-weight:600; font-size:13px;';
        title.textContent = `Edit Spritesheet - ${component.imagePath || '(no image set)'}`;

        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'border:1px solid #3a3a3a; cursor:crosshair; image-rendering:pixelated; background:#111; align-self:flex-start;';

        const hint = document.createElement('div');
        hint.style.cssText = 'opacity:0.6; font-size:11px; max-width:480px;';
        hint.textContent = image
            ? "Click a frame's bottom-right corner on the image to set its size - columns and frame count are guessed from that and the image size, and stay editable below."
            : 'No image loaded yet - set an Image Path above first, then reopen this.';

        const fieldsGrid = document.createElement('div');
        fieldsGrid.style.cssText = 'display:grid; grid-template-columns:auto 64px auto 64px; gap:6px 10px; align-items:center;';

        const numInput = (getValue, setValue) => {
            const input = document.createElement('input');
            input.type = 'number';
            input.min = '1';
            input.style.cssText = 'width:56px; background:#1a1a1a; color:#ddd; border:1px solid #3a3a3a; border-radius:3px; padding:2px 4px; font:inherit;';
            input.value = getValue();
            input.addEventListener('change', () => {
                const v = parseInt(input.value, 10);
                if (Number.isFinite(v) && v > 0) { setValue(v); redraw(); }
                else input.value = getValue();
            });
            return input;
        };
        const fieldLabel = (text) => {
            const span = document.createElement('span');
            span.style.opacity = '0.8';
            span.textContent = text;
            return span;
        };

        const cwInput = numInput(() => state.cellWidth, (v) => state.cellWidth = v);
        const chInput = numInput(() => state.cellHeight, (v) => state.cellHeight = v);
        const colsInput = numInput(() => state.columns, (v) => state.columns = v);
        const countInput = numInput(() => state.frameCount, (v) => {
            state.frameCount = v;
            scrubber.max = String(Math.max(0, v - 1));
        });

        fieldsGrid.append(
            fieldLabel('Cell Width'), cwInput, fieldLabel('Cell Height'), chInput,
            fieldLabel('Columns'), colsInput, fieldLabel('Frame Count'), countInput,
        );

        const previewRow = document.createElement('div');
        previewRow.style.cssText = 'display:flex; align-items:center; gap:8px;';

        const scrubberLabel = document.createElement('span');
        scrubberLabel.style.opacity = '0.8';
        scrubberLabel.textContent = 'Preview frame:';

        const scrubber = document.createElement('input');
        scrubber.type = 'range';
        scrubber.min = '0';
        scrubber.max = String(Math.max(0, state.frameCount - 1));
        scrubber.value = '0';
        scrubber.style.flex = '1';
        scrubber.addEventListener('input', () => {
            state.currentFrame = parseInt(scrubber.value, 10);
            redrawPreview();
        });

        const previewCanvas = document.createElement('canvas');
        previewCanvas.style.cssText = 'border:1px solid #3a3a3a; image-rendering:pixelated; background:#111;';

        previewRow.append(scrubberLabel, scrubber, previewCanvas);

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex; gap:8px; justify-content:flex-end; margin-top:6px;';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'cursor:pointer; border:none; border-radius:4px; padding:6px 14px; font:inherit; background:#3a3a3a; color:#fff;';
        cancelBtn.addEventListener('click', () => overlay.remove());

        const applyBtn = document.createElement('button');
        applyBtn.textContent = 'Apply';
        applyBtn.disabled = !image;
        applyBtn.style.cssText = `cursor:${image ? 'pointer' : 'default'}; border:none; border-radius:4px; padding:6px 14px; font:inherit; font-weight:600;
            background:${image ? '#2d6a4d' : '#3a3a3a'}; color:${image ? '#bfe6cf' : '#777'};`;
        applyBtn.addEventListener('click', () => {
            if (!image) return;
            component.frameWidth = state.cellWidth;
            component.frameHeight = state.cellHeight;
            component.columns = state.columns;
            component.frameCount = state.frameCount;
            overlay.remove();
            this.#rebuildEntityPanel(component.entity); // so the field rows below reflect the new numbers
        });

        actions.append(cancelBtn, applyBtn);

        const DISPLAY_MAX = 480;
        const scale = image ? Math.min(1, DISPLAY_MAX / image.width) : 1;

        const redraw = () => {
            if (!image) return;
            canvas.width = Math.round(image.width * scale);
            canvas.height = Math.round(image.height * scale);
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

            ctx.strokeStyle = 'rgba(77, 166, 255, 0.9)';
            ctx.lineWidth = 1;
            const cw = state.cellWidth * scale;
            const ch = state.cellHeight * scale;
            for (let x = 0; x <= canvas.width + 0.5; x += cw) {
                ctx.beginPath();
                ctx.moveTo(Math.floor(x) + 0.5, 0);
                ctx.lineTo(Math.floor(x) + 0.5, canvas.height);
                ctx.stroke();
            }
            for (let y = 0; y <= canvas.height + 0.5; y += ch) {
                ctx.beginPath();
                ctx.moveTo(0, Math.floor(y) + 0.5);
                ctx.lineTo(canvas.width, Math.floor(y) + 0.5);
                ctx.stroke();
            }
            redrawPreview();
        };

        const redrawPreview = () => {
            if (!image) return;
            previewCanvas.width = state.cellWidth;
            previewCanvas.height = state.cellHeight;
            const pctx = previewCanvas.getContext('2d');
            pctx.imageSmoothingEnabled = false;
            pctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
            const col = state.currentFrame % state.columns;
            const row = Math.floor(state.currentFrame / state.columns);
            pctx.drawImage(
                image,
                col * state.cellWidth, row * state.cellHeight, state.cellWidth, state.cellHeight,
                0, 0, state.cellWidth, state.cellHeight
            );
        };

        canvas.addEventListener('click', (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) / scale;
            const y = (e.clientY - rect.top) / scale;
            state.cellWidth = Math.max(1, Math.round(x));
            state.cellHeight = Math.max(1, Math.round(y));
            cwInput.value = state.cellWidth;
            chInput.value = state.cellHeight;
            // A fresh guess at columns/frame count from the new cell size and the image's actual
            // dimensions - just a starting point, since a real sheet's edge frames don't always
            // divide evenly; the fields stay directly editable to correct it.
            state.columns = Math.max(1, Math.round(image.width / state.cellWidth));
            const rows = Math.max(1, Math.round(image.height / state.cellHeight));
            state.frameCount = state.columns * rows;
            colsInput.value = state.columns;
            countInput.value = state.frameCount;
            scrubber.max = String(Math.max(0, state.frameCount - 1));
            redraw();
        });

        panel.append(title, canvas, hint, fieldsGrid, previewRow, actions);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        if (image) redraw();
    }

    /** A "+ Add Component" button that opens a searchable, Engine/Game-grouped list from ComponentRegistry. */
    #buildAddComponentMenu(entity) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'position:relative; margin-top:6px;';

        const addBtn = document.createElement('button');
        addBtn.textContent = '+ Add Component';
        addBtn.style.cssText = 'width:100%; cursor:pointer; border:none; border-radius:4px; padding:5px; font:inherit; background:#2d4a2d; color:#bfe6bf;';

        const menu = document.createElement('div');
        menu.className = 'piston-component-menu';

        const search = document.createElement('input');
        search.type = 'text';
        search.placeholder = 'Search components...';

        const results = document.createElement('div');

        const renderGroup = (label, list) => {
            if (list.length === 0) return;
            const header = document.createElement('div');
            header.className = 'piston-component-group';
            header.textContent = label;
            results.appendChild(header);
            for (const { name, ComponentClass } of list) {
                const item = document.createElement('div');
                item.className = 'piston-component-item';
                item.textContent = name;
                item.addEventListener('click', () => {
                    this.gameLoop.undoStack.push();
                    entity.addComponent(new ComponentClass());
                    menu.style.display = 'none';
                    // A new component doesn't change the entity id list, so #refresh's own
                    // reconciliation wouldn't notice it - rebuild this one entity's panel directly.
                    this.#rebuildEntityPanel(entity);
                });
                results.appendChild(item);
            }
        };

        const renderResults = () => {
            results.innerHTML = '';
            const { engine, game } = ComponentRegistry.search(search.value);
            renderGroup('Engine', engine);
            renderGroup('Game', game);
            if (engine.length === 0 && game.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'piston-component-empty';
                empty.textContent = 'No matches';
                results.appendChild(empty);
            }
        };

        search.addEventListener('input', renderResults);
        menu.addEventListener('click', (e) => e.stopPropagation());

        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = menu.style.display === 'block';
            for (const m of document.querySelectorAll('.piston-component-menu')) m.style.display = 'none';
            if (!isOpen) {
                search.value = '';
                renderResults();
                menu.style.display = 'block';
                search.focus();
            }
        });

        menu.append(search, results);
        wrapper.append(addBtn, menu);
        return wrapper;
    }

    /** Left-indents `panel` by its entity's depth in the parent chain - purely visual (doesn't touch
     * the entity's own transform), just what makes the flat panel list in the sidebar actually read
     * as a hierarchy instead of a parent and child happening to both appear somewhere in it (see
     * #orderedForDisplay for the other half: the ordering that puts them next to each other at all).
     * Called both when a panel is first built and, on reconciliation, when an existing one's entity
     * may have been reparented since - see #refresh(). */
    #applyIndent(panel, entity) {
        const depth = this.#depthOf(entity);
        panel.style.marginLeft = depth > 0 ? `${depth * 14}px` : '0';
        // The "↳" branch glyph (see #buildEntityPanel) is built once but has to track the SAME
        // depth-changes-without-a-reorder case this method exists for in the first place (see
        // #refresh()'s own doc comment) - a reused panel whose entity got un-parented needs this
        // hidden again, not just its indent reset.
        if (panel._branchEl) panel._branchEl.style.display = depth > 0 ? '' : 'none';
    }

    /** How many parents deep `entity` is - 0 for a root. Shared by #applyIndent (the panel list's
     * visual indent) and #refresh's own change-detection (see its doc comment on `structureKey`). */
    #depthOf(entity) {
        let depth = 0;
        for (let p = entity.parent; p; p = p.parent) depth++;
        return depth;
    }

    /**
     * Depth-first: each root entity (no parent, or a parent that isn't itself in `entities` - a
     * defensive fallback, not something Entity#destroy's own orphaning should ever actually leave
     * behind) immediately followed by all of its own descendants, recursively. This is what makes
     * #refresh()'s panel list actually order itself as a hierarchy rather than gameLoop.entities'
     * own arbitrary creation/add order, which has no relationship to who's parented to whom.
     */
    #orderedForDisplay(entities) {
        const set = new Set(entities);
        const isRoot = (e) => !e.parent || !set.has(e.parent);
        const result = [];
        const visit = (e) => {
            result.push(e);
            for (const child of e.children) {
                if (set.has(child)) visit(child);
            }
        };
        for (const e of entities) {
            if (isRoot(e)) visit(e);
        }
        return result;
    }

    #buildEntityPanel(entity) {
        const panel = document.createElement('div');
        panel.className = 'piston-entity';

        const header = document.createElement('div');
        header.className = 'piston-entity-header';

        // A small "↳" for anything with a parent (see Entity#setParent/#orderedForDisplay) - the
        // indent alone reads fine once you know to look for it, but a lone glance down the list
        // otherwise gives no hint that indentation even means anything. Always built (its
        // visibility, like the indent itself, is #applyIndent's job - both need to stay in sync
        // with whatever `entity.parent` becomes AFTER this panel was first built, e.g. reparenting
        // via the Parent dropdown), and stashed on the panel so #applyIndent can find it again on a
        // later reconciliation without having to rebuild the whole header from scratch. Actually
        // applying the initial indent/visibility has to wait until AFTER this is stashed below -
        // #applyIndent looks for panel._branchEl, which doesn't exist yet at this point.
        const branch = document.createElement('span');
        branch.textContent = '↳';
        branch.style.cssText = 'opacity:0.45; display:none;';
        panel._branchEl = branch;
        header.appendChild(branch);
        this.#applyIndent(panel, entity);

        // This entity's `name` (its own display label - see Entity.js's doc comment), NOT `tag`
        // (the shared category label several entities can intentionally have in common). Kept as
        // its own header element/variable named `nameLabel` rather than `tag`, since it used to
        // literally be entity.tag before name/tag were split apart into separate concepts.
        const nameLabel = document.createElement('span');
        nameLabel.className = 'tag';
        nameLabel.textContent = entity.name;
        nameLabel.title = 'Double-click to rename';

        // Double-click swaps the label for a text input; Enter/blur commits, Escape cancels. Also
        // stops the click(s) a dblclick is composed of from bubbling to the header's own click
        // listener below, which would otherwise toggle the panel's collapsed state at the same time.
        nameLabel.addEventListener('dblclick', (e) => {
            e.stopPropagation();

            const input = document.createElement('input');
            input.type = 'text';
            input.value = entity.name;
            input.style.cssText = 'font:inherit; font-weight:600; color:#7ec4ff; background:#1a1a1a; border:1px solid #4da6ff; border-radius:3px; padding:1px 3px; width:10ch;';
            input.addEventListener('click', (e) => e.stopPropagation());
            input.addEventListener('mousedown', (e) => e.stopPropagation());

            const commit = () => {
                const newName = input.value.trim();
                if (newName) entity.name = newName;
                nameLabel.textContent = entity.name;
                input.replaceWith(nameLabel);
            };
            input.addEventListener('blur', commit, { once: true });
            input.addEventListener('keydown', (e) => {
                e.stopPropagation();
                // Checks both code and key (rather than just the physical-key `code` the file's
                // shortcut bindings elsewhere use) - this is ordinary text-field editing, not a
                // layout-sensitive shortcut, so it should recognize Enter/Escape however an input
                // method reports them.
                if (e.code === 'Enter' || e.key === 'Enter') input.blur();
                else if (e.code === 'Escape' || e.key === 'Escape') { input.value = entity.name; input.blur(); }
            });

            nameLabel.replaceWith(input);
            input.focus();
            input.select();
        });

        const id = document.createElement('span');
        id.className = 'id';
        id.textContent = '#' + entity.id.slice(-6);

        const spacer = document.createElement('span');
        spacer.className = 'spacer';

        header.append(nameLabel, id, spacer);

        header.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Right-clicking a member of an active multi-selection acts on the whole selection;
            // right-clicking anything else (an unselected entity, or a lone selection) acts on just
            // that one - standard editor convention, and consistent with dragging (#bindCanvasEvents).
            const targets = this.isSelected(entity) && this.selectedEntities.size > 1
                ? [...this.selectedEntities].filter(en => this.#isLive(en))
                : [entity];
            const plural = targets.length > 1 ? ` (${targets.length})` : '';
            this.#showContextMenu(e.clientX, e.clientY, [
                { label: `Copy${plural}`, onClick: () => this.#copyEntities(targets) },
                { label: `Duplicate${plural}`, onClick: () => this.#duplicateEntities(targets) },
                ...(targets.length === 1 ? [{ label: 'Save as Prefab…', onClick: () => this.#saveAsPrefab(targets[0]) }] : []),
                ...(targets.length > 1 ? [{ label: `Group ${targets.length} into New Empty`, onClick: () => this.#groupEntities(targets) }] : []),
                {
                    label: `Delete Entity${plural}`,
                    danger: true,
                    onClick: () => {
                        this.gameLoop.undoStack.push();
                        for (const en of targets) en.destroy();
                        this.select(null);
                    },
                },
            ]);
        });

        const body = document.createElement('div');
        body.className = 'piston-entity-body' + (this.expandedEntityIds.has(entity.id) ? '' : ' collapsed');

        header.addEventListener('click', (e) => {
            // Shift/Ctrl/Cmd-click toggles this entity in/out of the multi-selection instead of
            // expanding/collapsing it - the same modifier convention as clicking on the canvas
            // (see #bindCanvasEvents), just from the list instead.
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                this.toggleSelection(entity);
                return;
            }
            body.classList.toggle('collapsed');
            if (body.classList.contains('collapsed')) this.expandedEntityIds.delete(entity.id);
            else this.expandedEntityIds.add(entity.id);
            this.select(entity);
        });

        const t = entity.transform;
        body.append(
            // No separate Name field here - the header's own double-click-to-rename already edits
            // entity.name, and shows the current value there too, so a second copy of the same
            // field in the body was pure duplication.
            // The shared category label - what GameLoop#findObjectWithTag()/other game code
            // actually groups/looks entities up by (several entities can share one on purpose,
            // unlike Name above). Had no UI at all before this - see Entity.js's own doc comment
            // on the name/tag split.
            ...this.#labeled('Tag', this.#textInput(() => entity.tag, v => entity.tag = v)),
            // Grouping (see Entity.js's own doc comment on parent/children) - picking one here is
            // the only supported way to set it, so both sides of the relationship always stay
            // consistent (see Entity#setParent).
            ...this.#labeled('Parent', this.#buildParentField(entity)),
            ...this.#labeled('Position',
                // Delta-based (not a plain assignment) so moving a parent also cascades to its
                // children (see Entity#moveBy) - the same reason the canvas Move-tool drag computes
                // a delta and calls moveBy() rather than setting t.position directly (see
                // #bindCanvasEvents). An entity with no children just moves itself, same as before.
                this.#numberInput(() => t.position.x, v => entity.moveBy(v - t.position.x, 0)),
                this.#numberInput(() => t.position.y, v => entity.moveBy(0, v - t.position.y))),
            ...this.#labeled('Rotation', this.#numberInput(() => t.rotation, v => t.rotation = v)),
            ...this.#labeled('Size',
                this.#numberInput(() => t.size.x, v => t.size.x = v),
                this.#numberInput(() => t.size.y, v => t.size.y = v)),
        );

        // This entity subclass's own tunable settings (Ball's drag/power constants, etc.) - opt-in
        // via a static `fields` list the same shape Component.fields already uses (see Entity.js).
        if (entity.constructor.fields?.length) {
            body.append(this.#sectionTitle(entity.constructor.name));
            this.#appendFields(body, entity, entity.constructor.fields);
        }

        const rb = entity.rigidbody;
        if (rb) {
            body.append(this.#sectionTitle('Rigidbody'));
            body.append(
                ...this.#labeled('Velocity',
                    this.#numberInput(() => rb.velocity.x, v => rb.velocity.x = v),
                    this.#numberInput(() => rb.velocity.y, v => rb.velocity.y = v)),
                ...this.#labeled('Angular Vel.', this.#numberInput(() => rb.angularVelocity, v => rb.angularVelocity = v)),
                ...this.#labeled('Mass', this.#numberInput(() => rb.mass, v => rb.mass = v)),
                ...this.#labeled('Static', this.#checkbox(() => rb.isStatic, v => rb.isStatic = v)),
                ...this.#labeled('Use Gravity', this.#checkbox(() => rb.useGravity, v => rb.useGravity = v)),
            );

            const collider = rb.collider;
            if (collider) {
                body.append(this.#sectionTitle(collider.constructor.name));
                body.append(
                    ...this.#labeled('Enabled', this.#checkbox(() => collider.enabled, v => collider.enabled = v)),
                    ...this.#labeled('Trigger', this.#checkbox(() => collider.isTrigger, v => collider.isTrigger = v)),
                    ...this.#labeled('Inverse', this.#checkbox(() => collider.isInverse, v => collider.isInverse = v)),
                );
                const layerRow = document.createElement('div');
                layerRow.className = 'piston-row-label';
                layerRow.textContent = 'Layer';
                const layerValue = document.createElement('div');
                layerValue.textContent = layerNames[collider.layer] ?? collider.layer;
                body.append(layerRow, layerValue);
            }
        }

        for (const component of entity.components) {
            body.appendChild(this.#buildComponentSection(entity, component));
        }

        const addRow = document.createElement('div');
        addRow.style.cssText = 'grid-column:1/-1;';
        addRow.appendChild(this.#buildAddComponentMenu(entity));
        body.appendChild(addRow);

        panel.append(header, body);
        panel._sync = () => {
            panel.classList.toggle('selected', this.isSelected(entity));
            // Keeps the header's own display in sync when the name was just changed from the new
            // Name field in the body (or vice versa) - harmless no-op while `nameLabel` is detached
            // (the double-click-rename text input is swapped in over it), since setting textContent
            // on a node that isn't in the document doesn't affect anything visible.
            nameLabel.textContent = entity.name;
            for (const input of body.querySelectorAll('input')) {
                input._sync?.();
            }
        };
        panel._sync();
        return panel;
    }

    /** Rebuilds and swaps in just one entity's panel - used wherever a change (a component added or
     * removed, a field whose *shape* changed rather than just its value) needs its rendered fields
     * to catch up, without disturbing any other entity's panel or in-progress typing the way
     * wiping and rebuilding the whole list used to. */
    #rebuildEntityPanel(entity) {
        const old = this.panelsByEntityId.get(entity.id);
        const panel = this.#buildEntityPanel(entity);
        this.panelsByEntityId.set(entity.id, panel);
        if (old?.isConnected) old.replaceWith(panel);
        else this.listEl.appendChild(panel);
    }

    #refresh() {
        const entities = this.gameLoop.entities;
        this.statusEl.textContent = `${entities.length} entities — ${this.gameLoop.playState}`;
        this.sceneSection._sync();

        // Depth-first (parent, then its own children - see #orderedForDisplay), not
        // gameLoop.entities' own creation/add order, so the panel list actually reads as a
        // hierarchy. Each entry encodes both id AND depth (not just id) - reparenting via the
        // Parent dropdown or #groupEntities doesn't add/remove any entity, and can even leave the
        // SEQUENCE of ids completely unchanged (e.g. un-parenting the entity that already happened
        // to sort last back to being a plain root, which is still last) - id alone would miss that
        // as "nothing changed" and the reconciliation pass below (the thing that actually calls
        // #applyIndent on a reused panel) would never rerun, leaving a stale indent on screen.
        const ordered = this.#orderedForDisplay(entities);
        // Two different keys on purpose: `structureKey` (id + depth) decides WHETHER anything
        // worth re-rendering happened, while `plainIds` (just id, matching how panelsByEntityId is
        // actually keyed) decides WHICH panels to keep/reuse/drop below - reusing the composite key
        // for that second job would make every panel look "not in the current set" the moment depth
        // is folded in, and nuke/rebuild the whole list on every single structural change instead of
        // reconciling it.
        const plainIds = ordered.map(e => e.id);
        const structureKey = ordered.map((e, i) => `${plainIds[i]}:${this.#depthOf(e)}`);
        const structureChanged = structureKey.length !== this.knownIds.length
            || structureKey.some((k, i) => k !== this.knownIds[i]);

        if (structureChanged) {
            // Reconciled by entity id rather than a full innerHTML wipe: an entity elsewhere being
            // created/destroyed (e.g. a Ball sinking) used to tear down and rebuild every panel,
            // discarding any value being typed into an unrelated entity's field. Existing panels
            // are reused and only repositioned if their order actually changed; only the entities
            // that actually appeared or disappeared get their panel added or removed.
            const currentIdSet = new Set(plainIds);
            for (const [id, panel] of this.panelsByEntityId) {
                if (!currentIdSet.has(id)) {
                    panel.remove();
                    this.panelsByEntityId.delete(id);
                }
            }
            let prev = null;
            for (const entity of ordered) {
                let panel = this.panelsByEntityId.get(entity.id);
                if (!panel) {
                    panel = this.#buildEntityPanel(entity);
                    this.panelsByEntityId.set(entity.id, panel);
                } else {
                    // A reused panel's indent/"↳" were fixed at build time - reparenting since then
                    // (which is exactly what lands here, as noted above) needs them refreshed too,
                    // not just the panel's position in the list.
                    this.#applyIndent(panel, entity);
                }
                const expectedPrevSibling = prev ? prev.nextSibling : this.listEl.firstChild;
                if (expectedPrevSibling !== panel) {
                    this.listEl.insertBefore(panel, prev ? prev.nextSibling : this.listEl.firstChild);
                }
                prev = panel;
            }
            this.knownIds = structureKey;
        }
        for (const panel of this.listEl.children) {
            panel._sync?.();
        }
    }
}

function round(n) {
    return Math.round(n * 1000) / 1000;
}
