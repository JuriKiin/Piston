// In-game stress test for Neon Warden (the methodology from BENCHMARKS.md, "In-game stress test").
// Serve a build (Piston --build Samples/NeonWarden, then --serve dist/web), open it in a browser, and paste this whole file into the DevTools console
// (or run it with an automation tool's JavaScript eval). It returns a JSON string and needs a visible tab (a hidden tab throttles requestAnimationFrame).
// It works on both builds: with the EntityPool code it spawns orbs through Orb.spawn (pooled), without it through `new Orb` + Game.spawn.
(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const G = window.NeonWarden, loop = window.Piston.gameLoop;
    if (G.state === 'title') await window.Piston.scenes.load('arena');
    for (let i = 0; i < 100 && !(window.NeonWarden.director && window.NeonWarden.player); i++) await wait(100);
    const { Orb, Fx } = window.NeonWarden.dev;
    const CX = 960, CY = 540;
    const pooled = typeof Orb.spawn === 'function';
    setInterval(() => { const p = G.player; if (p) { p.hp = 5; p.invuln = 10; } }, 50); // the player never dies
    G.director.toBoss(); await wait(6000); // boss phase, as in the original measurements
    const mk = (x, y, a, speed, life) => { const o = pooled ? Orb.spawn(x, y, a, { speed }) : G.spawn(new Orb(x, y, a, { speed })); if (life) o.life = life; return o; };
    const orbs = () => loop.entities.filter(e => e.constructor === Orb && e.active !== false && !e.destroyed);
    const clear = async () => { for (const o of orbs()) o.destroy(); await wait(300); };
    const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
    const measure = (frames, perFrame) => new Promise((resolve) => {
        const upd = [], raf = []; const orig = loop.update; let last = performance.now(), n = 0;
        loop.update = function (...a) { const t = performance.now(); const r = orig.apply(this, a); upd.push(performance.now() - t); return r; };
        const tick = (now) => { raf.push(now - last); last = now; if (perFrame) perFrame(n); if (++n < frames) requestAnimationFrame(tick); else { loop.update = orig; const avg = (x) => x.reduce((s, v) => s + v, 0) / x.length;
            resolve({ frames, entities: loop.entities.length, updateAvgMs: +avg(upd).toFixed(2), updateP95Ms: +pct(upd, 0.95).toFixed(2), updateMaxMs: +Math.max(...upd).toFixed(2), rafAvgMs: +avg(raf).toFixed(2), rafP95Ms: +pct(raf, 0.95).toFixed(2), rafMaxMs: +Math.max(...raf).toFixed(2) }); } };
        requestAnimationFrame(tick);
    });
    const out = { pooled, engineFixedHz: loop.fixedHz ?? null, canvas: [loop.canvas.width, loop.canvas.height] };

    // 1. Cost of spawning 500 orbs in one frame, from a cold start: the first batch builds them, the second recycles (pooled) or builds again (not pooled)
    const timeSpawn = () => { const t = performance.now(); const list = []; for (let i = 0; i < 500; i++) list.push(mk(CX, CY, i, 100, 3)); return [performance.now() - t, list]; };
    const [t1, l1] = timeSpawn(); l1.forEach(o => o.destroy()); await wait(400);
    const [t2, l2] = timeSpawn(); l2.forEach(o => o.destroy()); await wait(400);
    out.spawn500 = { firstBatchMs: +t1.toFixed(1), secondBatchMs: +t2.toFixed(1) };
    await clear();

    // 2. Burst-spawn stress: 16 moving orbs every 120 ms + an explosion every 0.5 s, for 10 s
    let lastOrb = 0, lastExp = 0, heap0 = performance.memory?.usedJSHeapSize;
    out.burst = await measure(600, () => { const now = performance.now();
        if (now - lastOrb > 120) { lastOrb = now; const a0 = Math.random() * 6.283; for (let i = 0; i < 16; i++) mk(CX, CY, a0 + i * 0.39, 190, 5); }
        if (now - lastExp > 500) { lastExp = now; const a = Math.random() * 6.283; Fx.explosion(CX + Math.cos(a) * 250, CY + Math.sin(a) * 250); } });
    out.burst.orbsAlive = orbs().length; out.burst.heapDeltaMB = heap0 ? +(((performance.memory.usedJSHeapSize - heap0) / 1048576).toFixed(1)) : null;
    await clear();
    // 3. Stationary orbs (per-entity cost)
    out.stationary = {};
    for (const N of [500, 1000, 2000]) {
        for (let i = 0; i < N; i++) { const a = Math.random() * 6.283, r = 60 + Math.random() * 360; mk(CX + Math.cos(a) * r, CY + Math.sin(a) * r, 0, 0, 1e9); }
        await wait(500); out.stationary[N] = await measure(120); await clear();
    }

    return JSON.stringify(out);
})();
