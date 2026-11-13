// Run: node Engine/web/tests/animator.test.mjs   (no browser needed)
import assert from 'node:assert/strict';
import { Animator } from '../Animator.js';
import { evaluateTrack, sampleClip, eventsBetween, readProperty, listProperties, Easing } from '../Animation/Tracks.js';
import { ComponentRegistry } from '../ComponentRegistry.js';
import { Component } from '../Component.js';
import { ShapeRenderer } from '../ShapeRenderer.js';
import Constants from '../static/Constants.js';

class Glow extends Component { static fields = [{ key: 'color', label: 'Color', type: 'color', animatable: true }, { key: 'size', label: 'Size', type: 'number', animatable: true }, { key: 'hidden', label: 'Hidden', type: 'number' }, { key: 'label', type: 'text' }]; constructor() { super(); this.color = '#000000'; this.size = 1; } }
ComponentRegistry.register('Glow', Glow, 'game');

const makeEntity = () => {
    const e = { transform: { position: { x: 0, y: 0 }, rotation: 0, size: { x: 10, y: 10 } }, components: [], events: [], finished: [],
        onAnimationEvent(n, c) { this.events.push(`${c}:${n}`); }, onAnimationFinished(n) { this.finished.push(n); } };
    const g = new Glow(); g.entity = e; e.components.push(g);
    return e;
};
const make = (clips, entity = makeEntity(), opts = {}) => { const a = new Animator({ clips, ...opts }); a.entity = entity; return a; };
const tick = (a, seconds, step = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += step) { Constants.DELTA_TIME = step; a.update(); } };
let passed = 0;
const pending = [];
const test = (name, fn) => { const r = fn(); if (r?.then) pending.push(r.then(() => { passed++; console.log('PASS', name); })); else { passed++; console.log('PASS', name); } };

const slide = { name: 'slide', duration: 1, loop: false, tracks: [{ path: 'transform.position.x', keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] }], events: [{ t: 0.5, name: 'half' }] };

test('linear tracks interpolate, hold before the first key and after the last', () => {
    const tr = slide.tracks[0];
    assert.equal(evaluateTrack(tr, -1), 0); assert.equal(evaluateTrack(tr, 0.25), 25); assert.equal(evaluateTrack(tr, 5), 100);
});
test('a key\'s ease shapes the segment that follows it; step holds until the next key', () => {
    assert.equal(evaluateTrack({ keys: [{ t: 0, v: 0, ease: 'easeIn' }, { t: 1, v: 100 }] }, 0.5), 25);
    assert.equal(evaluateTrack({ keys: [{ t: 0, v: 0, ease: 'step' }, { t: 1, v: 100 }] }, 0.9), 0);
    for (const name of Object.keys(Easing)) { assert.ok(Math.abs(Easing[name](0)) < 1e-9, name); assert.ok(Math.abs(Easing[name](1) - 1) < 1e-9, name); }
});
test('every CSS color form blends: #rgb, #rrggbb, #rrggbbaa, rgb(), rgba(), names, transparent', () => {
    assert.equal(evaluateTrack({ keys: [{ t: 0, v: '#000' }, { t: 1, v: '#fff' }] }, 0.5), '#808080');
    assert.equal(evaluateTrack({ keys: [{ t: 0, v: 'white' }, { t: 1, v: 'black' }] }, 0.5), '#808080');
    assert.equal(evaluateTrack({ keys: [{ t: 0, v: 'rgb(0, 0, 0)' }, { t: 1, v: 'rgb(255,255,255)' }] }, 0.5), '#808080');
    assert.equal(evaluateTrack({ keys: [{ t: 0, v: '#ff0000ff' }, { t: 1, v: '#ff000000' }] }, 0.5), 'rgba(255,0,0,0.5)');   // fade out, what the editor's color well produces
    assert.equal(evaluateTrack({ keys: [{ t: 0, v: 'transparent' }, { t: 1, v: '#00ff00' }] }, 1), '#00ff00');
    assert.equal(evaluateTrack({ keys: [{ t: 0, v: 'notacolor' }, { t: 1, v: '#00ff00' }] }, 0.5), 'notacolor');          // unknown forms hold
});
test('colors blend per channel and non-numbers hold', () => {
    assert.equal(evaluateTrack({ keys: [{ t: 0, v: '#000000' }, { t: 1, v: '#ff8000' }] }, 0.5), '#804000');
    assert.equal(evaluateTrack({ keys: [{ t: 0, v: 'a' }, { t: 1, v: 'b' }] }, 0.5), 'a');
});
test('sampleClip returns every track and unsorted-safe event windows', () => {
    assert.deepEqual(sampleClip(slide, 0.5), { 'transform.position.x': 50 });
    assert.deepEqual(eventsBetween(slide, 0.4, 0.5).map(e => e.name), ['half']);
    assert.deepEqual(eventsBetween(slide, 0.5, 0.9), []);
});
test('the animator writes transform and component values and fires events once', () => {
    const e = makeEntity(); const a = make([slide], e); a.play('slide'); tick(a, 0.5);
    assert.ok(Math.abs(e.transform.position.x - 50) < 2.5);
    tick(a, 0.7); assert.equal(e.events.length, 1);
});
test('a one-shot ends on its last value and reports finished once', () => {
    const e = makeEntity(); const a = make([slide], e); a.play('slide'); tick(a, 2);
    assert.equal(e.transform.position.x, 100); assert.equal(a.isPlaying, false); assert.deepEqual(e.finished, ['slide']);
});
test('a looping clip wraps and replays its events each lap', () => {
    const loop = { ...slide, name: 'loop', loop: true };
    const e = makeEntity(); const a = make([loop], e); a.play('loop'); tick(a, 2.6);
    assert.ok(a.isPlaying); assert.equal(e.events.length, 3); assert.ok(e.transform.position.x >= 0 && e.transform.position.x <= 100);
});
test('component fields animate, speed scales time, and play of the running clip does not restart', () => {
    const clip = { name: 'pulse', duration: 1, loop: true, tracks: [{ path: 'Glow.size', keys: [{ t: 0, v: 1 }, { t: 1, v: 3 }] }, { path: 'Glow.color', keys: [{ t: 0, v: '#000000' }, { t: 1, v: '#ffffff' }] }], events: [] };
    const e = makeEntity(); const a = make([clip], e, { speed: 2 }); a.play('pulse'); tick(a, 0.25);
    assert.ok(Math.abs(e.components[0].size - 2) < 0.1); assert.match(e.components[0].color, /^#[0-9a-f]{6}$/);
    const t = a.time; a.play('pulse'); assert.equal(a.time, t);
});
test('an unset color or number offers a neutral starting value', () => {
    const e = makeEntity(); e.components[0].color = null; e.components[0].size = undefined;
    const props = listProperties(e); assert.equal(props.find(p => p.path === 'Glow.color').value, '#00000000'); assert.equal(props.find(p => p.path === 'Glow.size').value, 0);
});
test('listProperties offers transform paths plus number and color fields only, with current values', () => {
    const e = makeEntity(); e.components[0].size = 7;
    const props = listProperties(e); const paths = props.map(p => p.path);
    assert.ok(paths.includes('transform.rotation') && paths.includes('Glow.color') && paths.includes('Glow.size'));
    assert.ok(!paths.includes('Glow.label') && !paths.includes('Glow.hidden')); assert.equal(props.find(p => p.path === 'Glow.size').value, 7); assert.equal(readProperty(e, 'transform.size.y'), 10);
});
test('a scene-built animator (fields applied AFTER start) still plays on start, and again after Stop → Play', () => {
    const e = makeEntity(); const a = new Animator(); a.entity = e; a.start();           // what Entity.addComponent does
    Object.assign(a, { clips: [slide], defaultClip: 'slide' });                         // then SceneIO applies the saved fields
    assert.equal(a.isPlaying, false); tick(a, 0.3); assert.equal(a.isPlaying, true); assert.ok(e.transform.position.x > 20);
    const saved = { current: '', time: 0, isPlaying: false }; a.restoreState(saved);     // Stop reverts, next Play begins again
    e.transform.position.x = 0; tick(a, 0.3); assert.equal(a.isPlaying, true); assert.ok(e.transform.position.x > 20);
});
test('an animator linked to an animation file loads its clips from it and then plays', async () => {
    Animator.loadJSON = async (path) => { assert.equal(path, './assets/animations/slide.anim.json'); return { clips: [slide] }; };
    const e = makeEntity(); const a = new Animator({ asset: './assets/animations/slide.anim.json', defaultClip: 'slide' }); a.entity = e; a.start();
    assert.equal(a.clips.length, 0);
    await new Promise(r => setTimeout(r, 5));
    assert.equal(a.clips.length, 1); tick(a, 0.3); assert.equal(a.isPlaying, true); assert.ok(e.transform.position.x > 20);
});
await Promise.all(pending);
test('a real ShapeRenderer changes color and opacity while the animator runs', () => {
    const e = makeEntity(); const r = new ShapeRenderer({ color: '#ffffff' }); r.entity = e; e.components.push(r);
    const clip = { name: 'fade', duration: 1, loop: true, tracks: [
        { path: 'ShapeRenderer.color', keys: [{ t: 0, v: '#ffffff' }, { t: 1, v: '#ff0000' }] },
        { path: 'ShapeRenderer.opacity', keys: [{ t: 0, v: 1 }, { t: 1, v: 0 }] }], events: [] };
    const a = make([clip], e); a.play('fade'); tick(a, 0.5);
    assert.notEqual(r.color, '#ffffff'); assert.match(r.color, /^#ff[0-9a-f]{2}[0-9a-f]{2}$/); assert.ok(r.opacity < 0.6 && r.opacity > 0.4);
    const props = listProperties(e).map(p => p.path); assert.ok(props.includes('ShapeRenderer.color') && props.includes('ShapeRenderer.opacity'));
});
test('seek poses an entity at a moment in a clip without playing it', () => {
    const e = makeEntity(); const a = make([slide], e); assert.equal(a.seek('slide', 0.5), true);
    assert.equal(a.isPlaying, false); assert.ok(Math.abs(e.transform.position.x - 50) < 0.001); assert.equal(a.seek('nope'), false);
});
console.log(`\n${passed} passed`);
