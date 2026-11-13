import { Vector2 } from "@piston/Physics/Vector2.js";
import { UIElement } from "@piston/UIElement.js";
import { Text } from "@piston/UI/Text.js";
import { Animator } from "@piston/Animator.js";
import { ParticleEmitter } from "@piston/ParticleEmitter.js";
import { PostProcess } from "@piston/PostProcess.js";
import { EntityRegistry } from "@piston/EntityRegistry.js";
import Constants from "@piston/static/Constants.js";
import input from "@piston/static/Input.js";
import { Actor, Game, pressed, setupCollisionMatrix, mkSprite, CX, CY, ARENA_R, ART, clamp, lerp, rand } from "./Game.js";
import { Player } from "./Player.js";
import { Drone, Turret } from "./Enemies.js";
import { Warden } from "./Boss.js";
import { Orb, Bolt } from "./Projectiles.js";
import { Fx } from "./Fx.js";
import { sfx, music } from "./Sfx.js";

const FONT = 'sans-serif';
const AMBIENT_DARK = [0.03, 0.04, 0.09], AMBIENT = [0.5, 0.55, 0.74];
const hex = (v) => '#' + v.map(x => Math.round(clamp(x, 0, 1) * 255).toString(16).padStart(2, '0')).join('');

/** Soft drifting dust motes over the arena. */
export class DustEmitter extends Actor {
    constructor(x = CX, y = CY) { super(); this.tag = 'Dust'; this.order = 12; this.px = x; this.py = y; }
    start() {
        this.transform.position = new Vector2(this.px, this.py);
        this.addComponent(new ParticleEmitter({ emitting: true, rate: 2.5, imagePath: ART + 'glow.png', blendMode: 'additive', angle: -80, spread: 120, speed: 22, speedVariation: 0.6, lifetime: 7,
            startSize: 9, endSize: 2, startColor: '#6ab8ff', endColor: '#2060c0', fade: true, sortingOrder: 12, maxParticles: 60, sizeVariation: 0.5 }));
    }
}

/** A screen-space HUD piece built from components. */
function hud(x, y, w, h, ...components) {
    const e = new UIElement(new Vector2(x, y), new Vector2(w, h));
    e.space = 'Screen';
    Game.spawn(e);
    for (const c of components) e.addComponent(c);
    return e;
}
const text = (t, size, color = '#d8fbff', align = 'center', order = 90) => new Text({ text: t, fontFamily: FONT, fontSize: size, color, align, sortingOrder: order });

/**
 * The Director runs the whole fight: it sets up the arena (player, HUD, dust), steps through intro, two waves, the boss, and the win/lose
 * screens, and owns the screen effects (camera shake, bloom, ambient light, damage vignette, chromatic pulse). All of it is game code on
 * top of the engine's generic components.
 */
export class Director extends Actor {
    static description = 'Runs the Neon Warden fight: waves, boss, HUD, screen effects, win and lose.';
    constructor() { super(); this.tag = 'Director'; this.order = -100; this.t = 0; this.stateT = 0; this.spawned = 0; this.spawnT = 0; this.vig = 0; this.chroma = 0; this.flashAmt = 0; this.ambientK = 0; this.lastBoss = 1; this.ended = false; }

    // The engine keeps entities spawned from start(), so the whole setup runs here. Side effects that must only happen while the game runs (music, hiding the cursor) wait for the first update.
    start() {
        Game.reset(); Game.director = this; setupCollisionMatrix();
        Game.dev = { Fx, Orb, Bolt, Drone, Warden }; // for the browser console and the performance checks in docs/showcase/neon-warden/PROGRESS.md
        Game.state = 'intro';
        for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + 0.4, r = 120 + (i % 2) * 220; Game.spawn(new DustEmitter(CX + Math.cos(a) * r, CY + Math.sin(a) * r)); }
        Game.player = Game.spawn(new Player(CX, CY + 120));
        this.buildHud();
        this.say('WARDEN ONLINE', 'survive the swarm', '#33e6ff');
    }
    begin() {
        this.begun = true;
        document.body.style.cursor = 'none';
        music.play('calm', 0.55);
        sfx.play('spawn', { minGap: 0 }); Fx.ring(CX, CY + 120, { color: 'cyan', from: 40, to: 380, time: 0.7 });
    }
    onDestroy() { document.body.style.cursor = ''; }

    get cam() { return this._cam ??= Game.loop.entities.find(e => e.tag === 'MainCamera'); }
    get post() { return this._post ??= Game.loop.entities.map(e => e.getComponent(PostProcess)).find(Boolean); }

    // ------------------------------------------------------------------ HUD
    buildHud() {
        this.pips = [0, 1, 2, 3, 4].map(i => hud(76 + i * 56, 64, 52, 52, mkSprite('pip.png', { fw: 96, fh: 96, frames: 2, fps: 0, order: 90 })));
        this.scoreText = hud(1850, 56, 10, 10, text('0', 44, '#ffffff', 'right'));
        this.comboText = hud(1850, 104, 10, 10, text('', 26, '#ffb02e', 'right'));
        this.timeText = hud(76, 128, 10, 10, text('0:00', 24, '#8fa3d8', 'left'));
        this.dashFrame = hud(176, 1030, 212, 20, mkSprite('bar_frame.png', { order: 90 }));
        this.dashFill = hud(76, 1030, 200, 12, mkSprite('dash_fill.png', { order: 91, ax: 0 }));
        this.dashLabel = hud(76, 1004, 10, 10, text('DASH', 18, '#8fa3d8', 'left'));
        this.bossName = hud(CX, 28, 10, 10, text('THE WARDEN', 22, '#ffb02e', 'center')); this.bossName.getComponent(Text).color = '#ffb02e00';
        this.bossFrame = hud(CX, 64, 820, 26, mkSprite('bar_frame.png', { order: 90, opacity: 0 }));
        this.bossChip = hud(CX - 390, 64, 780, 14, mkSprite('bar_chip.png', { order: 91, ax: 0, opacity: 0 }));
        this.bossFill = hud(CX - 390, 64, 780, 14, mkSprite('bar_fill.png', { order: 92, ax: 0, opacity: 0 }));
        this.chipFrac = 1;
        this.msg = hud(CX, 380, 10, 10, text('', 40, '#33e6ff00', 'center', 95), new Animator({ playOnStart: false, clips: [{ name: 'show', duration: 2.4, loop: false, tracks: [
            { path: 'Text.fontSize', keys: [{ t: 0, v: 40, ease: 'backOut' }, { t: 0.35, v: 104, ease: 'easeOut' }, { t: 2.4, v: 112 }] },
            { path: 'Text.color', keys: [{ t: 0, v: 'rgba(255,255,255,0)', ease: 'easeOut' }, { t: 0.25, v: 'rgba(255,255,255,1)', ease: 'linear' }, { t: 1.9, v: 'rgba(255,255,255,1)', ease: 'easeIn' }, { t: 2.4, v: 'rgba(255,255,255,0)' }] }], events: [] },
            { name: 'stay', duration: 1, loop: false, tracks: [{ path: 'Text.fontSize', keys: [{ t: 0, v: 40, ease: 'backOut' }, { t: 0.4, v: 110 }] }, { path: 'Text.color', keys: [{ t: 0, v: 'rgba(255,255,255,0)', ease: 'easeOut' }, { t: 0.3, v: 'rgba(255,255,255,1)' }] }], events: [] }] }));
        this.sub = hud(CX, 470, 10, 10, text('', 28, '#8fa3d8', 'center', 95));
        this.cross = hud(CX, CY, 56, 56, mkSprite('crosshair.png', { order: 99, blend: 'additive' }));
    }
    say(title, sub = '', color = '#ffffff', stay = false) {
        const t = this.msg.getComponent(Text), an = this.msg.getComponent(Animator);
        t.text = title; this.sub.getComponent(Text).text = sub;
        this.msgColor = color; this.subClear = stay ? 0 : 2.4;
        an.play(stay ? 'stay' : 'show', { restart: true });
    }

    // ------------------------------------------------------------------ screen effects
    damagePulse() { this.vig = 1; this.chroma = Math.max(this.chroma, 9); this.flashAmt = Math.max(this.flashAmt, 0.35); }
    chromaticPulse(px) { this.chroma = Math.max(this.chroma, px); }
    bigFlash(a = 1) { this.flashAmt = Math.max(this.flashAmt, a); }
    bossPhase(n) { this.bigFlash(0.5); this.chroma = 12; this.say(n === 2 ? 'SHOCKWAVES' : 'ENRAGED', n === 2 ? 'dash through the rings' : 'the beam sweeps', '#ff2e88'); }

    updateFx(dt) {
        const g = Game;
        g.applyTime();
        // camera shake: trauma squared, decays quickly; zoom punch decays too
        g.trauma = Math.max(0, g.trauma - dt * 1.7); g.zoomKick = Math.max(0, g.zoomKick - dt * 0.4);
        const s = g.trauma * g.trauma, t = performance.now() / 1000, cam = this.cam;
        if (cam) {
            cam.transform.position.x = CX + (Math.sin(t * 71) + Math.sin(t * 43 + 1)) * 0.5 * 26 * s;
            cam.transform.position.y = CY + (Math.sin(t * 59 + 2) + Math.sin(t * 37)) * 0.5 * 26 * s;
            const camera = cam.components.find(c => c.zoom !== undefined); if (camera) camera.zoom = 1 + g.zoomKick;
        }
        const p = this.post; if (!p) return;
        this.vig = Math.max(0, this.vig - dt * 1.6); this.chroma = Math.max(0, this.chroma - dt * 22); this.flashAmt = Math.max(0, this.flashAmt - dt * 2.2);
        this.ambientK = clamp(this.ambientK + dt * (g.state === 'intro' || this.t < 3 ? 0.4 : 1), 0, 1);
        const lowHp = g.player && g.player.hp <= 1 && !g.player.dead ? 0.15 + 0.1 * Math.sin(performance.now() / 150) : 0;
        p.ambient = hex([lerp(AMBIENT_DARK[0], AMBIENT[0], this.ambientK), lerp(AMBIENT_DARK[1], AMBIENT[1], this.ambientK), lerp(AMBIENT_DARK[2], AMBIENT[2], this.ambientK)]);
        p.vignette = 0.45 + this.vig * 0.5 + lowHp; p.vignetteColor = this.vig > 0.02 || lowHp ? '#ff1030' : '#000000';
        p.chromatic = this.chroma + 0.8; p.flashAmount = this.flashAmt; p.flashColor = g.state === 'win' ? '#ffffff' : '#ffd8c0';
    }

    // ------------------------------------------------------------------ flow
    enter(state) { Game.state = state; this.stateT = 0; }
    update() {
        super.update();
        if (!this.begun) this.begin();
        const dt = Constants.DELTA_TIME, g = Game;
        this.updateFx(dt);
        this.updateHud(dt);
        // Input edges last one step, so read them before the hit-stop early return below.
        if ((g.state === 'win' || g.state === 'lose') && this.stateT > 1.5 && (pressed('KeyR', 'Enter') || (pressed('Click') && this.stateT > 2.5))) this.restart();
        if (pressed('Escape') && !this.leaving) { this.leaving = true; music.stop(); window.Piston.scenes.load('title'); }
        if (dt === 0) return;
        if (this.subClear > 0) { this.subClear -= dt; if (this.subClear <= 0) this.sub.getComponent(Text).text = ''; }
        this.t += dt; this.stateT += dt;
        if (g.state !== 'win' && g.state !== 'lose') g.elapsed += dt;
        g.comboTimer -= dt; if (g.comboTimer <= 0) g.combo = Math.max(1, g.combo - dt * 1.5);
        const drones = [...g.enemies].filter(e => e instanceof Drone), turrets = [...g.enemies].filter(e => e instanceof Turret);
        switch (g.state) {
            case 'intro':
                if (this.stateT > 2.6) { this.enter('wave1'); this.say('WAVE 1', 'drone swarm', '#ff2e88'); this.spawnT = 0.2; }
                break;
            case 'wave1':
                this.spawnT -= dt;
                if (this.spawned < 28 && this.spawnT <= 0 && drones.length < 14) { this.spawnDrones(4); this.spawnT = 3.4; }
                if ((this.spawned >= 28 && drones.length === 0) || this.stateT > 75) { this.enter('wave2'); this.say('WAVE 2', 'turrets online', '#ffb02e'); this.spawned = 0; this.spawnT = 0.2; this.spawnTurrets(); }
                break;
            case 'wave2':
                this.spawnT -= dt;
                if (this.spawnT <= 0 && drones.length < 6 && this.stateT > 2) { this.spawnDrones(3); this.spawnT = 5; }
                if (turrets.length === 0 && this.stateT > 2) this.toBoss();
                else if (this.stateT > 70) { turrets.forEach(t => t.sink()); }
                break;
            case 'boss-warning':
                if (this.stateT > 2.6 && !this.bossSpawned) { this.bossSpawned = true; this.enter('boss'); Game.spawn(new Warden()); music.play('boss', 0.6); }
                break;
            case 'boss': break;
        }
        if (g.state === 'boss' || g.state === 'boss-warning') { /* alarm handled on entry */ }
    }
    restart() { if (this.restarting) return; this.restarting = true; sfx.play('click', { minGap: 0 }); music.stop(); window.Piston.scenes.restart(); }

    rimPoint() { const a = rand(0, Math.PI * 2), r = rand(300, 410); return { x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r }; }
    spawnDrones(n) {
        const a0 = rand(0, Math.PI * 2);
        for (let i = 0; i < n; i++) { const a = a0 + i * 0.5, r = 420; Game.spawn(new Drone(CX + Math.cos(a) * r, CY + Math.sin(a) * r)); this.spawned++; }
        sfx.play('spawn', { volume: 0.5, minGap: 0.4 });
    }
    spawnTurrets() { for (const deg of [45, 135, 225, 315]) { const a = deg * Math.PI / 180; Game.spawn(new Turret(CX + Math.cos(a) * 350, CY + Math.sin(a) * 350)); } }
    toBoss() {
        this.enter('boss-warning'); this.bossSpawned = false;
        this.say('WARNING', 'the Warden awakens', '#ff2e88');
        sfx.play('alarm', { volume: 0.9, minGap: 0 }); this.vig = 1; this.chroma = 8;
        for (const e of [...Game.enemies]) { if (e instanceof Drone) e.die(true); else if (e instanceof Turret) e.sink(); }
    }
    onBossDead(head) {
        this.enter('win'); this.ended = true;
        Game.shake(1); Game.slowmo(0.28, 2600); this.bigFlash(1); music.stop(); sfx.play('boom_big', { minGap: 0, volume: 1 });
        for (const o of Game.loop.entities) if (o instanceof Orb) o.destroy();
        const segs = [...Game.enemies].filter(e => e.boss === head);
        segs.forEach((s, i) => setTimeout(() => { if (!s.destroyed) { s.dying = true; const p = s.transform.position; Fx.explosion(p.x, p.y, { scale: 1.2 }); sfx.play('seg_break', { volume: 0.7, minGap: 0.05 }); Game.shake(0.5); s.destroy(); } }, 140 * i + 200));
        const p = head.transform.position;
        setTimeout(() => { Fx.explosion(p.x, p.y, { big: true, scale: 1.3 }); Fx.ring(p.x, p.y, { color: 'amb', from: 50, to: 1400, time: 1.2 }); Fx.ring(p.x, p.y, { color: 'cyan', from: 30, to: 1100, time: 1.0 }); this.bigFlash(1); Game.shake(1); sfx.play('boom_big', { minGap: 0 }); }, 140 * segs.length + 400);
        Game.addScore(5000);
        setTimeout(() => { sfx.play('win', { minGap: 0 }); this.say('WARDEN DOWN', '', '#ffb02e', true); this.showResult('R / Enter / click to play again'); }, 140 * segs.length + 1600);
    }
    onPlayerDead() {
        this.enter('lose'); music.stop();
        setTimeout(() => { sfx.play('lose', { minGap: 0 }); this.say('SYSTEM FAILURE', '', '#ff2e88', true); this.showResult('R / Enter / click to retry'); }, 1200);
    }
    showResult(hint) {
        const m = Math.floor(Game.elapsed / 60), s = Math.floor(Game.elapsed % 60).toString().padStart(2, '0');
        this.sub.getComponent(Text).text = `score ${Game.score.toLocaleString()}   time ${m}:${s}   kills ${Game.kills}      ${hint}`;
        this.stateT = 0;
    }

    updateHud(dt) {
        const g = Game, pl = g.player;
        for (let i = 0; i < 5; i++) this.pips[i].components[0].currentFrame = pl && i < pl.hp ? 0 : 1;
        this.scoreText.getComponent(Text).text = g.score.toLocaleString();
        this.comboText.getComponent(Text).text = g.combo >= 1.5 ? `x${g.combo.toFixed(1)}` : '';
        const m = Math.floor(g.elapsed / 60), s = Math.floor(g.elapsed % 60).toString().padStart(2, '0');
        this.timeText.getComponent(Text).text = `${m}:${s}`;
        const cd = pl ? clamp(1 - pl.dashCd / 0.9, 0, 1) : 1;
        this.dashFill.transform.size = new Vector2(Math.max(1, 200 * cd), 12); this.dashFill.components[0].opacity = cd >= 1 ? 1 : 0.55;
        const boss = g.boss, showBoss = !!boss && g.state === 'boss';
        for (const e of [this.bossFrame, this.bossChip, this.bossFill]) e.components[0].opacity = showBoss ? 1 : 0;
        this.bossName.getComponent(Text).color = showBoss ? '#ffb02e' : '#ffb02e00';
        if (boss) {
            const f = clamp(boss.hp / boss.maxHp, 0, 1);
            this.chipFrac = Math.max(f, this.chipFrac - dt * 0.35);
            this.bossFill.transform.size = new Vector2(Math.max(1, 780 * f), 14); this.bossChip.transform.size = new Vector2(Math.max(1, 780 * this.chipFrac), 14);
        }
        // message colour: Text.color is animated white; tint by sub colour through the sub line's own colour
        this.sub.getComponent(Text).color = this.msgColor ?? '#8fa3d8';
        const mouse = input.getCanvasMousePosition(); this.cross.transform.position.x = mouse.x; this.cross.transform.position.y = mouse.y;
    }
}

EntityRegistry.register('Director', Director, 'Neon Warden');
