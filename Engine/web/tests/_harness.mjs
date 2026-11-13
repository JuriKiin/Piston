// Shared by the node tests that need a real GameLoop without a browser: stubs just enough DOM for the engine to import and run headless.
// Usage: const { makeLoop, listeners } = await loadLoopHarness();
export async function loadLoopHarness() {
    const listeners = {};
    const el = () => ({ style: {}, addEventListener() {}, appendChild() {}, setAttribute() {}, classList: { add() {} }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
    globalThis.window ??= { addEventListener(type, fn) { (listeners[type] ??= []).push(fn); }, removeEventListener() {}, innerWidth: 100, innerHeight: 100 };
    globalThis.document ??= { createElement: el, addEventListener() {}, body: el(), head: el(), getElementById: () => null };
    globalThis.localStorage ??= { getItem() { return null; }, setItem() {}, removeItem() {} };
    if (!globalThis.window.__harnessListeners) { Object.defineProperty(globalThis.window, '__harnessListeners', { value: listeners }); }
    const { default: GameLoop } = await import('../GameLoop.js');
    const { Scene } = await import('../Scene.js');
    const { Entity } = await import('../Entity.js');
    const { PlayState } = await import('../PlayState.js');
    const noop = new Proxy(function () {}, { get: (t, k) => (k === 'canvas' ? undefined : noop), apply: () => noop, set: () => true });
    const makeCanvas = (w = 200, h = 100) => ({ width: w, height: h, getContext: () => noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }) });
    /** A loop in the Playing state with the given entities, a fixed clock and no scene file (the create() path). */
    const makeLoop = (create = () => [], opts = {}) => {
        const scene = new Scene({ id: 'test_' + Math.random().toString(36).slice(2), name: 't', create });
        const loop = new GameLoop(makeCanvas(), scene, { devTools: false, ...opts });
        loop.entities = scene.instantiate(loop.canvas);
        loop.lastTime = 1000; // tests drive loop.update(nowMs) from a clock that starts at 1000 ms
        loop.playState = PlayState.Playing;
        return loop;
    };
    return { makeLoop, makeCanvas, Entity, GameLoop, Scene, PlayState, listeners: globalThis.window.__harnessListeners ?? listeners };
}
