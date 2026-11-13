# Piston: Mac Editor + Web Runtime (Spec v0.2, draft)

> Supersedes v0.1. v0.1's cross-platform material (Compose, iOS, render IR) is preserved in
> **Appendix A** and is **deferred** until Phase 1 is done.

**Piston** becomes a **native macOS editor (SwiftUI)** for building 2D games that run on the
**web**. Phase 1 is *only* that: port the web editor's UI and behavior to a Mac app, add visual
scripting, and be able to build and compile a real game (PlanetGolf) with it. Cross-platform comes
after.

---

## 0. Decisions so far

| # | Decision | Consequence |
|---|---|---|
| D1 | **Name stays Piston.** | One brand across editor, runtime, projects. |
| D2 | **Phase 1 = Mac editor (SwiftUI) + web runtime only.** | No Compose/iOS work until Phase 1 ships. Keep the *door* open (§11), don't walk through it. |
| D3 | **Visual scripting is in scope, alongside game-specific code.** | Games are *data + visual graphs + hand-written JS components*. Graphs and code must interoperate (§7). |
| D4 | **Editor state is separate from game state.** | Biggest design change from today's web editor (§4). Play runs in a **separate runtime instance**; Stop discards it. |
| D5 | **"Done" for Phase 1:** build and compile a real game with it (PlanetGolf). | PlanetGolf is the acceptance test (§10). |

---

## 1. Goals and non-goals (Phase 1)

**Goals**
- Reproduce the web editor's capabilities in a native Mac app that feels like one (§3 inventory).
- A clean **editor ⟷ runtime boundary**, so the editor never reaches into live game objects.
- Visual scripting that coexists with JS components (§7).
- One-click **Build** that produces a standalone, deployable web build (§8).
- Keep the existing JS engine (`js/engine`) as the web runtime, evolving it where the boundary requires.

**Non-goals (Phase 1)**
- Compose, iOS, desktop runtimes. No render IR.
- In-app code editor (use VS Code or similar, with file watching and hot reload).
- 3D, networking, asset pipeline beyond images, fonts, audio.
- App Store distribution (see open questions).

---

## 2. What exists today

The web editor (≈2,900 lines under `js/engine/Debug/`) is a docked Inspector and toolbar that edits
**live runtime entities in place**, with Play/Stop implemented as snapshot-and-restore on those same
entities. That is the thing D4 changes.

### 2.1 Feature inventory to port

Read from `Inspector.js`, `DevToolbar.js`, `AddMenu.js`, `UndoStack.js`, `Dialogs.js`:

| Area | Features today | Phase 1 plan |
|---|---|---|
| **Entity list** | Entities listed with indentation by parent; select (multi-select via toggle); double-click to rename; right-click header → delete | Hierarchy panel (SwiftUI `OutlineGroup`/`List`) |
| **Selection in canvas** | Hit-testing incl. convex polygons; selection outline; Screen vs World space picking | Runtime answers `hitTest`; editor owns selection |
| **Transform tools** | Move (T), Rotate (R), Scale (S) gizmos; drag handles; **snap-to guides** against other entities' centers/edges, drawn on canvas | SwiftUI overlay gizmos driven by runtime-reported bounds |
| **Polygon editing** | Vertex editor mode, drag corner handles, **Bezier curve handle per edge**, add/remove vertices, exact X/Y entry | Overlay handles + schema field `vertices` editor |
| **Inspector fields** | number/checkbox/color/text/select/vertices/bindings from `static fields`; collapsible per-component sections; Add/Remove Component | Schema-generated Inspector (§5.2) |
| **Parenting/grouping** | Parent dropdown, children move with parent, group selection into an `Empty` anchor | Hierarchy drag-drop + group command |
| **Clipboard** | Copy, paste, duplicate (⌘C/⌘V/⌘D style) via serialize/rebuild | Document-level commands |
| **Prefabs** | Save entity as prefab; instantiate from Add menu | Project-level `prefabs/` |
| **Add menu** | Entity/Prefab tabs, search, grouped by registry group | Add popover, same data |
| **Sprite sheet editor** | ~200-line frame/grid editor for `SpriteRenderer` | Native sheet editor (later in P5) |
| **Input bindings editor** | Action → key map editor for `InputBindingLayer` | Native editor |
| **Undo/redo** | Whole-scene snapshots pushed before each mutation | Document-model undo with drag coalescing (§4.4) |
| **Play/Pause/Stop** | Same entities, snapshot/restore | **Replaced** by separate Play runtime (§4.3) |
| **File menu** | Save (PUT to dev server → Save As → download), Load, Reset, New Scene, Restore Unsaved Draft | Native document model; autosave is a *workspace* concern (§4.2) |
| **Debug view** | Collider visualization toggle | View menu toggle, runtime debug flag |
| **Console capture** | Captures `console.*` with source location into a panel | Console panel fed by the bridge |
| **Scene settings** | Background color etc. | Scene inspector |
| **Camera** | Camera as an ordinary entity, edited like any other | Editor has **its own** viewport camera (§4.2) |

Items **not** in the web editor and added in Phase 1: visual scripting (§7), build/export (§8),
scene/asset management, schema discovery (§5.2).

---

## 3. Architecture

```
┌────────────────────────── Piston.app (SwiftUI, macOS) ──────────────────────────┐
│                                                                                  │
│  PistonKit (pure Swift, testable)                                                │
│   • Project / Scene / Entity document model (value types)                        │
│   • Schema model + validation                                                    │
│   • Command + undo stack                                                         │
│   • Bridge protocol (typed messages)                                             │
│   • Graph model (visual scripting)                                               │
│                                                                                  │
│  PistonEditor (UI)                       PistonHost (runtime hosting)            │
│   • Hierarchy / Inspector / Assets        • Embedded HTTP server (127.0.0.1)     │
│   • Viewport + gizmo overlay              • EditView WKWebView (render only)     │
│   • Graph editor                          • PlayView WKWebView (own window)      │
│   • Console, Build panel                  • File watcher → hot reload            │
└──────────────┬──────────────────────────────────────────┬───────────────────────┘
               │ edits (patches)                          │ build
               ▼                                          ▼
        Project folder on disk  ◄──── source of truth ────►  dist/ (static web build)
        scenes/ schemas/ prefabs/ graphs/ assets/ scripts/ engine/
```

- **The document model in the editor is the single source of truth for scene data.** Neither runtime
  owns it.
- The **web runtime is a renderer and simulator of that data**, never an editor of it.
- Why an embedded HTTP server and not a custom `WKURLSchemeHandler`: ES modules and `fetch` just work,
  "Run in Browser" is free, and it avoids custom-scheme/CORS quirks. Bind to loopback only, random
  free port, add `NSAllowsLocalNetworking` for ATS. A scheme handler stays a fallback if the server
  ever causes trouble.

---

## 4. Editor state vs game state (D4)

### 4.1 Three kinds of state, never mixed

| State | Lives in | Persisted? | Examples |
|---|---|---|---|
| **Project data** | Files in the project folder; in memory as the editor's document model | Yes, version-controlled | Scenes, entity fields, prefabs, graphs, assets, project settings |
| **Editor workspace state** | Editor process only (+ `.piston/workspace.json`, git-ignored) | Per user, not in scenes | Selection, open scene tabs, viewport pan/zoom per scene, panel layout, expanded outline nodes, inspector collapse state, undo stack, tool mode, last-used Add category |
| **Game (play) state** | Inside a Play runtime instance only | **No** | Live entity state, physics, timers, input, script variables, current stroke count |

Rules that fall out of this:
1. **The editor never mutates live game objects.** Editing sends *patches to the document*; the
   document pushes patches to the Edit view. Nothing in the editor touches Play state.
2. **The runtime never writes back to project data.** (One deliberate exception, later: an explicit
   "Apply Play values to scene" command, which copies chosen values through the bridge into a normal
   editor command, undoable like any other edit.)
3. **Selection, camera, tool mode, and gizmos are not part of any scene.** Today the editor camera and
   the game's `Camera` entity are the same object, so panning to edit changes the saved game camera.
   After this, the **viewport camera belongs to the editor** and the scene's `Camera` entity is
   drawn as a **game-frame rectangle** overlay.
4. **Unsaved edit drafts are workspace state**, not scene data (replaces `localStorage` drafts).

### 4.2 Two runtime instances

| | **Edit view** | **Play view** |
|---|---|---|
| Where | Embedded in the editor viewport (`WKWebView`) | Separate window or dockable pane (own `WKWebView`) |
| Created | On scene open | On Play, from a **compiled snapshot** of the current document |
| `update()` / physics | **Never runs** | Runs normally |
| `draw()` | Runs every frame (so art animates in the editor if wanted, toggleable) | Runs every frame |
| Camera | Editor viewport camera (pan/zoom) via `setEditorCamera` | The scene's game camera |
| Input | Pointer events forwarded to the editor, not the game | Game receives input |
| Scene edits | Applied live as patches | **Not** applied (unless Hot Edit mode, below) |
| Lifetime | While the scene tab is open | Until Stop, then **destroyed** |

- **Stop is "destroy the instance."** The `captureEditState` / `restoreEditState` machinery stays in the
  engine only for *in-game* uses (e.g. "restart level"), not for editor round trips. This removes the
  class of bugs where run-time state leaks into saved scenes.
- **Pause** freezes the Play instance's update; **Step** advances one frame (new, cheap, valuable for
  physics debugging).
- **Hot Edit (optional, later):** a toggle that streams document patches into the running Play
  instance for tuning values live. Off by default; patches are applied through the same
  `applyPatch` path the Edit view uses.

### 4.3 Document model and undo

- The document is a tree of **value types** (`Project → Scene → Entity → ComponentData`), so a
  snapshot is just a copy-on-write value.
- Undo is **command-based on the document** with whole-state snapshots per command (scenes are small).
  Drags coalesce into one undo step (same behavior as today's "push before mutating").
- Commands are the only way to mutate the document. This gives clean hooks for: undo/redo, dirty
  tracking, patch generation for runtimes, and multi-selection edits.
- Selection stores entity **keys** (stable ids), never object references, so it survives patches and
  undo.

### 4.4 Bridge protocol (editor ⟷ runtime)

JSON messages over `WKScriptMessageHandler` (runtime → editor) and `evaluateJavaScript` (editor →
runtime), each with an id for request/response. Versioned (`"bridge": 1`).

| Direction | Message | Purpose |
|---|---|---|
| E → R | `loadScene {scene}` | Build entities from document JSON |
| E → R | `applyPatch {ops[]}` | Insert/remove/set-field/set-transform/reparent entities |
| E → R | `setEditorCamera {x,y,zoom}` | Edit view only |
| E → R | `setDebugFlags {colliders, bounds, ...}` | View menu toggles |
| E → R | `hitTest {x,y}` → entity key(s) | Click selection |
| E → R | `getBounds {keys[]}` → world+screen rects/handles | Gizmo overlay placement |
| E → R | `getSchemas` → schema JSON | Schema discovery (§5.2) |
| E → R | `play/pause/step/stop`, `input events` | Play view only |
| R → E | `ready`, `sceneLoaded` | Lifecycle |
| R → E | `log {level, text, source}` | Console panel |
| R → E | `error {message, stack, entityKey?}` | Click-to-select the culprit |
| R → E | `stats {fps, entityCount}` | Status bar |
| R → E | `scriptTrace {graphId, nodeId, ...}` | Highlight running graph nodes (§7.5) |

**Where gizmos live:** drawn by the **editor** as a SwiftUI overlay above the Edit view, positioned
from `getBounds`. This keeps editor chrome out of the game's draw path entirely (today the Inspector
draws gizmos into the game canvas) and makes them native, crisp, and independent of zoom.

---

## 5. Project format

```
MyGame/
  project.piston.json     # name, version, start scene, scene order, design resolution, build settings
  scenes/*.json           # entities + component data
  prefabs/*.json
  graphs/*.json           # visual scripts (§7)
  schemas/*.schema.json   # discovered from the runtime, checked in
  scripts/*.js            # hand-written entities/components (ES modules)
  assets/                 # images, fonts, audio
  engine/                 # the Piston web runtime, vendored/versioned per project
  .piston/workspace.json  # editor workspace state (git-ignored)
  dist/                   # build output (git-ignored)
```

### 5.1 Scene JSON

Evolves what `SceneIO.js` writes today; adds `piston` version and `graphs` attachment:

```jsonc
{
  "piston": 1,
  "id": "hole3", "name": "Pinball", "background": "#05060f",
  "entities": [
    { "key": "Planet#0", "type": "Planet", "name": "Home",
      "transform": { "x": 180, "y": 450, "rotation": 0, "w": 68, "h": 68 },
      "fields": { "radius": 34, "surfaceGravity": 260, "kind": "rocky", "isStart": true, "startAngle": 0, "seed": 4821 },
      "components": [], "parent": null },
    { "key": "Course#0", "type": "Course", "fields": { "par": 3 },
      "components": [ { "type": "GraphBehavior", "fields": { "graph": "graphs/course.json" } } ] }
  ]
}
```

- Fields hold **data only**; no functions.
- Unknown `type`s load as inert placeholders and **survive round trips** (don't destroy a file just
  because the runtime didn't register a type).
- Document → runtime JSON and file JSON are the same format (no second serialization).

### 5.2 Schemas: discovered, not duplicated

Today `static fields` in JS is the schema. To let SwiftUI build the Inspector without hand-writing
per-type UI, schemas are **discovered from the runtime**:

1. On project open (and on `scripts/` change), the editor loads the game in a hidden Edit-style
   runtime and sends `getSchemas`.
2. The runtime walks `EntityRegistry` / `ComponentRegistry` and returns each type's fields.
3. The editor writes `schemas/*.schema.json` (checked in, so the project opens even if a script is
   broken, and diffs show schema changes in review).

Field metadata (extends today's `{key,label,type}`): `type` ∈ `number, int, bool, string, color,
enum, angle, vec2, entityRef, asset, vertices, bindings`, plus `min/max/step`, `default`,
`visibleIf`, `group`, and **`gizmo` hints** (`radius`, `angle`, `point`) so a field can render a drag
handle in the viewport (a planet's radius ring, a hole-angle handle). The JS engine's `static fields`
gains these optional keys; existing entries stay valid.

The same registry export includes **graph-facing metadata**: events an entity emits and actions it
offers (§7.4).

---

## 6. Game code

- Hand-written entities/components stay **ES modules in `scripts/`**, same style as `js/game/` today
  (zero-arg constructors, registries, `static fields`).
- The editor does not edit code in v1. It provides: *Open in Editor* (VS Code or user default),
  *Reveal in Finder*, a file watcher, and **hot reload** (reload Edit view, show console errors with
  file:line).
- Errors from user code surface in the Console; clicking an error that has an `entityKey` selects it.
- Engine upgrades: `engine/` is vendored per project with a version stamp; "Update Engine" is an
  explicit action with a diff. (Avoids silent breakage and matches that your Piston repo has
  uncommitted engine changes: see §12.)

---

## 7. Visual scripting

### 7.1 Principles
- **Data, not code:** a graph is a JSON file interpreted by a small runtime component. Portable by
  design, which also helps Phase 2 (Appendix A).
- **Coexists with code, never fights it:** code components expose *events*, *actions* and *queries*
  (§7.4); graphs wire them together. Anything hard stays in JS.
- **Deterministic and debuggable:** a defined execution order and live **trace highlighting** in Play.
- **Typed:** wires carry types so the editor can validate connections and suggest nodes.

### 7.2 Staged scope

| Stage | What | Why |
|---|---|---|
| **VS1: Event rules** | List UI of *When [event] (if [condition]) do [actions]*; variables; works on entities and scenes | 80% of game glue (triggers, scoring, scene flow) at ~20% of the UI cost; proves the runtime |
| **VS2: Node graphs** | Free-form flow graphs: event nodes, flow control (branch, loop, sequence, delay), math/logic, variables, subgraphs | For logic that outgrows rules |
| **VS3: State machines** | Per-entity states and transitions driven by events | Enemy AI, UI flows, tool modes |

All three compile to the **same runtime graph format**, so the runtime has one interpreter, not three.

### 7.3 Graph model

```jsonc
{
  "id": "course", "version": 1,
  "variables": [ { "name": "strokes", "type": "int", "scope": "scene", "default": 0 } ],
  "nodes": [
    { "id": "n1", "kind": "event",  "event": "GolfBall.sunk",  "out": { "flow": "n2" } },
    { "id": "n2", "kind": "action", "action": "Hud.showWin",   "in": { "strokes": "$strokes" }, "out": { "flow": "n3" } },
    { "id": "n3", "kind": "action", "action": "Scene.load",    "in": { "scene": "hole4" } }
  ]
}
```

- **Scopes:** `entity` (per instance), `scene` (reset on scene load), `global` (lives across scenes).
- **Types:** `number, int, bool, string, vec2, color, entityRef, any`.
- **Execution:** events enqueue; the runner drains the queue in a fixed order each frame; `delay`
  nodes schedule against game time (respecting pause).
- **Mutation:** graphs act through **actions** and **field writes** only (no hidden access to JS
  internals).

### 7.4 Code ⟷ graph interop

Code components declare graph-visible members the same way they declare fields:

```js
static graph = {
  events:  [{ name: 'sunk', args: [{ name: 'strokes', type: 'int' }] }],
  actions: [{ name: 'restart' }, { name: 'setAssist', args: [{ name: 'mode', type: 'enum', options: ['full','short','off'] }] }],
  queries: [{ name: 'strokes', returns: 'int' }],
};
// emit:  this.emit('sunk', { strokes: this.strokes });
```

These flow into the exported schemas (§5.2), so the editor's graph palette lists *exactly* what the
project's code exposes, with no separate registration step.

### 7.5 Editor UI
- **VS1:** list/table editor with pickers for events, conditions, actions, populated from schemas.
- **VS2/VS3:** SwiftUI canvas (pan/zoom, drag nodes, typed ports, wire preview, minimap, search
  palette, comment boxes). This is the biggest single UI piece in Phase 1 and gets its own spike.
- **Debugging:** during Play, `scriptTrace` highlights firing nodes and shows last values on wires;
  breakpoints on nodes pause the Play instance (reuses Pause/Step).

---

## 8. Build and compile

**Build** produces a standalone static web app in `dist/`:

1. **Validate:** scenes load against schemas, all referenced assets/graphs/scripts exist, graphs
   type-check, no unknown entity types (warn), start scene set.
2. **Compile graphs:** JSON graphs → an optimized runtime form (resolved ids, pre-checked types).
3. **Collect:** engine + scripts + scenes + graphs + assets into `dist/` with `index.html`.
4. **Bundle (optional step):** by default `dist/` keeps ES modules as-is (works on any static host).
   An optional minify/bundle pass can use `esbuild` if installed. Not required for Phase 1.
5. **Report:** size, warnings, entity/scene counts.

Outputs: **Run** (open `dist/` through the local server in the default browser), **Export** (zip), and
a **Play-from-dist** window that runs the *built* output (catches "works in editor, breaks in build").

Editor-only features (inspector bridge, gizmo hooks, debug draws) are excluded from `dist/` by
construction: the editor bridge is a separate module the build never copies.

---

## 9. Mac app engineering notes

- **Stack:** SwiftUI (macOS 14+), AppKit interop via `NSViewRepresentable` for `WKWebView`; Swift
  Package modules `PistonKit`, `PistonHost`, `PistonEditor`; `@Observable` for UI state.
- **Document:** `FileDocument` is a poor fit for a folder-based project; use a project-folder model
  with a custom document controller and **FSEvents/`DispatchSource`** watching for external edits
  (scripts, assets, scenes edited in Git).
- **Sandbox:** if not distributing via the App Store, skip App Sandbox (simplest access to project
  folders and `adb`/tools later). Otherwise use security-scoped bookmarks.
- **Gizmo overlay:** a SwiftUI `Canvas`/`Path` layer; hit-testing handles in SwiftUI, entity hit-test
  via bridge. Coordinate conversion: editor viewport camera ⟷ screen, owned in `PistonKit`.
- **Performance:** bridge messages are small JSON; bounds are sent on change, not per frame, except
  during a drag where the editor already knows the delta.
- **Testing:** `PistonKit` is pure Swift, so document model, commands, undo, patch generation, schema
  validation and graph type-checking are unit-testable without a UI or a web view. The bridge has a
  scripted runtime test (headless `WKWebView`) that loads a fixture project.

---

## 10. Milestones (Phase 1)

Relative sizes: **S** ≈ a session or two, **M** ≈ a few sessions, **L** ≈ a project.

| # | Milestone | Size | Done when |
|---|---|---|---|
| **P0** | Finish **PlanetGolf on JS Piston** (copy at `Web/PlanetGolf`, game code in progress) | M | Playable 8-hole game in the browser. Becomes the first real project |
| **P1** | **Spike:** SwiftUI app + embedded HTTP server + `WKWebView` loads a project, bridge round trip (`loadScene`, `getSchemas`, `getBounds`, `log`) | S | De-risks the host/bridge; verifies ES modules + hot reload |
| **P2** | **Document + Inspector:** project open/save, scene list, Hierarchy, **schema-generated Inspector**, command-based undo/redo | L | Edit PlanetGolf planets' fields natively; round trips cleanly |
| **P3** | **Viewport:** pan/zoom, selection via `hitTest`, move/rotate/scale gizmos, snap guides, game-frame overlay, vertex/curve editing, schema gizmos (radius/angle) | L | Drag a planet, resize by radius handle, set the hole angle visually |
| **P4** | **Play:** separate Play window, Pause/Step/Stop, input forwarding, Console, error → select entity, hot reload | M | Play PlanetGolf from the editor; Stop leaves scene data untouched |
| **P5** | **Parity features:** Add menu, prefabs, grouping/parenting, copy/paste/duplicate, asset browser, sprite-sheet editor, input-bindings editor, scene New/Rename/Reorder | L | Feature inventory (§2.1) all checked |
| **P6** | **Build/Export:** validation, `dist/`, Run, Export zip, Play-from-dist | M | PlanetGolf builds and runs standalone from `dist/` |
| **P7** | **Visual scripting VS1:** event rules + variables + code interop metadata + `ScriptRunner` + trace | L | PlanetGolf's win/next-hole flow built with rules, no code |
| **P8** | **VS2/VS3:** node-graph canvas, subgraphs, state machines | L | A non-trivial behavior (HUD flow or tool state machine) built as a graph |
| **P9** | **Acceptance:** PlanetGolf opened as a Piston project, authored in the editor, scripted visually where sensible, built and exported | M | D5 satisfied → Phase 1 complete |

Order rationale: P1 first because the host/bridge is the riskiest unknown. P2/P3 before Play because
editing is the main value. Visual scripting only after the boundary is solid (it depends on schemas,
trace, and Play).

---

## 11. Keeping Phase 2 possible (cheap hygiene, no cross-platform work now)

These cost almost nothing now and keep the door open:
- **Schemas stay language-neutral JSON** (already the plan).
- **Scene and graph JSON are versioned** and contain no JS.
- **Graphs are data**, so another runtime can interpret them without porting logic.
- **The editor depends on the bridge protocol, not on JS internals**, so another runtime that speaks
  the bridge can slot in later.
- **No Canvas2D calls in editor code.** The editor never draws into the game canvas.

Not doing now: render IR, Kotlin/Swift runtimes, conformance suites. See Appendix A.

---

## 12. Risks

- **Scope.** This is a big project. The milestone order front-loads the riskiest pieces (P1 host/bridge,
  P3 viewport) and keeps visual scripting staged (VS1 before VS2).
- **Node-graph UI in SwiftUI** is custom canvas work with real performance and gesture subtleties.
  Mitigation: VS1 list UI first; spike the canvas separately before committing to VS2.
- **Bridge latency/complexity** for gizmos. Mitigation: bounds on change, editor-side math during
  drags, patches batched per frame.
- **Dual engine state.** Your Piston repo's `polygon-collision` branch has uncommitted engine edits.
  The PlanetGolf copy snapshots the working tree as of its creation. Decide which engine state is the
  baseline for the vendored `engine/` before P1.
- **Hot reload fidelity.** ES module cache and entity re-registration can leave stale classes.
  Mitigation: full page reload of the Edit view on script change, preserve editor workspace state.
- **Editor/runtime schema drift.** Mitigated by discovering schemas from the runtime instead of
  hand-writing them, and checking them into the project.
- **Graphs vs code boundary** can get muddy. Mitigation: the exposed-members contract (§7.4) is the
  only integration surface.

---

## 13. Open questions

1. **Repo layout:** one new `piston` monorepo (`editor/`, `runtime/`, `docs/`, `examples/planetgolf/`),
   keep `Web/Piston` as the runtime repo and add `Piston-Mac`, or something else?
2. **Where does the Play view live:** separate window, docked pane, or both?
3. **Distribution:** personal tool only (skip sandbox) or eventually shareable/App Store?
4. **Visual scripting first release:** is VS1 (event rules) an acceptable first cut, with node graphs
   landing in P8?
5. **Minimum macOS version:** macOS 14 (`@Observable`, modern SwiftUI) acceptable?
6. **Engine baseline:** which state of `js/engine` (committed `main`, `polygon-collision` WIP, or the
   snapshot copied into PlanetGolf) is canonical for the first vendored `engine/`?
7. **Scene/Prefab format compatibility** with existing Piston projects (mini golf): migrate, or start
   fresh?

---

## Appendix A: Deferred cross-platform plan (Phase 2)

Carried over from v0.1, **not in scope now**. Revisit after P9.

**Approach (unchanged recommendation):** specify four contracts (scene format, schema, render IR,
runtime semantics) and build a second runtime (Kotlin + Compose) that loads the same project and
passes the same conformance tests. Decide afterwards whether to collapse into one Kotlin
Multiplatform core, using the measured cost of porting PlanetGolf.

**New leverage from Phase 1:** visual-scripting graphs are *data*, so a Compose runtime only needs a
graph interpreter, not a port of game glue logic. Only hand-written JS components need porting, and the
bridge protocol lets the same editor drive a different runtime.

**Render IR (when we get there):** a small Canvas2D-shaped interface (`save/restore`, transforms,
path ops, `fill/stroke` with solid/linear/radial paints, `clip`, `text`, `image`) recorded as a flat
command buffer; entities draw to it instead of calling `ctx` directly. Maps to Compose `DrawScope`,
SwiftUI `GraphicsContext`, and Canvas2D. Conformance tests compare **IR streams** between runtimes
(op sequence exact, numbers within ε), not screenshots.

**Compose runtime notes:** `piston-core` + `piston-compose` (`PistonHost` composable driven by
`withFrameNanos`), allocation-free hot path, `bake` for static subtrees, Compose Desktop as the
no-emulator dev loop, one-finger drag = aim.

**Conformance suite:** scene round trip, schema parity, physics goldens (short horizons, tolerance,
outcomes exact), IR goldens, recorded input replay. PlanetGolf has two existing implementations (the
Swift prototype and the JS port), which already give independent physics goldens.

**Physics policy:** no required physics in the core; PlanetGolf's custom N-body sim is the proof the
engine must not assume built-in physics. No bit-identical guarantee across platforms (trig differences
amplify in orbital sims); solvability is verified on one platform and treated as data.

**Other targets:** iOS via Compose Multiplatform or a SwiftUI backend, web-from-Kotlin (Wasm/JS) if the
core collapses to Kotlin Multiplatform.

---

## Appendix B: P1 spike results (done)

**Code:** `~/Documents/GitHub/Apps/Piston` (SwiftUI app + `Resources/bridge/` web side + `Fixtures/minigolf`, a
copy of the existing mini-golf game used as the test project). Build with `./bundle.sh`; run the
automated checks with `open -W -n --stdout out.log Piston.app --args --selftest`.

**Result: all 18 self-test checks pass** (run repeatedly), and the app renders and edits the fixture:

| Spec claim | Verified by |
|---|---|
| Embedded loopback HTTP server + `WKWebView` runs the existing JS engine, ES modules included (§3) | Runtime boots, scene loads, 7 entities |
| Bridge round trip: load scene, schemas, bounds, hit test, patch, logs, errors (§4.4) | 11 bridge checks, unknown request fails cleanly (no hang) |
| Schemas discovered from the runtime's registries, not hand-written (§5.2) | 11 entity types / 11 components found; Ball's 7 fields drive the Inspector |
| Gizmos drawn by the editor as a SwiftUI overlay from runtime-reported bounds (§4.4) | Selection box + handles track a patched entity exactly |
| Editor camera independent of scene data (§4.1) | Panning moves the view only; document unchanged |
| Editor state survives code reload (§4.1) | Camera and selection restored after hot reload |
| Hot reload + external file edits (§6) | Script edit → one reload; scene file edit → document reload without page reload; own saves ignored |
| Errors in game code reach the editor console | Broken script's error shows in the Console panel |

**Findings that change or refine the spec**

1. **File watching needs care (all four bit us):** (a) one save arrives as several FSEvents across batches,
   so debounce (400 ms); (b) FSEvents reports resolved paths (`/private/var` vs `/var`), so normalize;
   (c) macOS emits metadata-only events (xattr/provenance) on first launch of a new app bundle, so react
   only to content flags (created/modified/renamed/removed); (d) detect your own saves by comparing file
   **bytes**, not timestamps (a time window swallowed a genuine external edit).
2. **Scene extents must come from the runtime.** A polygon entity's `transform.size` doesn't cover its
   vertices, so framing/hit-testing based on the document is wrong for shapes. The bridge now has
   `getSceneBounds`; later gizmo and hit-test work should lean on the runtime's real geometry.
3. **`evaluateJavaScript` can't return a Promise.** The bridge handler must return nothing and reply
   through `postMessage` (implemented).
4. **Entity keys are not stable enough yet.** Today a key is `Tag#N` (creation order) or `added:<random>`.
   Insert/delete shifts `Tag#N`. **P2 must introduce real stable ids** (UUIDs written to the scene file)
   before the document model, undo and graph references depend on keys.
5. **Screen-space entities (HUD) render in raw canvas pixels,** so they ignore editor zoom and sit at the
   viewport's top-left. P3 needs the **design resolution / game-frame** concept (§4.2) so HUD is previewed
   at game size inside the frame.
6. **Retina:** the edit canvas renders at devicePixelRatio, but engine `Screen`-space code assumes 1:1.
   Fine for now; revisit with the game-frame work.
7. **Document edits are whole-JSON-dictionary mutations in the spike.** Enough to prove the loop; P2 replaces
   them with the typed value-type document model and commands from §4.3.

**Not yet validated (next milestones):** Play view as a separate instance (P4), undo/redo, multi-select,
rotate/scale gizmos, polygon vertex editing, performance of per-event bridge patches during drags,
the project-open flow for a *new* project, and anything about visual scripting.

---

## Appendix C: Product decisions, 2026-11-11

Direction set after the spike and the first editor build:

- **Piston is one repo** containing the editor, the engine and the bridge. A game project contains only game content.
- **The engine is part of Piston, not of a project.** It ships inside the app (`Engine/web`), is mounted by the editor
  at `/__piston__/engine/`, and projects import it as `@piston/…` through an import map. A project records only the
  engine *version* it targets. Later, Build/Export will emit the engine as a single minified (optionally obfuscated)
  library next to the game, never as readable sources in the project.
- **Platforms are chosen at project creation** (Web now; Android later). Each platform gets its own engine + bridge
  under `Engine/<platform>` and `Bridge/<platform>`.
- **Workflow mirrors Unity/Godot:** open Piston → Hub (New Project / Open / Recents / Samples) → blank project.
- **Runtime pages are served at the URL root** (`/__piston_edit.html`, `/__piston_play.html`) so relative paths in
  game code (assets, scenes) resolve against the project exactly as they will in an exported build.
- **The engine reads scene/prefab locations from `globalThis.__PISTON_PROJECT__`** (set by the page), defaulting to the
  old Piston layout, so the engine no longer assumes `js/game/…`.

Built: Hub with New Project / Open / Recents / Open Sample, blank template, bundled engine and bridge, import map,
engine-free project folders, app icon, window title, recents persistence. Next (see roadmap): the editing loop
(add/delete/duplicate, undo/redo, stable IDs), viewport essentials with a game-frame/design resolution, New Project →
PlanetGolf, Build/Export (single minified engine bundle), visual scripting.
