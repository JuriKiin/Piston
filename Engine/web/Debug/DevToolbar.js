import { PlayState } from "../PlayState.js";
import Debug from "../static/Debug.js";
import { Inspector } from "./Inspector.js";
import { EntityRegistry } from "../EntityRegistry.js";
import { SceneRegistry } from "../SceneRegistry.js";
import { Scene } from "../Scene.js";
import { confirmDialog, promptDialog } from "./Dialogs.js";
import { buildAddMenuContent } from "./AddMenu.js";

/**
 * The full-width top bar: a File menu (Save/Load/Reset), an Add menu (searchable, grouped by
 * EntityRegistry's group names) for dropping new entities into the running scene, Play/Pause/Stop,
 * and status. Docks into #topbar-root (see index.html) rather than floating over the canvas, so it
 * takes real layout space instead of overlapping the game view. Also exposes `window.Piston` as a
 * convenience for poking at the live GameLoop/Debug instances from the browser console.
 */
export class DevToolbar {
    constructor(gameLoop) {
        this.gameLoop = gameLoop;
        this.inspector = new Inspector(gameLoop);

        window.Piston = window.Piston ?? {};
        window.Piston.gameLoop = gameLoop;
        window.Piston.Debug = Debug;

        this.root = document.createElement('div');
        this.root.style.cssText = `
            display: flex; align-items: center; gap: 6px;
            font: 12px/1.4 system-ui, sans-serif;
            background: #262626; color: #fff; border-bottom: 1px solid #3a3a3a;
            padding: 6px 10px; user-select: none; position: relative; z-index: 10;
        `;

        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = 'application/json';
        this.fileInput.style.display = 'none';
        this.fileInput.addEventListener('change', async () => {
            const file = this.fileInput.files[0];
            this.fileInput.value = '';
            if (file) await this.gameLoop.loadSceneFromFile(file);
        });

        const fileMenu = this.#makeDropdown('File', (menu) => {
            this.#menuItem(menu, '🆕 New Scene', () => this.#createNewScene());

            // Only worth showing once there's somewhere else to switch to - a single-scene project
            // (the common case until "New Scene" or a second scene file is added) doesn't need an
            // empty list cluttering the menu. Recomputed fresh each open (see #makeDropdown's own
            // doc comment), so a scene created a moment ago already shows up.
            const scenes = SceneRegistry.list();
            if (scenes.length > 1) {
                const header = document.createElement('div');
                header.textContent = 'Switch Scene';
                header.style.cssText = 'padding:6px 8px 2px; opacity:0.5; font-size:10px; text-transform:uppercase; letter-spacing:0.05em;';
                menu.appendChild(header);
                for (const scene of scenes) {
                    const isCurrent = scene === this.gameLoop.scene;
                    this.#menuItem(menu, `${isCurrent ? '✓ ' : '  '} ${scene.name}`, () => {
                        if (!isCurrent) this.gameLoop.loadScene(scene);
                    });
                }
            }

            this.#menuItem(menu, '💾 Save', () => this.gameLoop.saveSceneToFile());
            this.#menuItem(menu, '📂 Load', () => this.fileInput.click());
            // Only offered when there's actually a draft to recover - computed fresh each time the
            // menu opens (see #makeDropdown's own doc comment) rather than once at construction, so
            // it reflects whatever's true right now instead of whatever was true when the page loaded.
            if (this.gameLoop.hasDraft()) {
                this.#menuItem(menu, '↩ Restore Unsaved Draft', async () => {
                    if (await confirmDialog('Overlay your last unsaved draft onto the current scene? Anything not in that draft stays as-is.')) {
                        this.gameLoop.restoreDraft();
                    }
                });
            }
            this.#menuItem(menu, '↺ Reset', async () => {
                if (await confirmDialog('Discard your unsaved edits and reload the last saved level?')) {
                    this.gameLoop.revertToSavedLevel();
                }
            }, true);
        });

        const viewMenu = this.#makeViewMenu();
        const addMenu = this.#makeAddMenu();

        // One toggle rather than separate Play/Stop buttons - Edit/Paused show ▶ (play/resume),
        // Playing shows ⏹ (stop) - so there's always exactly one obvious next action instead of
        // two buttons where one is always disabled. Pause is real pause/resume-in-place, so it
        // stays a separate button rather than folding into the toggle.
        this.playToggleBtn = this.#makeIconButton('▶', () => {
            if (this.gameLoop.playState === PlayState.Playing) this.gameLoop.stop();
            else this.gameLoop.play();
        });
        this.pauseBtn = this.#makeIconButton('⏸', () => this.gameLoop.pause());
        this.undoBtn = this.#makeIconButton('↶', () => this.inspector.undo());
        this.redoBtn = this.#makeIconButton('↷', () => this.inspector.redo());

        // Absolutely centered (rather than flexed between the two side groups) so it stays
        // dead-center in the bar regardless of how wide File/View/Add end up vs. the status text -
        // the root's own `position: relative` above is what this centers within.
        const playbackControls = document.createElement('div');
        playbackControls.style.cssText = 'position:absolute; left:50%; top:50%; transform:translate(-50%, -50%); display:flex; gap:4px;';
        playbackControls.append(this.playToggleBtn, this.pauseBtn);

        const spacer = document.createElement('span');
        spacer.style.flex = '1';

        this.stateLabel = document.createElement('span');
        this.stateLabel.style.cssText = 'opacity: 0.7; min-width: 3.5em;';

        this.autosaveLabel = document.createElement('span');
        this.autosaveLabel.style.cssText = 'opacity: 0.5; font-size: 11px;';

        // Separate from autosaveLabel's "Draft saved" on purpose - that's just the in-memory
        // recovery copy (see GameLoop#draftTick), not the committed level file. This is the one
        // that answers "did my Save actually take" - see GameLoop#saveSceneToFile.
        this.savedLabel = document.createElement('span');
        this.savedLabel.style.cssText = 'opacity: 0.7; font-size: 11px; color: #8fd98f;';

        this.root.append(
            fileMenu, viewMenu, addMenu, this.undoBtn, this.redoBtn, this.fileInput,
            playbackControls,
            spacer, this.stateLabel, this.savedLabel, this.autosaveLabel,
        );
        document.getElementById('topbar-root')?.appendChild(this.root) ?? document.body.appendChild(this.root);

        // Cmd/Ctrl+S saves straight to the level file instead of the browser's own "Save Page"
        // dialog - preventDefault has to fire unconditionally on the combo (not just when a save
        // actually happens) or that native dialog still flashes up first on some browsers.
        window.addEventListener('keydown', (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                this.gameLoop.saveSceneToFile();
            }
        });

        this.#refresh();
        setInterval(() => this.#refresh(), 200);
    }

    /**
     * Prompts for a name, registers a brand new empty Scene under a unique id, and switches the
     * running page to it immediately (see GameLoop#loadScene) - build it up the same way any scene
     * gets built, by using +Add to drop entities in one at a time.
     *
     * This only lives in the current page session and SceneRegistry until File > Save writes
     * js/game/scenes/<id>.json - a page refresh before that discards it entirely, same as any
     * unsaved edit. Saving makes the *level* permanent, but this scene still won't be there to pick
     * from a fresh page load until it's also added to js/game/scenes/index.js's manifest (one line:
     * an id + name, no entity-building code needed - see Scene.js) - that's not something this page
     * can do to its own source from inside the browser, so ask for that once there's something here
     * worth keeping permanently.
     */
    async #createNewScene() {
        const name = await promptDialog('New scene name:');
        if (!name || !name.trim()) return;

        const scene = new Scene({
            id: SceneRegistry.uniqueId(name),
            name: name.trim(),
            // Blank canvas by default (see Scene.js) - add entities via +Add same as any scene.
        });
        SceneRegistry.register(scene);
        this.gameLoop.loadScene(scene);
    }

    #makeButton(label, onClick) {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.cssText = `
            cursor: pointer; border: none; border-radius: 4px;
            padding: 4px 8px; font: inherit; background: #3a3a3a; color: #fff;
        `;
        btn.addEventListener('click', onClick);
        return btn;
    }

    /** Same as #makeButton, sized/sized-up for a single glyph (▶/⏸/⏹) rather than a text label. */
    #makeIconButton(label, onClick) {
        const btn = this.#makeButton(label, onClick);
        btn.style.fontSize = '14px';
        btn.style.lineHeight = '1';
        btn.style.minWidth = '30px';
        return btn;
    }

    /** The "View ▾" menu: currently just the Colliders visibility toggle, but its own dropdown
     * (rather than living inline in the bar) so display-only toggles have a home separate from
     * File's actions and the Add menu's entity list. */
    #makeViewMenu() {
        return this.#makeDropdown('View', (menu) => {
            const item = document.createElement('div');
            item.style.cssText = 'padding:5px 8px; cursor:pointer; border-radius:3px; white-space:nowrap; display:flex; align-items:center; gap:6px;';
            item.addEventListener('mouseenter', () => item.style.background = '#333');
            item.addEventListener('mouseleave', () => item.style.background = '');

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = Debug.showColliders;
            checkbox.addEventListener('change', () => { Debug.showColliders = checkbox.checked; });
            // A click anywhere else in the row toggles it too, dispatching the same 'change' event
            // the checkbox's own native toggle would - but not when the click landed on the
            // checkbox itself, which already toggled it natively (this would otherwise flip it
            // straight back, canceling the click out).
            item.addEventListener('click', (e) => {
                if (e.target === checkbox) return;
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change'));
            });

            const label = document.createElement('span');
            label.textContent = 'Colliders';

            item.append(checkbox, label);
            menu.appendChild(item);
        });
    }

    /** A "Label ▾" button that opens a plain popup menu below it; `buildMenu(menuEl)` fills it in
     * lazily each time it opens, so File's items (which read live state like the confirm dialog)
     * are never stale. */
    #makeDropdown(label, buildMenu) {
        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';

        const btn = this.#makeButton(`${label} ▾`, (e) => {
            e.stopPropagation();
            const isOpen = menu.style.display === 'block';
            document.querySelectorAll('.piston-topbar-menu').forEach(m => m.style.display = 'none');
            if (!isOpen) {
                menu.innerHTML = '';
                buildMenu(menu);
                menu.style.display = 'block';
            }
        });

        const menu = document.createElement('div');
        menu.className = 'piston-topbar-menu';
        menu.style.cssText = `
            display: none; position: absolute; top: 100%; left: 0; margin-top: 2px; z-index: 20;
            min-width: 160px; background: #1a1a1a; border: 1px solid #3a3a3a; border-radius: 4px; padding: 4px;
        `;
        menu.addEventListener('click', (e) => e.stopPropagation());

        wrapper.append(btn, menu);
        return wrapper;
    }

    #menuItem(menu, label, onClick, closeMenu = true) {
        const item = document.createElement('div');
        item.textContent = label;
        item.style.cssText = 'padding:5px 8px; cursor:pointer; border-radius:3px; white-space:nowrap;';
        item.addEventListener('mouseenter', () => item.style.background = '#333');
        item.addEventListener('mouseleave', () => item.style.background = '');
        item.addEventListener('click', () => {
            onClick();
            // `menu` itself (the popup), not `menu.parentElement` (the wrapper, which also holds
            // the toggle button) - hiding the wrapper by mistake here used to take the whole File
            // button down with the dropdown every time any item in it was clicked, with nothing
            // short of a page reload bringing it back.
            if (closeMenu) menu.style.display = 'none';
        });
        menu.appendChild(item);
        return item;
    }

    /** The Add menu: Entity/Prefab tabs (see AddMenu.js, shared with the Inspector's own
     * right-click-on-empty-space menu so both stay in sync automatically) - picking an entry drops
     * a fresh instance into the running scene (see GameLoop#addEntityFromRegistry/#addPrefabInstance). */
    #makeAddMenu() {
        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';

        const btn = this.#makeButton('+ Add ▾', (e) => {
            e.stopPropagation();
            const isOpen = menu.style.display === 'block';
            document.querySelectorAll('.piston-topbar-menu').forEach(m => m.style.display = 'none');
            if (!isOpen) {
                menu.innerHTML = '';
                menu.appendChild(buildAddMenuContent(async (kind, key) => {
                    this.gameLoop.undoStack?.push();
                    const entity = kind === 'entity'
                        ? this.gameLoop.addEntityFromRegistry(EntityRegistry.get(key))
                        : await this.gameLoop.addPrefabInstance(key);
                    this.inspector.select(entity);
                    menu.style.display = 'none';
                }));
                menu.style.display = 'block';
            }
        });

        const menu = document.createElement('div');
        menu.className = 'piston-topbar-menu';
        menu.style.cssText = `
            display: none; position: absolute; top: 100%; left: 0; margin-top: 2px; z-index: 20;
            width: 200px; max-height: 360px; overflow-y: auto;
            background: #1a1a1a; border: 1px solid #3a3a3a; border-radius: 4px; padding: 4px;
        `;
        menu.addEventListener('click', (e) => e.stopPropagation());

        wrapper.append(btn, menu);
        return wrapper;
    }

    #refresh() {
        const state = this.gameLoop.playState;
        const isPlaying = state === PlayState.Playing;

        // Edit/Paused both want the toggle showing ▶ (start, or resume in place) - only actively
        // Playing wants ⏹ (stop) - so there's always exactly one obvious next action.
        this.playToggleBtn.textContent = isPlaying ? '⏹' : '▶';
        this.playToggleBtn.title = isPlaying ? 'Stop' : (state === PlayState.Paused ? 'Resume' : 'Play');

        this.pauseBtn.disabled = !isPlaying;
        this.undoBtn.disabled = !this.gameLoop.undoStack?.canUndo;
        this.redoBtn.disabled = !this.gameLoop.undoStack?.canRedo;
        for (const btn of [this.playToggleBtn, this.pauseBtn, this.undoBtn, this.redoBtn]) {
            btn.style.opacity = btn.disabled ? '0.4' : '1';
            btn.style.cursor = btn.disabled ? 'default' : 'pointer';
        }
        this.stateLabel.textContent = state[0].toUpperCase() + state.slice(1);

        // "Draft" (not "Saved") - this is the recovery-only local copy, not the committed level
        // file (see GameLoop#draftTick's doc comment). File > Save is the only real save now.
        const savedAt = this.gameLoop.lastAutosaveAt;
        this.autosaveLabel.textContent = savedAt ? `Draft saved ${savedAt.toLocaleTimeString()}` : '';

        const lastSavedAt = this.gameLoop.lastSavedAt;
        this.savedLabel.textContent = lastSavedAt ? `Saved ${lastSavedAt.toLocaleTimeString()}` : '';
    }
}

document.addEventListener('click', () => {
    document.querySelectorAll('.piston-topbar-menu').forEach(m => m.style.display = 'none');
});
