import { Vector2 } from "@piston/Physics/Vector2.js";
import { UIElement } from "@piston/UIElement.js";
import { Text } from "@piston/UI/Text.js";
import { Animator } from "@piston/Animator.js";
import { PostProcess } from "@piston/PostProcess.js";
import { EntityRegistry } from "@piston/EntityRegistry.js";
import Constants from "@piston/static/Constants.js";
import Debug from "@piston/static/Debug.js";
import { Actor, Game, Taps, mkSprite, CX, CY } from "./Game.js";
import { DustEmitter } from "./Director.js";
import { Fx } from "./Fx.js";
import { sfx, music } from "./Sfx.js";

/** The title screen: a pulsing logo over the lit arena, drifting dust and shockwave pulses. Enter, Space or a click starts the fight. */
export class TitleDirector extends Actor {
    static description = 'The title screen controller.';
    constructor() { super(); this.tag = 'TitleDirector'; this.order = -100; this.t = 0; this.pulse = 1.2; this.go = false; }
    // Entities spawned inside start() would be lost (the scene loader replaces the entity list afterwards), so the real setup runs on the first update.
    start() { this.ready = false; }
    init() {
        this.ready = true; Taps.install(); Taps.clear();
        Debug.showColliders = false;
        Game.reset(); Game.state = 'title';
        document.body.style.cursor = '';
        music.play('calm', 0.55);
        for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2, r = 150 + (i % 3) * 150; Game.spawn(new DustEmitter(CX + Math.cos(a) * r, CY + Math.sin(a) * r * 0.7)); }
        const mk = (x, y, w, h, ...c) => { const e = new UIElement(new Vector2(x, y), new Vector2(w, h)); e.space = 'Screen'; Game.spawn(e); c.forEach(k => e.addComponent(k)); return e; };
        this.logo = mk(CX, 462, 760, 250, mkSprite('logo.png', { order: 90 }), new Animator({ playOnStart: true, defaultClip: 'pulse', clips: [{ name: 'pulse', duration: 3, loop: true, tracks: [
            { path: 'transform.size.x', keys: [{ t: 0, v: 760, ease: 'easeInOut' }, { t: 1.5, v: 782, ease: 'easeInOut' }, { t: 3, v: 760 }] },
            { path: 'transform.size.y', keys: [{ t: 0, v: 250, ease: 'easeInOut' }, { t: 1.5, v: 257, ease: 'easeInOut' }, { t: 3, v: 250 }] }], events: [] }] }));
        this.prompt = mk(CX, 662, 10, 10, new Text({ text: 'PRESS ENTER OR CLICK TO START', fontFamily: 'sans-serif', fontSize: 36, color: '#d8fbff', align: 'center', sortingOrder: 90 }), new Animator({ playOnStart: true, defaultClip: 'blink', clips: [{ name: 'blink', duration: 1.6, loop: true, tracks: [
            { path: 'Text.color', keys: [{ t: 0, v: 'rgba(216,251,255,0.35)', ease: 'easeInOut' }, { t: 0.8, v: 'rgba(216,251,255,1)', ease: 'easeInOut' }, { t: 1.6, v: 'rgba(216,251,255,0.35)' }] }], events: [] }] }));
        mk(CX, 900, 10, 10, new Text({ text: 'WASD move    mouse aim and hold to fire    SPACE dash', fontFamily: 'sans-serif', fontSize: 24, color: '#8fa3d8', align: 'center', sortingOrder: 90 }));
        mk(CX, 1030, 10, 10, new Text({ text: 'a Piston engine showcase', fontFamily: 'sans-serif', fontSize: 20, color: '#4a5a8c', align: 'center', sortingOrder: 90 }));
    }
    update() {
        super.update();
        if (!this.ready) this.init();
        const dt = Constants.DELTA_TIME; this.t += dt; this.pulse -= dt;
        if (this.pulse <= 0) { this.pulse = 2.2; Fx.ring(CX, CY, { color: 'cyan', from: 60, to: 1000, time: 2.0, light: false }); }
        const post = Game.loop.entities.map(e => e.getComponent(PostProcess)).find(Boolean);
        if (post) { post.bloom = 0.7 + 0.08 * Math.sin(this.t * 2); }
        if (!this.go && this.t > 0.3 && Taps.take('Enter', 'Space', 'Click', 'NumpadEnter')) {
            this.go = true; sfx.play('click', { minGap: 0 }); music.stop(); window.Piston.scenes.load('arena');
        }
    }
}
EntityRegistry.register('TitleDirector', TitleDirector, 'Neon Warden');
