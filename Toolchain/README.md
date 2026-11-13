# Toolchain (Release builds)

Third-party tools Piston runs to turn a game into a Release web build. Vendored, unmodified, from npm.

| File | Tool | Version | License | Used for |
|---|---|---|---|---|
| `esbuild` | esbuild (darwin-arm64 binary) | 0.28.2 | MIT | bundle, tree-shake, minify |
| `obfuscator.js` | javascript-obfuscator (browser build) | 5.10.0 | BSD-2-Clause | optional obfuscation, run inside JavaScriptCore |

Licenses are in `licenses/`. Apple-silicon only for now; an Intel (x64) esbuild binary can be added alongside when needed.
To update: `npm install esbuild javascript-obfuscator` in a scratch folder and copy the two files over.
