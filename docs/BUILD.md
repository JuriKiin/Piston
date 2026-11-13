# Building and shipping a Piston game (web)

Status: implemented. Development builds and Release builds (bundle + minify + obfuscate) both work. The toolchain
(esbuild 0.28.2, javascript-obfuscator 5.10.0) is vendored in `Toolchain/`.

Measured on the Mini Golf sample (127 KB minified): Light 265 KB in ~3 s, Medium 357 KB in ~4 s, Heavy 579 KB in ~6 s.
Every level was run headlessly in a stubbed browser (scenes compiled in, game playing, 40 frames, zero errors).

Gotcha worth remembering: esbuild must only ever read a private temp copy of the project. A child process reading
`~/Documents` (or Desktop, iCloud) can be held by a macOS privacy prompt that nobody sees, which looks like a hang.

## 1. What "build" has to do

A Piston project is readable source: `scripts/*.js`, `scenes/*.json`, `assets/`, `prefabs/`. The engine lives in the app.
A build turns that into a static website that runs anywhere:

| Stage | Development build | Release build |
|---|---|---|
| 1. **Validate** | yes | yes |
| 2. **Collect** project + engine | copies engine and project files as-is (ES modules + import map) | reads them into the bundler |
| 3. **Bundle** | no (readable, debuggable, instant) | one file; tree-shakes the engine, drops editor-only code |
| 4. **Minify + mangle** | no | yes |
| 5. **Obfuscate** | no | optional levels |
| 6. **Inline data** | no (scenes fetched from `scenes/`) | scenes and prefabs compiled into the bundle |
| 7. **Emit** | `dist/web/` | `dist/web/` with content-hashed file names, no source maps |

Output is plain static files: host them on any web server (GitHub Pages, itch.io, S3, your own).

## 2. Validate (implemented)

Catches the mistakes that otherwise surface as a blank page:
- project descriptor, entry module, scenes folder and start scene exist; every scene parses
- **import graph**: every `import`/`export … from` in your scripts and entry resolves (relative paths and `@piston/…`)
- **types used by scenes** are registered by some script (or the engine), and **assets referenced by scenes** exist
- **warnings** (don't fail the build): unused scripts, large assets, scenes not in the manifest

## 3. Development build (implemented)

`dist/web/` contains `index.html` (canvas + import map), a generated `main.js` that boots the engine's web **Player**,
a copy of the engine, and your scripts/scenes/prefabs/assets. It runs from any static server, e.g. the one the editor
starts for *Run in Browser*. It's what you test with; it is readable on purpose.

The **Player** (`Engine/web/Player.js`) is the same startup path every exported game uses: size the canvas, create the game
loop *without* editor tools, start the first scene, play.

## 4. Release build and obfuscation

### What obfuscation can and can't do
Anything that runs in a browser can be read by someone determined enough. Obfuscation and minification raise the effort and
make copying a project or lifting your code slower, not impossible. Realistic goals: **no readable source, no source maps, no
original names, scenes and logic not trivially readable**. Don't put secrets (API keys, paid-content checks) in client code.

### Pipeline
1. **Bundle + tree-shake + minify** with **esbuild**: handles ES modules, the `@piston/` alias (`--alias:@piston=<engine>`), tree
   shaking and identifier mangling in one fast step. MIT license, a single ~10 MB static binary we can ship inside `Piston.app`.
2. **Obfuscate** with **javascript-obfuscator** (BSD-2, pure JS) run inside the app through macOS's built-in
   **JavaScriptCore**: no Node needed on a user's Mac. Levels: *Off*, *Light* (rename + string array), *Medium*
   (+ string encoding, dead-code injection), *Heavy* (+ control-flow flattening; measurable runtime cost).
3. **Inline data**: scenes and prefabs are written into the bundle as a module (the engine reads
   `globalThis.__PISTON_DATA__` before it tries to `fetch` a scene file; implemented in `GameLoop`).

### Things that must NOT be mangled
- **Property names that are data keys.** Scene files store entity/component fields by name (`radius`, `surfaceGravity`), and the
  engine reads them back by name. Property mangling would break loading, so the obfuscator renames *identifiers* and encodes
  *strings*, but leaves object property names alone.
- **Registered type names** (`'Ball'`, `'Planet'`) are strings in scenes. They are kept as data and then hidden by string encoding.
- **Editor-only code** (inspector, dev toolbar) is not bundled at all: the Player never imports it.

### Toolchain (needs approval to install)
Release builds need two third-party tools that aren't installed:
- `esbuild` (darwin-arm64 binary), placed in `Piston.app/Contents/Resources/Toolchain/esbuild`
- `javascript-obfuscator` (JS bundle for JavaScriptCore), in `Toolchain/obfuscator.js`

Until then **Release is reported as unavailable** and Development builds still work. The build code looks for `Toolchain/esbuild`
(or the path in `PISTON_ESBUILD`, handy for testing) and skips obfuscation with a clear message if the obfuscator is missing.

Alternatives considered:
| Option | Why not (for now) |
|---|---|
| Write our own bundler | Correct module transforms need a real JS parser (strings, regex, templates). High risk, low value |
| terser alone | Minifies but doesn't bundle; we'd still need a bundler |
| Rollup + terser in JavaScriptCore | All pure JS (no binary), but much slower and more glue than esbuild |
| Require users to have Node | Not acceptable for a Unity/Godot-style app |
| Closure Compiler (ADVANCED) | Strongest minification but demands code written to its rules; breaks reflection-style engines |

## 5. Project settings

`project.piston.json` gains:

```json
"build": { "web": { "outDir": "dist/web", "mode": "development", "obfuscation": "medium", "title": "My Game" } }
```

## 6. Platforms later

Each platform gets its own player and build target (`Engine/android`, `Bridge/android`, …). The validation stage and the project
format are shared; only collect/bundle/emit differ.

## 7. Open questions
1. OK to vendor esbuild and javascript-obfuscator (both permissive licenses) into the repo as binary/JS resources?
2. Obfuscation default for Release: Medium (recommended)?
3. Should Release also emit a `.zip` ready for itch.io, and an HTML-in-one-file option?
4. Asset protection (encrypting images/audio) is out of scope for now; worth revisiting.
