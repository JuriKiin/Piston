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

## Running a build
**Run Build in Browser** serves the last build locally. **Reveal Build Folder** shows `dist/web`. Upload that folder to any static host.

## From the command line
```
Piston.app/Contents/MacOS/Piston --build /path/to/project --release
```
