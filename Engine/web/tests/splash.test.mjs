// Run: node Engine/web/tests/splash.test.mjs   (no browser needed)
// The "Made with Piston" splash compiled into every Release bundle (Engine/web/MadeWithPiston.js), and the Player hook that waits for it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadLoopHarness } from './_harness.mjs';

let passed = 0; const test = async (n, f) => { await f(); passed++; console.log('PASS', n); };
const srcPath = fileURLToPath(new URL('../MadeWithPiston.js', import.meta.url));
const src = fs.readFileSync(srcPath, 'utf8');

/** Runs the splash script against a stub page; returns handles to drive its clock and inspect what it did to the DOM. */
function boot({ reduced = false } = {}) {
    const mk = (w = 0, h = 0) => ({ style: {}, offsetWidth: w, offsetHeight: h, parentNode: null });
    const els = { 'pstn-icon': mk(), 'pstn-rod': mk(), 'pstn-plate': mk(0, 18), 'pstn-lock': mk(300, 100), 'pstn-made': mk(0, 14), 'pstn-splash': Object.assign(mk(), { listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, removeEventListener() {} }) };
    els['pstn-splash'].parentNode = { removeChild() { els.removed = true; } };
    const listeners = {}; let raf = null;
    const window = { innerHeight: 800, matchMedia: () => ({ matches: reduced }), addEventListener(t, f) { listeners[t] = f; }, removeEventListener() {}, requestAnimationFrame(f) { raf = f; } };
    const document = { head: { appendChild() {} }, body: { insertAdjacentHTML() {} }, getElementById: id => els[id], createElement: () => ({}) };
    // Evaluate the module's code against the stub page (no browser needed).
    const code = src.replace(/export function /g, 'function ') + '\nreturn madeWithPiston;';
    const g = {}; const promise = new Function('window', 'document', 'globalThis', code)(window, document, g)();
    window.__PISTON_SPLASH__ = promise;
    let settled = false; promise.then(() => { settled = true; });
    return { els, window, listeners, isDone: async () => { await Promise.resolve(); await Promise.resolve(); return settled; }, step: ms => { const f = raf; raf = null; f?.(ms); } };
}

await test('the splash is self-contained module code: no external requests, small', () => {
    assert.ok(src.includes('id="pstn-splash"') && src.includes('MADE WITH') && src.includes('>Piston<'));
    assert.ok(!/(src|href)=["']https?:/.test(src) && !/<script/.test(src) && !/url\(/.test(src));
    assert.ok(src.length < 9000, `splash is ${src.length} bytes`);
});
await test('it plays for under three seconds, pushes the word to the centre, drops the mark in, then resolves and removes itself', async () => {
    const s = boot();
    s.step(0);
    assert.equal(await s.isDone(), false);
    s.step(900);                                   // the press has just pushed the lockup into place
    const lockY = parseFloat(s.els['pstn-lock'].style.transform.match(/,\s*(-?[\d.]+)px/)[1]);
    assert.ok(Math.abs(lockY + 50 - 400) < 25, `lockup centre ${lockY + 50} should be near 400`);
    s.step(1300); assert.equal(s.els['pstn-icon'].style.opacity, '1', 'the mark is dropping in');
    s.step(2300);
    assert.equal(s.els['pstn-made'].style.opacity, '1');
    s.step(3100);
    assert.ok(parseFloat(s.els['pstn-splash'].style.opacity) < 0.5, 'fading out');
    assert.equal(await s.isDone(), false);
    s.step(3300);
    assert.equal(await s.isDone(), true);
    assert.equal(s.els.removed, true);
});
await test('a key press or a click skips it immediately and is not passed on to the game', async () => {
    const s = boot();
    s.step(0); s.step(100);
    let stopped = false;
    s.listeners.keydown({ stopPropagation() { stopped = true; }, preventDefault() {} });
    assert.equal(await s.isDone(), true); assert.equal(stopped, true);
    const c = boot(); c.step(0);
    c.els['pstn-splash'].listeners.pointerdown({ stopPropagation() {} });
    assert.equal(await c.isDone(), true);
});
await test('prefers-reduced-motion: no push or retract, the lockup is simply centred', () => {
    const s = boot({ reduced: true });
    s.step(0);
    const lockY = parseFloat(s.els['pstn-lock'].style.transform.match(/,\s*(-?[\d.]+)px/)[1]);
    assert.ok(Math.abs(lockY + 50 - 400) < 1);
});
await test('Player.startGame loads the scene, then waits for the splash before running the game', async () => {
    const { Scene, makeCanvas } = await loadLoopHarness();
    const { SceneRegistry } = await import('../SceneRegistry.js');
    const { startGame } = await import('../Player.js');
    globalThis.requestAnimationFrame = () => 0;
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' });
    SceneRegistry.register(new Scene({ id: 'splashtest', name: 's', create: () => [] }));
    let release; globalThis.__PISTON_SPLASH__ = new Promise(r => { release = r; });
    const canvas = Object.assign(makeCanvas(), { style: {}, clientWidth: 100, clientHeight: 100 });
    let loop = null; const started = startGame({ canvas, startScene: 'splashtest' }).then(l => { loop = l; });
    await new Promise(r => setTimeout(r, 50));
    assert.equal(loop, null, 'the game must not be running while the splash is up');
    release(); await started;
    assert.ok(loop && loop.playState !== undefined);
    delete globalThis.__PISTON_SPLASH__;
});
await test('a release without the splash refuses to start', async () => {
    const { Scene, makeCanvas } = await loadLoopHarness();
    const { SceneRegistry } = await import('../SceneRegistry.js');
    const { startGame } = await import('../Player.js');
    SceneRegistry.register(new Scene({ id: 'nosplash', name: 'n', create: () => [] }));
    globalThis.__PISTON_PROJECT__ = { release: true }; delete globalThis.__PISTON_SPLASH__;
    const canvas = Object.assign(makeCanvas(), { style: {}, clientWidth: 100, clientHeight: 100 });
    await assert.rejects(() => startGame({ canvas, startScene: 'nosplash' }), /Made with Piston/);
    delete globalThis.__PISTON_PROJECT__;
});
console.log(`${passed} splash tests passed`);
process.exit(0);
