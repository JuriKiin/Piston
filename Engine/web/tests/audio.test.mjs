// Run: node Engine/web/tests/audio.test.mjs   (fake audio context, no browser)
import assert from 'node:assert/strict';
import { AudioService } from '../Audio/AudioService.js';
import { AudioSource } from '../Audio/AudioSource.js';

function fakeContext() {
    const started = [];
    const node = () => ({ gain: { value: 1 }, connect() {}, });
    return {
        started, state: 'suspended', destination: {}, resumed: 0,
        resume() { this.state = 'running'; this.resumed++; },
        createGain: node,
        createBufferSource() { const s = { playbackRate: { value: 1 }, connect() {}, start() { started.push(s); }, stop() { this.stopped = true; this.onended?.(); } }; return s; },
        decodeAudioData: async (b) => ({ decoded: b }),
    };
}
const make = (opts = {}) => {
    const ctx = fakeContext(); const fetched = [];
    const svc = new AudioService({ createContext: () => ctx, fetchBytes: async (p) => { fetched.push(p); return p; }, ...opts });
    return { ctx, svc, fetched };
};
const settle = () => new Promise(r => setTimeout(r, 5));
let passed = 0;
const test = async (n, f) => { await f(); passed++; console.log('PASS', n); };

await test('many plays of the same clip overlap instead of cutting each other off', async () => {
    const { ctx, svc } = make();
    for (let i = 0; i < 5; i++) svc.play('./a.wav');
    await settle();
    assert.equal(ctx.started.length, 5);
    assert.ok(ctx.started.every(s => !s.stopped));
});
await test('different clips and sources play together; each clip is fetched and decoded once', async () => {
    const { ctx, svc, fetched } = make();
    svc.play('./a.wav'); svc.play('./b.wav'); svc.play('./a.wav');
    await settle();
    assert.equal(ctx.started.length, 3);
    assert.deepEqual(fetched.sort(), ['./a.wav', './b.wav']);
});
await test('past maxVoicesPerClip the oldest copy is stopped', async () => {
    const { ctx, svc } = make({ maxVoicesPerClip: 3 });
    const vs = [1, 2, 3, 4].map(() => svc.play('./a.wav'));
    await settle();
    assert.equal(vs[0].playing, false);
    assert.ok(vs.slice(1).every(v => v.playing));
    assert.equal(svc.voiceCount('./a.wav'), 3);
});
await test('buses control volume and mute for groups of sounds', async () => {
    const { svc } = make();
    svc.play('./a.wav', { bus: 'music' }); svc.unlock();
    svc.setBusVolume('music', 0.4); svc.setBusMuted('sfx', true);
    assert.equal(svc.buses.music.gain.value, 0.4);
    assert.equal(svc.buses.sfx.gain.value, 0);
    svc.setBusMuted('sfx', false);
    assert.equal(svc.buses.sfx.gain.value, 1);
});
await test('stop() works even while a clip is still loading; stopAll(bus) only touches that bus', async () => {
    const { ctx, svc } = make();
    const a = svc.play('./a.wav'); a.stop();
    const m = svc.play('./m.wav', { bus: 'music' }); const s = svc.play('./s.wav', { bus: 'sfx' });
    await settle();
    assert.equal(ctx.started.length, 2);              // the stopped-while-loading one never started
    svc.stopAll('sfx');
    assert.equal(s.playing, false); assert.equal(m.playing, true);
});
await test('pitch, loop and volume reach the voice; unlock resumes a suspended context', async () => {
    const { ctx, svc } = make();
    svc.play('./a.wav', { pitch: 1.5, loop: true, volume: 0.3 });
    await settle();
    assert.equal(ctx.started[0].playbackRate.value, 1.5);
    assert.equal(ctx.started[0].loop, true);
    svc.unlock(); assert.equal(ctx.state, 'running');
});
await test('a failed load is reported once and can be retried', async () => {
    let fail = true; const ctx = fakeContext();
    const svc = new AudioService({ createContext: () => ctx, fetchBytes: async () => { if (fail) throw new Error('HTTP 404'); return 1; } });
    const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
    const v = svc.play('./missing.wav'); await settle();
    assert.equal(v.playing, false); assert.equal(warned, 1);
    fail = false; svc.play('./missing.wav'); await settle();
    console.warn = warn;
    assert.equal(ctx.started.length, 1);
});
await test('AudioSource: layered by default, restart when overlap is off, one-shots use the source bus, stop silences its voices', async () => {
    // route the component through a test service by swapping the shared instance's internals
    const { audio } = await import('../Audio/AudioService.js');
    const ctx = fakeContext();
    audio.createContext = () => ctx; audio.fetchBytes = async (p) => p; audio.ctx = null; audio.buffers.clear(); audio.voices.clear();
    const a = new AudioSource({ clip: './a.wav', bus: 'ui' });
    a.play(); a.play(); a.playOneShot('./b.wav', { volume: 0.5 });
    await settle();
    assert.equal(ctx.started.length, 3);
    assert.equal(audio.voiceCount(), 3);
    a.stop(); assert.equal(audio.voiceCount(), 0);
    const b = new AudioSource({ clip: './a.wav', overlap: false });
    b.play(); b.play(); await settle();
    assert.equal(b.voices.size, 1);
    assert.equal(new AudioSource().play(), null);
});
console.log(`\n${passed} audio checks passed`);
