# Piston

A native macOS editor for making 2D games, with a web runtime. Open Piston, create a project (platform: Web),
build your game in the editor, play it, and ship it. Android and iOS runtimes come later.

```
Sources/Piston/    the editor (SwiftUI): hub, explorer, scene view, inspector, play/pause/step, console
Engine/web/        the web engine (Entities, Components, scenes, physics). Ships INSIDE the app; never copied into a project
Bridge/web/        the editor ⟷ runtime bridge pages (Scene view and Game view)
Templates/blank/   what "New Project" copies
Samples/MiniGolf/  a complete sample project
Tools/             make-icon.swift (generates the app icon)
docs/              PISTON_SPEC.md
```

A **project** is just your game: `project.piston.json`, `scenes/`, `scripts/`, `assets/`, `prefabs/`.
Scripts import the engine as `@piston/…` (an import map the editor and exported builds provide).

```bash
./bundle.sh                                   # builds Piston.app (engine, bridge, template, samples and icon inside)
open Piston.app                               # lands on the Hub
open -n Piston.app --args --sample MiniGolf   # developer shortcuts: --project <path>, --select <Type>, --play, --open <file>
open -W -n --stdout out.log Piston.app --args --selftest   # automated checks (needs an unlocked, awake display)
```
