// The Hub panel's picture, made with the Piston runtime itself: the brand mark drawn by a custom component, lit by Light2D, with
// additive particles and a beam, then PostProcess bloom/vignette. Rendered to a PNG by Tools/branding/make_hub_art.sh (headless Chrome).
import { Scene } from '@piston/Scene.js';
import { SceneRegistry } from '@piston/SceneRegistry.js';
import { Entity } from '@piston/Entity.js';
import { Transform } from '@piston/Transform.js';
import { Vector2 } from '@piston/Physics/Vector2.js';
import { Component } from '@piston/Component.js';
import { Light2D } from '@piston/Light2D.js';
import { PostProcess } from '@piston/PostProcess.js';
import { ParticleEmitter } from '@piston/ParticleEmitter.js';
import { BeamRenderer } from '@piston/BeamRenderer.js';
import Constants from '@piston/static/Constants.js';
import { startGame } from '@piston/Player.js';

const W = 660, H = 420, ORANGE = '#FF5A1F';

// Seeded so every render of the picture is identical.
let seed = 0x9e3779b9;
Math.random = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// The mark's geometry in the same 100-unit space as Tools/branding/make_icon.py, centred on the entity.
const K = 3.1;
class PistonMarkDraw extends Component {
    constructor() { super(); this.sortingOrder = 10; }
    draw(ctx) {
        ctx.save();
        ctx.scale(K, K);
        ctx.translate(-50, -52);
        const u = new Path2D('M22 38H30V78Q30 84 36 84H64Q70 84 70 78V38H78V79Q78 92 65 92H35Q22 92 22 79Z');
        ctx.fillStyle = ORANGE; ctx.fill(u);
        ctx.fillRect(46, 20, 8, 36);
        ctx.beginPath(); ctx.roundRect(38, 12, 24, 9, 4.5); ctx.fill();
        ctx.fillStyle = '#ffffff';                       // the head runs white-hot
        ctx.beginPath(); ctx.roundRect(34, 54, 32, 16, 3); ctx.fill();
        ctx.restore();
    }
}

/** A bare entity that only hosts components (the engine's Empty draws an editor crosshair, which we do not want here). */
class Anchor extends Entity { start() {} isColliding() { return false; } }
const make = (x, y, ...components) => {
    const e = new Anchor(new Transform(new Vector2(x, y), 0, new Vector2(10, 10)));
    components.forEach(c => e.addComponent(c));
    return e;
};

SceneRegistry.register(new Scene({
    id: 'hubart', name: 'Hub art', backgroundColor: '#0E1014',
    create: () => {
        const cx = W / 2, cy = 218;
        const headY = cy + (62 - 52) * K;               // the head's centre in canvas space
        const out = [];
        out.push(make(cx, cy, new PistonMarkDraw()));
        // Light pooled around the head, a wider dim one for the room
        out.push(make(cx, headY, new Light2D({ color: ORANGE, radius: 210, intensity: 0.55 })));
        out.push(make(cx, cy, new Light2D({ color: '#ff8a5c', radius: 360, intensity: 0.18 })));
        // A beam from the rod cap, going up and fading out
        const beam = make(cx, cy - 40 * K, new BeamRenderer({ length: 170, width: 26, color: ORANGE, glow: 0.6, glowWidth: 3, opacity: 0.85 }));
        beam.components[0].angle = -90;
        out.push(beam);
        // Sparks rising out of the bore, and a slow white dust
        out.push(make(cx, headY - 18, new ParticleEmitter({ emitting: true, rate: 55, lifetime: 1.6, speed: 130, speedVariation: 0.5, angle: -90, spread: 50,
            gravity: -20, startSize: 5, endSize: 0, startColor: '#ff8a4d', endColor: ORANGE, blendMode: 'additive', maxParticles: 160, sortingOrder: 20 })));
        out.push(make(cx, cy, new ParticleEmitter({ emitting: true, rate: 14, lifetime: 3.5, speed: 38, speedVariation: 0.6, spread: 360, startSize: 2.5, endSize: 0,
            startColor: '#ffffff', endColor: '#ffffff', blendMode: 'additive', maxParticles: 80, sortingOrder: 19 })));
        // The picture is one frame, so run the emitters for a couple of simulated seconds first (the headless browser's clock is not a game clock).
        Constants.DELTA_TIME = 1 / 60;
        for (const e of out) { const p = e.components[0]; if (p instanceof ParticleEmitter) for (let i = 0; i < 160; i++) p.update(); }
        Constants.DELTA_TIME = 0;
        out.push(make(0, 0, new PostProcess({ ambient: '#9a9aa2', lightStrength: 0.55, bloom: 0.6, bloomThreshold: 0.6, bloomRadius: 12, vignette: 0.6, vignetteColor: '#0E1014', contrast: 1.05 })));
        return out;
    },
}));

globalThis.__PISTON_PROJECT__ = { scenes: './none', prefabs: './none', sceneIds: ['hubart'], resolution: [W, H] };
await startGame({ canvas: document.getElementById('game'), startScene: 'hubart' });
