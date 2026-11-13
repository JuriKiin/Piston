// Run: node Engine/web/tests/splash.test.mjs   (no browser needed)
// The "Made with Piston" splash that Release builds inline into index.html (Templates/export/web/splash.html), and the Player hook that waits for it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadLoopHarness } from './_harness.mjs';

let passed = 0; const test = async (n, f) => { await f(); passed++; console.log('PASS', n); };
const html = fs.readFileSync(fileURLToPath(new URL('../../../Templates/export/web/splash.html', import.meta.url)), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

/** Runs the splash script against a stub page; returns handles to drive its clock and inspect what it did to the DOM. */
function boot({ reduced = false } = {}) {
    const mk = (w = 0, h = 0) => ({ style: {}, offsetWidth: w, offsetHeight: h, parentNode: null });
    const els = { 'pstn-rod': mk(), 'pstn-plate': mk(0, 18), 'pstn-lock': mk(300, 100), 'pstn-made': mk(0, 14), 'pstn-splash': Object.assign(mk(), { listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, removeEventListener() {} }) };
    els['pstn-splash'].parentNode = { removeChild() { els.removed = true; } };
    const listeners = {}; let raf = null;
    const window = { innerHeight: 800, matchMedia: () => ({ matches: reduced }), addEventListener(t, f) { listeners[t] = f; }, removeEventListener() {}, requestAnimationFrame(f) { raf = f; } };
    new Function('window', 'document', script)(window, { getElementById: id => els[id] });
    let settled = false; window.__PISTON_SPLASH__.then(() => { settled = true; });
    return { els, window, listeners, isDone: async () => { await Promise.resolve(); await Promise.resolve(); return settled; }, step: ms => { const f = raf; raf = null; f?.(ms); } };
}

await test('the splash is an inline fragment: one script, no external requests', () => {
    assert.ok(html.includes('id="pstn-splash"') && html.includes('MADE WITH') && html.includes('>Piston<'));
    assert.ok(!/(src|href)=["']https?:/.test(html) && !/<script[^>]+src=/.test(html) && !/url\(/.test(html));
    assert.ok(html.length < 8000, `splash is ${html.length} bytes`);
});
await test('it plays for about two seconds, pushes the lockup to the centre, then resolves and removes itself', async () => {
    const s = boot();
    s.step(0);
    assert.equal(await s.isDone(), false);
    s.step(900);                                   // the press has just pushed the lockup into place
    const lockY = parseFloat(s.els['pstn-lock'].style.transform.match(/,\s*(-?[\d.]+)px/)[1]);
    assert.ok(Math.abs(lockY + 50 - 400) < 25, `lockup centre ${lockY + 50} should be near 400`);
    s.step(1500);
    assert.equal(s.els['pstn-made'].style.opacity, '1');
    s.step(1900);
    assert.ok(parseFloat(s.els['pstn-splash'].style.opacity) < 0.5, 'fading out');
    assert.equal(await s.isDone(), false);
    s.step(2100);
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
console.log(`${passed} splash tests passed`);
process.exit(0);
