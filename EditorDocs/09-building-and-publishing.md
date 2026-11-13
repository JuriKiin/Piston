# Building and publishing

Use the **Build** menu (or ⌘B). A build turns your project into a static website you can host anywhere.

## Development build
Readable, instant, debuggable: your scripts and the engine as separate ES modules with an import map. Use it to test in a browser.

## Release build
One bundled, minified file with scenes and prefabs compiled in and no source maps.
- **Validate** runs first: imports resolve, scene types are registered, referenced assets exist.
- **Obfuscation** levels: Off, Light, Medium (default), Heavy (slower at runtime).
- The bundle is named with a content hash (`game.<hash>.js`).

Obfuscation raises the effort to read or copy a game; it cannot make client code secret. Do not put API keys or purchase checks in your scripts.

Property names are never renamed, because scene files refer to fields by name. Registered type names are strings, which obfuscation encodes.

## "Made with Piston" splash
Every **Release** build opens with a short (about two seconds) branded splash: a press pushes the Piston mark and wordmark into the centre of the screen, draws back, and the page fades into your game. A click or any key skips it. The game loads underneath while the splash plays, so it adds no load time; the game starts running when both are done. Development builds, and Play in the editor, never show it.

The splash is compiled into the Release bundle (it is not part of the page), so it is minified and obfuscated with your game, and a Release is still one hashed script plus the page and your assets. It is part of every Release and has no setting to turn it off; the Player will not start a Release that is missing it. Players with *reduce motion* turned on see the lockup centred without the press.

## Running a build
**Run Build in Browser** serves the last build locally. **Reveal Build Folder** shows `dist/web`. Upload that folder to any static host.

## From the command line
```
Piston.app/Contents/MacOS/Piston --build /path/to/project --release
```
