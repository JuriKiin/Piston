// Piston Game view: a SEPARATE runtime instance that runs the game for real (update + physics + input).
// It is created from a snapshot of the editor's document on Play and thrown away on Stop, so game state
// and editor state never mix (PISTON_SPEC.md §4.2). It never writes back to project data.

import { BRIDGE_VERSION, post, setupConsoleCapture, loadEngine, setupReceiver } from '/__piston__/common.js';

const params = new URLSearchParams(location.search);
const entryModule = params.get('entry');
setupConsoleCapture('game');

let engine = null;
let loop = null;
let canvas = null;
let frames = 0; // simulation frames run while Playing (also what Step advances)
let mouseDowns = 0; // raw DOM mousedowns that reached this page (input diagnostics)

// The game runs at a fixed design resolution (project.piston.json "resolution", passed as ?w=&h=) so it plays the
// same at any window size: the canvas keeps that internal size and is scaled to FIT the view, keeping its aspect
// ratio (letterboxed). The engine's mouse mapping already accounts for CSS scaling.
const designW = Math.max(16, Number(params.get('w')) || 800);
const designH = Math.max(16, Number(params.get('h')) || 600);
function sizeCanvas() {
    canvas.width = designW;
    canvas.height = designH;
    fitCanvas();
}
function fitCanvas() {
    const scale = Math.min(window.innerWidth / designW, window.innerHeight / designH);
    canvas.style.width = `${Math.floor(designW * scale)}px`;
    canvas.style.height = `${Math.floor(designH * scale)}px`;
}

async function boot() {
    engine = await loadEngine(params);
    if (entryModule) await import(entryModule);

    canvas = document.getElementById('c');
    sizeCanvas();
    loop = new engine.GameLoop(canvas, new engine.Scene({ id: '__play__', name: 'Game', backgroundColor: '#f0f0f0' }), { devTools: false });
    window.Piston = { gameLoop: loop, scenes: loop.scenes, audio: loop.audio }; // game code expects this (ENGINE_GUIDE §4)
    await loop.start();

    // Count simulation frames. GameLoop's own rAF loop calls this.update() every frame, so wrapping
    // the instance method sees all of them (and Step's manual call below).
    const original = loop.update.bind(loop);
    loop.update = () => { if (loop.playState === 'playing') frames++; original(); };

    window.addEventListener('resize', fitCanvas);
    window.addEventListener('mousedown', () => { mouseDowns++; }, true);
    post({ type: 'ready', from: 'game', bridge: BRIDGE_VERSION });
}

const live = () => loop.entities.filter(e => !e.destroyed);
const byKey = (key) => live().find(e => e._sceneKey === key);

setupReceiver({
    ping: () => 'pong',

    // Builds the scene from the editor's document (exactly how a level file would load).
    loadScene({ data, sceneId }) {
        // The Game view is built from the editor's document, but it must still know WHICH scene it is playing so that
        // engine scene flow (Piston.scenes.next()) continues from the right place.
        const known = sceneId ? engine.SceneRegistry.get(sceneId) : null;
        if (known) loop.scene = known;
        const entities = engine.SceneIO.buildEntitiesFromLevelData(loop, data);
        entities.forEach((e, i) => { if (!e._sceneKey) e._sceneKey = `${e.tag}#${i}`; });
        loop.entities = entities;
        // Same default the engine uses for any scene with no camera: world (0,0) at the canvas's top-left.
        if (!entities.some(e => e.getComponent(engine.Camera))) loop.addEntityFromRegistry(engine.MainCamera).__auto = true;
        frames = 0;
        return { entityCount: entities.length };
    },

    // Scene flow diagnostics (engine SceneManager): which scene is running and what comes next.
    getSceneInfo: () => ({ registered: engine.SceneRegistry.list().map(s => s.id), id: loop.scene?.id ?? null, next: loop.scenes.nextScene?.id ?? null, entities: live().length }),

    // Test hook: sinks the ball into the scene's Hole exactly as gameplay does, then reports where the game ended up.
    async testSinkHole() {
        const hole = live().find(e => e.tag === 'Hole');
        if (!hole) throw new Error('no Hole in this scene');
        const ball = live().find(e => e.tag === 'Ball');
        await hole.onSunk(ball);
        return { id: loop.scene?.id ?? null, entities: live().length, hasBall: live().some(e => e.tag === 'Ball') };
    },

    play() { loop.play(); return loop.playState; },

    pause() { loop.pause(); return loop.playState; },

    // One simulation frame while paused (or from a fresh start): the physics/debug workhorse.
    step() {
        if (loop.playState === 'edit') { loop.play(); loop.pause(); }
        const previous = loop.playState;
        loop.playState = 'playing';
        loop.update();
        loop.playState = previous;
        return frames;
    },

    getPlayInfo() {
        return {
            playState: loop.playState,
            frames,
            entityCount: live().filter(e => !e.__auto).length,
            scene: loop.scene?.id ?? null,
            mouseDowns,
        };
    },

    // Where an entity appears in the Game view, in page (CSS) pixels: camera-aware, like the player sees it.
    getScreenPos({ key }) {
        const e = byKey(key);
        if (!e) return null;
        const p = loop.camera.worldToScreen(e.transform.position, canvas.width, canvas.height);
        // CSS pixels inside the page (the canvas keeps a fixed design size and is scaled/letterboxed to fit), which is what native input needs.
        const r = canvas.getBoundingClientRect();
        return { x: r.left + p.x * r.width / canvas.width, y: r.top + p.y * r.height / canvas.height, w: canvas.width, h: canvas.height };
    },

    getEntityData({ key }) {
        const e = byKey(key);
        return e ? engine.SceneIO.serializeEntity(e) : null;
    },

    // Test/debug hook: tweak a live entity. Affects only THIS instance, which Stop discards.
    applyPatch({ ops }) {
        for (const op of ops) {
            const e = byKey(op.key);
            if (!e) continue;
            if (op.op === 'setTransform') {
                if (op.x !== undefined) e.transform.position.x = op.x;
                if (op.y !== undefined) e.transform.position.y = op.y;
            } else if (op.op === 'setField') {
                e[op.field] = op.value;
            }
        }
        return true;
    },
});

boot().catch((error) => post({ type: 'error', from: 'game', message: `Boot failed: ${error?.message ?? error}`, fatal: true }));
