const KEY = 'piston:lastScene';

/** Which scene the page should boot into - the last one GameLoop#loadScene switched to, so a
 * refresh resumes wherever you were instead of always landing back on the game's hardcoded
 * default scene (see main.js). localStorage rather than anything server-side since this is a
 * per-browser editing convenience, not part of the game's actual saved state. */
export function getLastSceneId() {
    try {
        return localStorage.getItem(KEY);
    } catch (e) {
        return null; // private browsing, storage disabled, etc - just boot into the default
    }
}

export function setLastSceneId(id) {
    try {
        localStorage.setItem(KEY, id);
    } catch (e) { /* not fatal - just means next boot falls back to the default */ }
}
