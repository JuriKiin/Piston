// Run: node Engine/web/tests/sprite-animator.test.mjs   (no browser needed)
import assert from 'node:assert/strict';
import { SpriteAnimator } from '../SpriteAnimator.js';
import { SpriteRenderer } from '../SpriteRenderer.js';
import Constants from '../static/Constants.js';

const renderer = Object.assign(Object.create(SpriteRenderer.prototype), { playing: true, currentFrame: 0 });
const entity = { getComponent: (T) => (T === SpriteRenderer ? renderer : undefined), finished: [], onAnimationFinished(n) { this.finished.push(n); } };
const make = (clips, opts = {}) => { const a = new SpriteAnimator({ clips, ...opts }); a.entity = entity; renderer.playing = true; renderer.currentFrame = 0; entity.finished = []; return a; };
const tick = (a, seconds, step = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += step) { Constants.DELTA_TIME = step; a.update(); } };
const clips = [{ name: 'idle', from: 0, to: 3, fps: 4, loop: true }, { name: 'hit', from: 8, to: 10, fps: 10, loop: false }];
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('PASS', name); };

test('starts the default clip on frame zero and takes the frame away from the renderer', () => {
    const a = make(clips, { defaultClip: 'idle' }); a.start();
    assert.equal(a.current, 'idle'); assert.equal(renderer.currentFrame, 0); assert.equal(renderer.playing, false);
});
test('a looping clip advances at its fps and wraps', () => {
    const a = make(clips, { defaultClip: 'idle' }); a.start();
    tick(a, 0.30); assert.equal(renderer.currentFrame, 1);          // 4 fps: 0.25s per frame
    tick(a, 0.80); assert.ok(renderer.currentFrame >= 0 && renderer.currentFrame <= 3); // wrapped, never past `to`
});
test('a one-shot clip stops on its last frame and reports it once', () => {
    const a = make(clips); a.play('hit'); tick(a, 2);
    assert.equal(renderer.currentFrame, 10); assert.equal(a.isPlaying, false); assert.deepEqual(entity.finished, ['hit']);
});
test('frames stay inside the clip range (offset by `from`)', () => {
    const a = make(clips); a.play('hit');
    for (let i = 0; i < 40; i++) { tick(a, 0.01); assert.ok(renderer.currentFrame >= 8 && renderer.currentFrame <= 10); }
});
test('play() of the running clip does not restart; restart:true does; unknown names are refused', () => {
    const a = make(clips, { defaultClip: 'idle' }); a.start(); tick(a, 0.6);
    const before = renderer.currentFrame; a.play('idle'); assert.equal(renderer.currentFrame, before);
    a.play('idle', { restart: true }); assert.equal(renderer.currentFrame, 0);
    assert.equal(a.play('nope'), false); assert.equal(a.current, 'idle');
});
test('speed scales playback', () => {
    const a = make(clips, { defaultClip: 'idle', speed: 2 }); a.start(); tick(a, 0.3);
    assert.equal(renderer.currentFrame, 2);
});
test('stop() freezes; captureState/restoreState round-trips', () => {
    const a = make(clips, { defaultClip: 'idle' }); a.start(); tick(a, 0.3); a.stop();
    const f = renderer.currentFrame; tick(a, 1); assert.equal(renderer.currentFrame, f);
    const s = a.captureState(); const b = make(clips); b.restoreState(s); assert.equal(b.current, 'idle'); assert.equal(b.isPlaying, false);
});
test('playOnStart:false waits for play()', () => {
    const a = make(clips, { defaultClip: 'idle', playOnStart: false }); a.start();
    assert.equal(a.isPlaying, false); assert.equal(a.current, '');
});
console.log(`\n${passed} animator checks passed`);
