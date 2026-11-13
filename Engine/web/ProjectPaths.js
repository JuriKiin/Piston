// Where the open project keeps its scenes and prefabs, relative to the page. The editor and an exported
// build set `globalThis.__PISTON_PROJECT__` before the engine loads; the defaults keep older layouts working.
export function projectPaths() {
    return globalThis.__PISTON_PROJECT__ ?? { scenes: './js/game/scenes', prefabs: './js/game/prefabs' };
}
