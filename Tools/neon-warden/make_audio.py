#!/usr/bin/env python3
"""Synthesises every Neon Warden sound effect and the two music loops (pure Python, no numpy, no samples). Run: python3 Tools/neon-warden/make_audio.py"""
import math, os, random, struct, wave
SR = 44100
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'Samples', 'NeonWarden', 'assets')
SFX = os.path.join(ROOT, 'sfx'); MUS = os.path.join(ROOT, 'music')
os.makedirs(SFX, exist_ok=True); os.makedirs(MUS, exist_ok=True)
TAU = 2 * math.pi

def buf(sec): return [0.0] * int(SR * sec)
def write(path, data, gain=0.9):
    peak = max(1e-9, max(abs(x) for x in data)); k = min(1.0, gain / peak) if peak > gain else 1.0
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, x * k)) * 32767)) for x in data))
def env(t, dur, a=0.003, r=0.05, curve=1.0):
    if t < a: return t / a
    return max(0.0, 1 - (t - a) / max(1e-6, dur - a)) ** curve if r is None else min(1.0, (dur - t) / r) * (1.0) if t > dur - r else 1.0
def adsr_exp(t, dur, a=0.002, decay=8.0): return min(1.0, t / a) * math.exp(-decay * t / dur)
class Lp:
    def __init__(self, cutoff): self.a = 1 - math.exp(-TAU * cutoff / SR); self.y = 0.0
    def __call__(self, x): self.y += self.a * (x - self.y); return self.y
def saw(ph): return 2 * (ph % 1.0) - 1
def sq(ph, pw=0.5): return 1.0 if (ph % 1.0) < pw else -1.0
def add(dst, src, at=0.0, gain=1.0):
    o = int(at * SR)
    for i, v in enumerate(src):
        if o + i < len(dst): dst[o + i] += v * gain
def noise_burst(dur, cutoff, decay, rng, hp=False):
    n = int(dur * SR); lp = Lp(cutoff); out = []
    for i in range(n):
        t = i / SR; x = lp(rng.uniform(-1, 1)); out.append((x if not hp else rng.uniform(-1, 1) - x) * math.exp(-decay * t / dur))
    return out
def sweep(dur, f0, f1, wave_fn=math.sin, decay=4.0, expo=True, a=0.002):
    n = int(dur * SR); ph = 0.0; out = []
    for i in range(n):
        t = i / n; f = f0 * (f1 / f0) ** t if expo else f0 + (f1 - f0) * t
        ph += f / SR; out.append(wave_fn(ph * TAU if wave_fn is math.sin else ph) * adsr_exp(i / SR, dur, a, decay))
    return out
def mixd(*parts):
    n = max(len(p) for p in parts); o = [0.0] * n
    for p in parts:
        for i, v in enumerate(p): o[i] += v
    return o
def scale(p, g): return [v * g for v in p]
def fade_tail(p, ms=8):
    n = int(SR * ms / 1000)
    for i in range(min(n, len(p))): p[-1 - i] *= i / n
    return p

def sfx_all():
    rng = random.Random(1)
    # player bolts: bright zap with a downward pitch sweep, three detunes
    for k, f in enumerate((1500, 1320, 1700)):
        z = sweep(0.13, f, f * 0.32, saw, 7.0)
        z2 = sweep(0.13, f * 0.5, f * 0.16, math.sin, 6.0)
        n = noise_burst(0.03, 6000, 6, rng)
        write(f'{SFX}/shot{k + 1}.wav', fade_tail(mixd(scale(z, 0.35), scale(z2, 0.5), scale(n, 0.2))), 0.6)
    write(f'{SFX}/hit.wav', fade_tail(mixd(scale(sweep(0.06, 900, 400, sq, 12), 0.25), scale(noise_burst(0.05, 5000, 8, rng), 0.5))), 0.6)
    write(f'{SFX}/hit_metal.wav', fade_tail(mixd(scale(sweep(0.12, 2600, 1800, math.sin, 9), 0.4), scale(sweep(0.12, 3900, 2900, math.sin, 11), 0.25), scale(noise_burst(0.04, 8000, 8, rng), 0.35))), 0.6)
    write(f'{SFX}/boom_small.wav', fade_tail(mixd(scale(noise_burst(0.5, 2600, 5, rng), 0.8), scale(sweep(0.4, 140, 40, math.sin, 5), 1.0), scale(noise_burst(0.12, 9000, 8, rng, True), 0.35))), 0.9)
    write(f'{SFX}/boom_big.wav', fade_tail(mixd(scale(noise_burst(1.6, 1500, 3.2, rng), 0.9), scale(sweep(1.4, 90, 26, math.sin, 3.2), 1.2), scale(noise_burst(0.3, 8000, 6, rng, True), 0.4), scale(sweep(0.9, 300, 60, saw, 6), 0.25))), 0.95)
    write(f'{SFX}/charge.wav', fade_tail([v * min(1, i / (SR * 0.15)) for i, v in enumerate(mixd(scale(sweep(1.1, 180, 1500, saw, 0.0001, True, 0.01), 0.25), scale(sweep(1.1, 360, 3000, math.sin, 0.0001, True, 0.01), 0.2)))]), 0.5)
    write(f'{SFX}/turret_shot.wav', fade_tail(mixd(scale(sweep(0.25, 520, 90, sq, 6), 0.4), scale(noise_burst(0.1, 3000, 7, rng), 0.5), scale(sweep(0.3, 120, 50, math.sin, 5), 0.6))), 0.75)
    write(f'{SFX}/shockwave.wav', fade_tail(mixd(scale(sweep(0.9, 60, 18, math.sin, 3), 1.0), scale(sweep(0.8, 1800, 120, saw, 5), 0.25), scale(noise_burst(0.7, 1800, 5, rng), 0.35))), 0.9)
    # roar: low formant-ish growl, amplitude wobble
    n = int(1.6 * SR); ph = 0.0; lp1, lp2 = Lp(500), Lp(1400); out = []
    for i in range(n):
        t = i / SR; f = 70 + 25 * math.sin(t * 9) - 20 * t; ph += f / SR
        x = saw(ph) * 0.6 + sq(ph * 2.01, 0.3) * 0.3 + rng.uniform(-1, 1) * 0.25
        out.append((lp1(x) * 0.8 + lp2(x) * 0.5) * min(1, t / 0.12) * math.exp(-1.2 * t) * (0.7 + 0.3 * math.sin(t * 26)))
    write(f'{SFX}/roar.wav', fade_tail(out), 0.9)
    write(f'{SFX}/seg_break.wav', fade_tail(mixd(scale(noise_burst(0.7, 3500, 4.5, rng), 0.8), scale(sweep(0.6, 220, 50, saw, 5), 0.6), scale(sweep(0.2, 3000, 800, sq, 10), 0.25), scale(noise_burst(0.25, 9000, 7, rng, True), 0.35))), 0.9)
    write(f'{SFX}/dash.wav', fade_tail(mixd(scale(noise_burst(0.35, 4000, 4.0, rng), 0.45), scale(sweep(0.3, 300, 1400, saw, 5), 0.2))), 0.6)
    write(f'{SFX}/hurt.wav', fade_tail(mixd(scale(sweep(0.4, 420, 70, saw, 5), 0.6), scale(noise_burst(0.3, 2500, 6, rng), 0.7), scale(sweep(0.5, 55, 40, math.sin, 3), 0.7))), 0.9)
    write(f'{SFX}/alarm.wav', fade_tail([ (sq(i / SR * (620 if (i // int(SR * 0.18)) % 2 == 0 else 470)) * 0.25) * (1 if i < SR * 0.72 else 0) for i in range(int(SR * 0.72)) ]), 0.5)
    write(f'{SFX}/click.wav', fade_tail(mixd(scale(sweep(0.05, 1800, 1200, math.sin, 9), 0.5), scale(noise_burst(0.015, 7000, 6, rng), 0.2))), 0.5)
    write(f'{SFX}/spawn.wav', fade_tail(mixd(scale(sweep(0.35, 200, 1600, math.sin, 3, True, 0.02), 0.4), scale(sweep(0.35, 400, 3200, math.sin, 3, True, 0.02), 0.2))), 0.45)
    write(f'{SFX}/windup.wav', fade_tail(mixd(scale(sweep(0.45, 500, 1800, sq, 0.0001, True, 0.01), 0.18))), 0.45)
    # win / lose stings
    def chord(freqs, dur, wf=saw, g=0.18):
        o = buf(dur)
        for f in freqs:
            ph = 0.0
            for i in range(len(o)):
                ph += f / SR; o[i] += wf(ph) * g * adsr_exp(i / SR, dur, 0.01, 3.0)
        return o
    win = buf(2.6)
    for k, ch in enumerate([[440, 554, 659], [494, 622, 740], [554, 659, 880], [659, 831, 988, 1318]]): add(win, chord(ch, 1.2 if k < 3 else 1.9), k * 0.22)
    write(f'{SFX}/win.wav', fade_tail(win), 0.8)
    lose = buf(2.2)
    for k, ch in enumerate([[220, 262, 330], [196, 233, 294], [165, 196, 247], [110, 131, 165]]): add(lose, chord(ch, 1.1 if k < 3 else 1.6, saw, 0.16), k * 0.3)
    write(f'{SFX}/lose.wav', fade_tail(lose), 0.8)

# -------------------------------------------------------------------------------- music: 128 bpm, A minor, 8 bars = 15 s, seamless loop
BPM = 128; BEAT = 60 / BPM; BAR = BEAT * 4; BARS = 8
def midi(n): return 440 * 2 ** ((n - 69) / 12)
def music(boss):
    total = BAR * BARS; out = buf(total); rng = random.Random(4)
    prog = [57, 53, 55, 52, 57, 53, 55, 59]   # A F G E A F G B (root notes)
    def note(at, dur, f, wf, g, cutoff, decay=3.0):
        n = int(dur * SR); lp = Lp(cutoff); ph = 0.0; seg = []
        for i in range(n):
            ph += f / SR; x = wf(ph)
            seg.append(lp(x) * g * min(1, i / (SR * 0.004)) * math.exp(-decay * i / n))
        add(out, seg, at)
    # bass: eighth-note pulse on the root
    for bar in range(BARS):
        r = midi(prog[bar] - 24)
        for s in range(8): note(bar * BAR + s * BEAT / 2, BEAT / 2 * 0.9, r * (2 if s % 4 == 3 else 1), saw, 0.34, 900 if not boss else 1400, 2.0)
    # pad: held minor triads, long attack-less lowpassed saws
    for bar in range(BARS):
        for iv in (0, 3 if prog[bar] not in (53, 55) else 4, 7):
            note(bar * BAR, BAR, midi(prog[bar] + iv), saw, 0.07, 1500, 0.6)
    # hats every eighth, kick every beat in boss
    for bar in range(BARS):
        for s in range(8):
            h = noise_burst(0.04, 9000, 8, rng, True); add(out, h, bar * BAR + s * BEAT / 2, 0.16 if s % 2 else 0.1)
        for b in range(4):
            if boss or b == 0:
                k = sweep(0.22, 140, 42, math.sin, 6.0); add(out, k, bar * BAR + b * BEAT, 0.75 if boss else 0.45)
        if boss:
            for b in (1, 3):
                sn = mixd(scale(noise_burst(0.16, 5000, 6, rng), 0.5), scale(sweep(0.12, 240, 140, math.sin, 8), 0.4)); add(out, sn, bar * BAR + b * BEAT, 0.5)
    # arpeggio on top (16ths) in the boss loop; sparse bell arp in the calm loop
    scale_a = [0, 3, 7, 10, 12, 15, 12, 7]
    for bar in range(BARS):
        root = prog[bar] + 12
        if boss:
            for s in range(16): note(bar * BAR + s * BEAT / 4, BEAT / 4 * 0.9, midi(root + scale_a[s % 8]), sq, 0.09, 3200, 3.0)
        else:
            for s in range(4): note(bar * BAR + s * BEAT, BEAT * 0.9, midi(root + 12 + scale_a[(s * 2 + bar) % 8]), math.sin if False else (lambda p: math.sin(p * TAU)), 0.11, 4000, 4.0)
    # wrap tail into the head so the loop is seamless
    return out

def make_music():
    for name, boss in (('calm', False), ('boss', True)):
        d = music(boss); write(f'{MUS}/{name}.wav', d, 0.85)

if __name__ == '__main__':
    sfx_all(); print('sfx done', flush=True); make_music(); print('music done')
