# Plugins

Plugins add tools to the editor: menu commands that edit the open scene, and hooks that run during a release build. They are plain JavaScript (or TypeScript) and run in a sandbox: no files, network or programs, only the `piston` object described here.

## Installing

A plugin is a folder with a `piston-plugin.json` and an entry script:

- **Project plugins:** `plugins/<name>/` inside your project. The first time a project's plugin would run, Piston asks **Enable?** once (Plugins menu ▸ *Enable “name”…*), because plugins are code.
- **Global plugins:** `~/Library/Application Support/Piston/Plugins/<name>/` (Plugins menu ▸ *Show Plugins Folder*). Available in every project.

The `plugins/` folder is never part of a game build. Use **Plugins ▸ Reload Plugins** after editing one.

```json
{
  "name": "Level Tools", "id": "com.example.leveltools", "version": "1.0.0", "main": "index.js",
  "contributes": { "menus": [{ "title": "Snap Selection to Grid", "command": "snap" }] }
}
```

`main` can be TypeScript and can import other files; Piston bundles it for you.

## Developing a plugin (no restarts)

Plugins are plain JavaScript, so you can build one inside Piston and see changes immediately:

1. **Plugins ▸ New Plugin…** creates `plugins/<name>/` in your project with a working example command, approves it for you, and opens `index.js` in the code editor (with syntax checking).
2. **Save the file.** Piston notices the change, rebuilds the plugin and refreshes the Plugins menu within a second. Editing `piston-plugin.json` (menu items, permissions) works the same way. No restart, and the game runtime is not reloaded. A plugin in the global folder reloads the same way. **Plugins ▸ Reload Plugins** does it by hand.
3. **Debug with `console.log(...)`**: it prints to the Console with source `plugin`. Errors in your code, or a plugin that fails to load, appear there too (and the menu shows "failed").
4. Use **Undo** to step back any scene change a command made: each `scene.edit` is one step.

TypeScript works too: set `"main": "index.ts"`. Imports between your own files are bundled for you.

## Writing one

```js
export default {
  activate(piston) {
    piston.commands.register('snap', (ctx) => {            // ctx.selection = the selected entity keys
      piston.scene.edit('Snap to grid', (scene) => {        // ONE undo step
        for (const e of scene.entities) {
          e.transform.position.x = Math.round(e.transform.position.x / 16) * 16;
        }
      });
    });
  },
  afterBundle(code, ctx) { return code; },                  // optional: runs on release builds, before obfuscation
};
```

## The `piston` API

| | |
|---|---|
| `piston.commands.register(id, fn)` | Make a command a menu item can run. |
| `piston.scene.entities()` | The scene's entities as plain JSON (same shape as the scene file). |
| `piston.scene.selection()` / `select(keys)` | Read or change the selection (entity keys). |
| `piston.scene.get(key)` | One entity or `null`. |
| `piston.scene.edit(name, fn)` | `fn` receives a copy of the scene to modify (or return a new one). Applied as one undoable change. |
| `piston.scene.newKey()` | A unique `sceneKey` for entities you create. |
| `piston.project.readText(path)` | Read a text file inside the project (read-only). |
| `piston.notify(text)` / `console.log` | Status bar message / Console line (source `plugin`). |

### Permissions: network, files, dialogs

A plugin can do more only by **declaring it** in `piston-plugin.json` and getting your approval (a prompt lists exactly what it asked for):

```json
"permissions": { "network": ["fonts.google.com", "raw.githubusercontent.com"], "write": ["assets/fonts"] }
```

| | |
|---|---|
| `piston.net.fetchText(url)` / `fetchJSON(url)` | HTTPS GET, only to declared hosts. Returns a Promise. |
| `piston.net.download(url, path)` | Saves a file (up to 40 MB) to a project path inside a declared `write` folder. Returns a Promise. |
| `piston.project.writeText(path, text)` | Writes a text file inside a declared `write` folder (throws otherwise). |
| `piston.project.exists(path)` | Is there a file at this project path? |
| `piston.ui.pick(spec)` | A native search dialog: `{ title, placeholder, hint, search(query) → [{ id, title, subtitle }], select(item) → { text, actions: [{ id, title }] }, run(actionId, item, report) → message }`. All three can be `async`. `select` may also return `fontPreview: { sample, files: [{ url, label }] }`: Piston downloads those font files (from your declared hosts only), registers them for the session, and draws the sample text in each at three sizes. |

Anything not declared is refused with a clear error. Plugins that need no permissions and live in your global folder run without a prompt.

Build hooks: `afterBundle(code, { platform: 'web', mode: 'release' })` returns the new bundle text, or nothing to leave it. Errors become build warnings.

## Built in: Google Fonts

**Plugins ▸ Search Google Fonts…** (approve it once). Search the open-source font library, pick a family to see it drawn in its real font (edit the sample text above the preview), read its license, and **Download to Project**. Files go to `assets/fonts/<Family>/` with the license text, and are listed in `assets/fonts/fonts.json`. Then set a Text component's **Font** to the family name: the engine loads it from your project (no network at play time) and only asks Google's servers for families you haven't downloaded. It ships in builds because it lives under `assets/`.

Google Fonts are open-source licensed rather than public domain: nearly all are the SIL Open Font License (free for any game, commercial included; keep the license file), a few are Apache 2.0 or Ubuntu Font License. The plugin shows the license before you download. Its source is in Piston's `Plugins/google-fonts/` folder and is a good template for a plugin that needs the network.

## Not yet

Custom Inspector panels, scene-view tools, importers and plugin-supplied script templates are designed but not built (a plugin's only UI today is `piston.ui.pick`). See the example plugin in the Mini Golf sample (`plugins/level-tools`).
