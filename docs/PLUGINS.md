# Plugins and project tooling

> **Status:** v1 is built (now with declared network/file-write permissions, a native search dialog, and a built-in Google Fonts plugin) (see EditorDocs/12-plugins.md): JavaScriptCore host, menu commands, `scene.edit`, `afterBundle` build hook, project-trust prompt. Inspector panels, importers, tools and templates below are still design only.

Question: can a *project* extend the editor and the build with things that aren't built into Piston?

## Where things stand today
| You can already... | How |
|---|---|
| Add game types (entities, components) that show up in the editor | scripts in `scripts/`, imported by the entry module; fields declared with `static fields` appear in the Inspector |
| Add your own script templates | `.js` files in `~/Library/Application Support/Piston/Templates/Scripts` |
| Add scenes, prefabs, assets | project folders |
| Run build steps | not extensible: the pipeline is fixed |
| Add editor tools, menu items, inspector panels, importers, build hooks | **no**: there is no plugin API |

Game scripts also load inside the editor's Scene view (that's how types get discovered), but they have no editor API, and the
editor never loads project code *as editor code*. So this is a clean slate, not a retrofit.

## Principles
1. **Plugins speak a language-neutral protocol, hosted in JavaScript first** (TypeScript supported), never Swift: native code in the editor process means crashes and no sandbox. See "Language" below.
2. **Declarative UI.** Plugins describe panels and menus as data; Piston renders them natively. No plugin draws SwiftUI.
3. **Plugins act through commands.** Every change goes through the same undoable command layer as the editor's own edits.
4. **Trust is explicit.** A project's plugins are code. Opening a project that has plugins asks once ("Trust and enable?"), like VS Code workspace trust.
5. **Isolated.** Editor plugins run in their own JavaScript context, not inside the game's runtime pages.

## Language: why not Swift, and why JS is fine even with Android

Two different things get called "plugins", and only one of them is affected by the target platform:

| | Editor plugins | Runtime code |
|---|---|---|
| What | tools that edit scenes, add menus and Inspector panels, import files, run build steps | entities, components, game logic that runs inside the game |
| Runs | in the **Mac editor**, on project *data* (scene JSON, assets, schemas) | on **each target** (web today, Android later) |
| Language | any language the **editor** can host | per platform (JS for web, Kotlin for Android), or portable visual scripts |

Editor plugins never ship in the game and only see platform-neutral data, so their language is an *editor* decision, not a web-vs-Android one.
Runtime code is where multi-platform really bites, and that is solved separately (per-platform scripts, plus visual scripting graphs that are
data and run on any runtime), **not** by a plugin language.

Options for editor plugins:

| Option | Verdict |
|---|---|
| **Swift** (native plugins loaded into the editor) | **No.** Native code in-process can crash the editor and can't be sandboxed. Users would need Xcode and a build step. Unsigned plugin loading collides with macOS library validation. Locks plugins to Mac forever. |
| **JavaScript in JavaScriptCore** | **Yes, first.** Already embedded in Piston (the obfuscator runs in it). Sandboxable (no file, network or process access unless granted). No compiler needed. Same context could host the editor on other desktop platforms later. |
| **TypeScript** | **Yes, free.** esbuild (already shipped) compiles it to JS, and we publish typings, so you get autocomplete and checking. |
| **Kotlin/JS or any language that compiles to JS** | Works automatically, because the plugin API is just JS. An Android-first developer can write plugins in Kotlin/JS without Piston knowing. |
| **WebAssembly** | **Later.** One sandboxed ABI for Rust, C, Swift (SwiftWasm), Kotlin/Wasm. JavaScriptCore runs Wasm, so no new runtime. Worth it once people want non-JS plugins, not before. |
| **External process plugins** (JSON-RPC over stdio, like language servers) | **Later**, for heavy tools (asset importers, texture packers) written in anything. Needs a permission prompt and isn't sandboxed as tightly. |

Decision: **the plugin API is a language-neutral protocol (JSON commands, declarative UI, schemas)**, hosted first in JavaScript
(TypeScript supported through esbuild). Other languages come later through WebAssembly or external processes, speaking the same
protocol, without changing existing plugins.

Where the platform does matter, the API tells the plugin: `ctx.platform` is `"web"` or `"android"` in build hooks, and a plugin can
declare per-platform **runtime packages** (for example a component with a `web/Wobble.js` and an `android/Wobble.kt`) that the build
copies into the right target. The plugin itself still runs in the editor.

## Shape
A plugin is a folder, in the project (`plugins/<name>/`) or global (`~/Library/Application Support/Piston/Plugins/`):

```
plugins/level-tools/
  piston-plugin.json
  index.js
```
```json
{
  "name": "Level Tools", "id": "com.example.leveltools", "version": "1.0.0", "piston": ">=0.2",
  "main": "index.js",
  "contributes": {
    "menus":     [{ "menu": "Scene", "title": "Scatter Selected…", "command": "scatter" }],
    "inspector": [{ "for": "Planet", "title": "Planet Tools", "panel": "planetPanel" }],
    "buildSteps":[{ "after": "bundle", "run": "stripConsoleLogs" }],
    "templates": ["templates/enemy.js"]
  }
}
```
```js
export default {
  activate(piston) {
    piston.commands.register('scatter', ({ selection }) => {
      piston.scene.edit('Scatter', (scene) => { /* create/move entities */ });   // one undo step
    });
    piston.ui.panel('planetPanel', (entity) => ({
      rows: [{ type: 'button', title: 'Snap to grid', command: 'snapEntity' },
             { type: 'number', title: 'Grid', bind: 'plugin.grid', default: 16 }],
    }));
  },
  stripConsoleLogs(code, ctx) { return code.replace(/console\.log\([^)]*\);?/g, ''); },
};
```

## Capability surface (v1)
- **Commands and menus**: contribute items to Scene, Project, Build and context menus; keyboard shortcuts.
- **Inspector panels**: extra rows (button, number, text, toggle, color, list) per entity type.
- **Scene API**: read the scene, selection and schemas; `edit(name, fn)` for undoable changes; no direct file writes.
- **Build hooks**: `beforeBuild`, `afterBundle(code)`, `afterBuild(report)`: run in JavaScriptCore alongside the obfuscator. Hooks can add warnings or fail the build.
- **Templates**: plugin-supplied script templates appear in the New Script sheet.
- **Importers** (later): turn a file type (`.tmx`, `.ldtk`, `.aseprite`) into scenes or assets.
- **Gizmos and tools** (later): draw overlays in the Scene view and handle pointer input, once the viewport milestone lands.

## What it depends on (so this comes after, not before)
1. **A typed document model with commands and undo** (so `scene.edit` is safe and one undo step).
2. **Stable entity IDs** (plugins must refer to entities across reloads).
3. **A plugin host**: one hidden JavaScript context per plugin, a message bridge like the runtime one, and a permission model (read scene, edit scene, run on build, network = off by default).

## Open questions
- Distribution: just folders, or a plugin gallery later?
- Should project plugins run for everyone who opens the project (needs trust UX), or only global ones?
- Versioning: how strict is the `piston` compatibility range?
