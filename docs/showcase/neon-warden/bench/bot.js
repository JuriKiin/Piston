// A deliberately imperfect Neon Warden player, for balance checks. NOT a human: it only tells you roughly how a decent-but-flawed player fares.
// Paste into the console of a served build (Piston --build Samples/NeonWarden; Piston --serve .../dist/web), then:
//     await __bot.run({ runs: 10 })      // -> { winRate, results: [...] }
// It fast-forwards the game on a fake clock (rendering, post-processing and audio are switched off), starts each fight at the boss with full HP and a
// non-invulnerable player, and plays like this: decisions only every `reaction` s, orb positions seen with `perception` px of noise, only orbs within
// `sight` px are considered, `mistake` of decisions are random, the cursor lags and wobbles (`aimNoise` rad), dash used `dashSkill` of the time it would help, and it only holds the trigger `fireRatio` of the time.
(() => {
    const defaults = { runs: 10, reaction: 0.22, perception: 18, sight: 300, mistake: 0.08, aimNoise: 0.07, aimLag: 0.2, dashSkill: 0.6, fireRatio: 1, immortal: false, maxSeconds: 150, seed: 1 };
    const rng = (s) => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const CX = 960, CY = 540, PLAY_R = 436, SPEED = 560, DIRS = [[0, 0], ...Array.from({ length: 16 }, (_, i) => [Math.cos(i * Math.PI / 8), Math.sin(i * Math.PI / 8)])];

    async function run(options = {}) {
        const o = { ...defaults, ...options }, G = window.NeonWarden, loop = window.Piston.gameLoop, results = [];
        const realNow = performance.now.bind(performance), update = loop.update;
        let fake = realNow();
        performance.now = () => fake;
        loop.update = () => {}; // the browser's own rAF loop does nothing while we drive the game
        let Ent = Object.getPrototypeOf(window.NeonWarden.player ?? loop.entities.find(e => e.tag === 'Player') ?? loop.entities[0]);
        while (Ent && Ent.constructor.name !== 'Entity') Ent = Object.getPrototypeOf(Ent);
        const realRender = Ent.render; Ent.render = () => {};
        const audioPlay = window.Piston.audio.play; window.Piston.audio.play = () => null;
        // A canvas with no layout box (a background tab) would make the mouse mapping NaN: give it a 1:1 box for the run.
        const realRect = loop.canvas.getBoundingClientRect; loop.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: loop.canvas.width, height: loop.canvas.height, right: loop.canvas.width, bottom: loop.canvas.height });
        const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
        try {
            for (let r = 0; r < o.runs; r++) {
                const rand = rng(o.seed * 1000 + r);
                await window.Piston.scenes.load('arena');
                for (let i = 0; i < 50 && !(G.director && G.player); i++) await new Promise(x => setTimeout(x, 20));
                for (const e of loop.entities) for (const c of e.components ?? []) if (c.constructor.name === 'PostProcess') c.enabled = false;
                const step = () => { fake += 1000 / 60; update.call(loop, fake); };
                step(); G.director.toBoss();
                const held = new Set(), setKeys = (want) => { for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) { if (want.has(k) && !held.has(k)) { key('keydown', k); held.add(k); } else if (!want.has(k) && held.has(k)) { key('keyup', k); held.delete(k); } } };
                let firing = false; const setFire = (on) => { if (on && !firing) key('keydown', 'KeyJ'); else if (!on && firing) key('keyup', 'KeyJ'); firing = on; }; setFire(true);
                let t = 0, nextDecision = 0, want = new Set(), mx = CX, my = CY, maxLive = 0, liveSum = 0, liveN = 0, hits = 0, lastHp = G.player.hp, outcome = 'timeout';
                while (t < o.maxSeconds) {
                    const p = G.player, pp = p.transform.position;
                    if (o.immortal) { p.hp = p.maxHp; p.invuln = 5; } // for projectile-count measurements only
                    const orbs = loop.entities.filter(e => e.constructor.name === 'Orb' && e.active !== false && !e.destroyed);
                    if (Math.round(t * 60) % 10 === 0) { maxLive = Math.max(maxLive, orbs.length); liveSum += orbs.length; liveN++; }
                    if (p.hp < lastHp) { hits += lastHp - p.hp; lastHp = p.hp; }
                    if (t >= nextDecision && !p.dead) {
                        nextDecision = t + o.reaction * (0.7 + 0.6 * rand());
                        const threats = [];
                        for (const e of orbs) { const d = Math.hypot(e.transform.position.x - pp.x, e.transform.position.y - pp.y); if (d < o.sight) threats.push({ x: e.transform.position.x + (rand() - 0.5) * 2 * o.perception, y: e.transform.position.y + (rand() - 0.5) * 2 * o.perception, vx: e.vx, vy: e.vy, r: e.big ? 24 : 12 }); }
                        for (const e of loop.entities) if (!e.destroyed && e.active !== false && (e.tag === 'WardenSegment' || e.tag === 'WardenTail' || e.tag === 'Warden' || e.tag === 'Drone')) threats.push({ x: e.transform.position.x, y: e.transform.position.y, vx: 0, vy: 0, r: e.tag === 'Warden' ? 62 : e.tag === 'Drone' ? 24 : 46 });
                        let best = null, bestCost = Infinity, bestHit = 99;
                        const order = rand() < o.mistake ? [Math.floor(rand() * DIRS.length)] : DIRS.map((_, i) => i);
                        for (const di of order) {
                            const [dx, dy] = DIRS[di]; let cost = 0, firstHit = 99, x = pp.x, y = pp.y;
                            for (let s = 1; s <= 11; s++) {
                                const tt = s * 0.05; x += dx * SPEED * 0.05; y += dy * SPEED * 0.05;
                                const rr = Math.hypot(x - CX, y - CY); if (rr > PLAY_R) { x = CX + (x - CX) / rr * PLAY_R; y = CY + (y - CY) / rr * PLAY_R; }
                                for (const th of threats) { const c = Math.hypot(x - (th.x + th.vx * tt), y - (th.y + th.vy * tt)) - (th.r + 20 + 6); if (c < 0) { cost += 40; firstHit = Math.min(firstHit, tt); } else if (c < 70) cost += (70 - c) / 70 * 3; }
                            }
                            cost += Math.max(0, Math.hypot(x - CX, y - CY) - 330) * 0.03 + (di === 0 ? 0.3 : 0);
                            if (cost < bestCost) { bestCost = cost; best = di; bestHit = firstHit; }
                        }
                        want = new Set(); const [bx, by] = DIRS[best];
                        if (bx > 0.3) want.add('KeyD'); if (bx < -0.3) want.add('KeyA'); if (by > 0.3) want.add('KeyS'); if (by < -0.3) want.add('KeyW');
                        setKeys(want); setFire(rand() < o.fireRatio); // a real player stops shooting to concentrate on dodging
                        if (bestHit < 0.25 && p.dashCd <= 0 && rand() < o.dashSkill) { key('keydown', 'Space'); key('keyup', 'Space'); }
                    }
                    // aim at the boss head (or the arena centre) with lag and wobble
                    const head = G.boss && !G.boss.destroyed ? G.boss.transform.position : { x: CX, y: CY };
                    const ang = Math.atan2(head.y - pp.y, head.x - pp.x) + (rand() - 0.5) * 2 * o.aimNoise, dist = Math.hypot(head.x - pp.x, head.y - pp.y);
                    mx += (pp.x + Math.cos(ang) * dist - mx) * o.aimLag; my += (pp.y + Math.sin(ang) * dist - my) * o.aimLag;
                    const s = loop.camera.worldToScreen({ x: mx, y: my }, loop.canvas.width, loop.canvas.height), rect = loop.canvas.getBoundingClientRect();
                    window.dispatchEvent(new MouseEvent('mousemove', { clientX: rect.left + s.x * rect.width / loop.canvas.width, clientY: rect.top + s.y * rect.height / loop.canvas.height }));
                    step(); t += 1 / 60;
                    if (G.state === 'win') { outcome = 'win'; break; } if (G.state === 'lose') { outcome = 'lose'; break; }
                    if (Math.round(t * 60) % 300 === 0) await new Promise(x => setTimeout(x, 0));
                }
                setFire(false); setKeys(new Set());
                results.push({ outcome, seconds: +t.toFixed(1), hits, hpLeft: G.player.hp, bossHp: G.boss?.hp ?? 0, maxLiveOrbs: maxLive, avgLiveOrbs: +(liveSum / Math.max(1, liveN)).toFixed(1) });
            }
        } finally {
            loop.canvas.getBoundingClientRect = realRect; performance.now = realNow; loop.update = update; Ent.render = realRender; window.Piston.audio.play = audioPlay;
        }
        const wins = results.filter(r => r.outcome === 'win').length;
        return { winRate: +(wins / results.length).toFixed(2), wins, runs: results.length, avgSecondsOnWin: +(results.filter(r => r.outcome === 'win').reduce((s, r) => s + r.seconds, 0) / Math.max(1, wins)).toFixed(1), avgMaxLiveOrbs: +(results.reduce((s, r) => s + r.maxLiveOrbs, 0) / results.length).toFixed(0), avgLiveOrbs: +(results.reduce((s, r) => s + r.avgLiveOrbs, 0) / results.length).toFixed(1), avgHits: +(results.reduce((s, r) => s + r.hits, 0) / results.length).toFixed(1), results };
    }
    window.__bot = { run, defaults };
})();
