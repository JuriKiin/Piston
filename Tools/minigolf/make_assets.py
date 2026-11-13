#!/usr/bin/env python3
"""Generates the Mini Golf sample's pixel art and sound effects, so they can be tweaked and rebuilt.
Run:  python3 Tools/minigolf/make_assets.py     (needs Pillow: pip install pillow)
Art goes to assets/art/*.png (open them in Piston's sprite painter; set the Frame size to see the frames),
sounds to assets/sfx/*.wav (synthesised: no recordings, no licensing).
"""
import math, os, random, struct, wave
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'Samples', 'MiniGolf')
ART = os.path.join(ROOT, 'assets', 'art'); SFX = os.path.join(ROOT, 'assets', 'sfx')
os.makedirs(ART, exist_ok=True); os.makedirs(SFX, exist_ok=True)
def hexc(h, a=255): h = h.lstrip('#'); return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)
def shade(c, f): return (min(255, int(c[0] * f)), min(255, int(c[1] * f)), min(255, int(c[2] * f)), c[3])
def sheet(w, h, n): return Image.new('RGBA', (w * n, h), (0, 0, 0, 0))

# ---------------------------------------------------------------- ball (16x16): white, shaded bottom-right, highlight top-left
def ball():
    img = Image.new('RGBA', (16, 16), (0, 0, 0, 0)); px = img.load()
    for y in range(16):
        for x in range(16):
            d = math.hypot(x - 7.5, y - 7.5)
            if d > 7.6: continue
            if d > 6.5: px[x, y] = hexc('#3b3f4a'); continue
            light = ((x - 7.5) * -0.6 + (y - 7.5) * -0.8) / 7 * 0.5 + 0.5      # 1 at top-left
            v = int(150 + 105 * max(0, min(1, light)))
            px[x, y] = (v, v, min(255, v + 6), 255)
    for (x, y) in [(5, 4), (6, 4), (5, 5)]: px[x, y] = (255, 255, 255, 255)          # specular
    for (x, y) in [(8, 8), (10, 7), (7, 10), (9, 10), (11, 9)]: px[x, y] = (205, 208, 215, 255)   # dimples
    img.save(f'{ART}/ball.png')

# ---------------------------------------------------------------- flag (4 frames of 16x30): waving cloth
def flag():
    fw, fh, n = 16, 30, 4
    img = sheet(fw, fh, n); d = ImageDraw.Draw(img)
    for f in range(n):
        ox = f * fw
        d.rectangle([ox + 3, 2, ox + 4, 29], fill=hexc('#d9d9e0'))                  # pole
        d.rectangle([ox + 4, 2, ox + 4, 29], fill=hexc('#9a9aa6'))
        d.ellipse([ox + 2, 0, ox + 5, 3], fill=hexc('#f4d35e'))                      # finial
        for x in range(5, 15):                                                        # cloth: a wave travelling to the tip
            wave = math.sin((x * 0.9) - f * math.pi / 2) * 1.6
            top = 4 + wave + (x - 5) * 0.25; bot = 13 + wave - (x - 5) * 0.25
            for y in range(int(round(top)), int(round(bot)) + 1):
                d.point((ox + x, y), fill=hexc('#e63946') if y < (top + bot) / 2 + 2 else hexc('#b3202c'))
        d.ellipse([ox + 0, 27, ox + 8, 30], fill=hexc('#3a2a1a'))                    # soil at the foot
    img.save(f'{ART}/flag.png')

# ---------------------------------------------------------------- rocks (3 frames of 32x32)
def rocks():
    img = sheet(32, 32, 3); px = img.load()
    shapes = [  # (radius x, radius y, bumpiness seed)
        (13, 12, 3), (14, 10, 7), (11, 13, 11)]
    for f, (rx, ry, seed) in enumerate(shapes):
        rnd = random.Random(seed); bumps = [rnd.uniform(0.82, 1.08) for _ in range(12)]
        for y in range(32):
            for x in range(32):
                dx, dy = (x - 15.5) / rx, (y - 15.5) / ry
                ang = (math.atan2(dy, dx) + math.pi) / (2 * math.pi) * 12
                r = bumps[int(ang) % 12] * (1 - (ang % 1)) + bumps[(int(ang) + 1) % 12] * (ang % 1)
                dist = math.hypot(dx, dy)
                if dist > r: continue
                light = (-(dx) * 0.5 - (dy) * 0.8)
                base = 130 + int(60 * light) + (8 if (x * 7 + y * 13) % 11 == 0 else 0)
                c = (base, base - 4, base - 12, 255)
                if dist > r - 0.16: c = (58, 56, 62, 255)                              # outline
                elif dist > r - 0.3: c = (int(c[0] * 0.78), int(c[1] * 0.78), int(c[2] * 0.8), 255)
                px[f * 32 + x, y] = c
        for (cx, cy) in [(11, 11), (12, 11), (11, 12)]: px[f * 32 + cx, cy] = (225, 224, 215, 255)   # highlight
        for i in range(5): px[f * 32 + 14 + i, 17 + i // 2] = (92, 90, 96, 255)                      # a crack
    img.save(f'{ART}/rocks.png')

# ---------------------------------------------------------------- decor (4 frames of 32x32): tree, bush, flowers, pine
def decor():
    img = sheet(32, 32, 4); d = ImageDraw.Draw(img)
    def blob(ox, cx, cy, r, base):
        for y in range(32):
            for x in range(32):
                dist = math.hypot(x - cx, y - cy)
                if dist <= r:
                    light = 1.0 - ((x - cx) * 0.4 + (y - cy) * 0.7) / (r * 1.1)
                    d.point((ox + x, y), fill=shade(hexc(base), 0.62 + 0.5 * max(0, min(1, light))))
    # tree
    d.rectangle([13, 19, 17, 29], fill=hexc('#6b4423')); d.rectangle([13, 19, 14, 29], fill=hexc('#855a30'))
    blob(0, 15, 13, 11, '#2e9e4f'); blob(0, 10, 16, 6, '#34ad57'); blob(0, 21, 15, 6, '#2a8c47')
    # bush
    blob(32, 16, 19, 11, '#3fa957'); blob(32, 10, 21, 6, '#47b861'); blob(32, 22, 21, 6, '#38a050')
    for (x, y) in [(12, 16), (19, 18), (15, 23)]: d.point((32 + x, y), fill=hexc('#e63946'))
    # flowers
    for (x, y, c) in [(8, 10, '#ffd166'), (20, 8, '#ef476f'), (14, 19, '#ffffff'), (24, 20, '#ffd166'), (7, 24, '#c77dff'), (18, 26, '#ef476f')]:
        d.rectangle([64 + x - 1, y, 64 + x + 1, y + 2], fill=hexc(c)); d.point((64 + x, y + 1), fill=hexc('#ffa200'))
        d.point((64 + x, y + 3), fill=hexc('#2e7d32')); d.point((64 + x, y + 4), fill=hexc('#2e7d32'))
    # pine
    d.rectangle([14, 24, 17, 30], fill=hexc('#5a3a1e')) if False else d.rectangle([96 + 14, 24, 96 + 17, 30], fill=hexc('#5a3a1e'))
    for i, (w, y) in enumerate([(13, 20), (10, 13), (7, 6)]):
        d.polygon([(96 + 16 - w, y + 7), (96 + 16 + w, y + 7), (96 + 16, y - 6)], fill=hexc('#1f7a3d' if i % 2 == 0 else '#238c46'), outline=hexc('#15502a'))
    img.save(f'{ART}/decor.png')

# ---------------------------------------------------------------- windmill: tower (48x64) and a blade bar (110x10; two arms with sails)
def windmill():
    img = Image.new('RGBA', (48, 64), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    for y in range(18, 62):                                               # tapered brick tower
        half = 10 + (y - 18) * 0.22
        for x in range(int(24 - half), int(24 + half) + 1):
            brick = (y // 4 + (x // 6 if (y // 4) % 2 else (x + 3) // 6)) % 2
            c = hexc('#d9cdb8') if brick else hexc('#c9bba3')
            if x < 24 - half + 2: c = shade(c, 0.78)
            if x > 24 + half - 3: c = shade(c, 0.82)
            d.point((x, y), fill=c)
    d.rectangle([19, 46, 28, 62], fill=hexc('#5b3a29')); d.ellipse([19, 42, 28, 50], fill=hexc('#5b3a29'))   # door
    d.polygon([(8, 20), (40, 20), (24, 2)], fill=hexc('#b5302b'), outline=hexc('#7a1f1b'))                   # roof
    d.polygon([(8, 20), (24, 2), (24, 20)], fill=hexc('#c93b35'))
    d.ellipse([20, 22, 28, 30], fill=hexc('#7ec8e3'), outline=hexc('#4a5568'))                               # window
    img.save(f'{ART}/windmill.png')
    blade = Image.new('RGBA', (110, 10), (0, 0, 0, 0)); d = ImageDraw.Draw(blade)
    d.rectangle([0, 4, 109, 5], fill=hexc('#6b4423'))                                                         # spar
    for (x0, x1) in [(6, 50), (60, 104)]:                                                                     # sails
        d.rectangle([x0, 0, x1, 9], fill=hexc('#f1e9d2'), outline=hexc('#8a6a3c'))
        for x in range(x0 + 6, x1, 7): d.line([x, 0, x, 9], fill=hexc('#cdbf9a'))
        d.line([x0, 4, x1, 4], fill=hexc('#8a6a3c'))
    blade.save(f'{ART}/blade.png')
    hub = Image.new('RGBA', (16, 16), (0, 0, 0, 0)); d = ImageDraw.Draw(hub)
    d.ellipse([1, 1, 14, 14], fill=hexc('#6b4423'), outline=hexc('#3a2512')); d.ellipse([5, 5, 10, 10], fill=hexc('#d9a441'))
    hub.save(f'{ART}/hub.png')

# ---------------------------------------------------------------- tunnel (2 frames of 48x48): stone mouth facing up; frame 1 has an arrow (the exit); the mouth opens downward at rotation 0
def tunnel():
    img = sheet(48, 48, 2); d = ImageDraw.Draw(img)
    for f in range(2):
        ox = f * 48
        d.rounded_rectangle([ox + 4, 8, ox + 43, 44], radius=10, fill=hexc('#8a8d96'), outline=hexc('#4a4d57'))
        for i in range(6): d.rectangle([ox + 6 + i * 6, 9 + (i % 2) * 2, ox + 9 + i * 6, 12 + (i % 2) * 2], fill=hexc('#a4a7b0'))
        d.rounded_rectangle([ox + 11, 14, ox + 36, 44], radius=8, fill=hexc('#0e0f14'))
        d.rounded_rectangle([ox + 13, 18, ox + 34, 44], radius=7, fill=hexc('#1b1d26' if f == 0 else '#27304a'))
        if f == 1:
            d.rectangle([ox + 22, 20, ox + 26, 30], fill=hexc('#7ec8e3'))          # arrow pointing out of the mouth (down)
            d.polygon([(ox + 24, 40), (ox + 31, 30), (ox + 17, 30)], fill=hexc('#7ec8e3'))
    img.save(f'{ART}/tunnel.png')

# ---------------------------------------------------------------- hole (2 frames of 24x24): open, and lit when the ball is in
def hole():
    img = sheet(24, 24, 2); px = img.load()
    for f in range(2):
        for y in range(24):
            for x in range(24):
                d = math.hypot(x - 11.5, y - 11.5)
                if d > 11.4: continue
                if d > 9.6: v = 0.55 if (x + y) < 23 else 1.0; px[f * 24 + x, y] = (int(70 * v), int(62 * v), int(54 * v), 255)   # lip
                elif d > 8.6: px[f * 24 + x, y] = (36, 31, 28, 255)
                else:
                    depth = 1 - d / 8.6
                    base = (8, 8, 10) if f == 0 else (30, 92, 48)
                    px[f * 24 + x, y] = (int(base[0] + 12 * (1 - depth)), int(base[1] + 12 * (1 - depth)), int(base[2] + 14 * (1 - depth)), 255)
    img.save(f'{ART}/hole.png')

# ---------------------------------------------------------------- tee marker (2 pegs) and arrow for boost pads (1x 32x32)
def pad():
    img = Image.new('RGBA', (32, 32), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.rounded_rectangle([2, 2, 29, 29], radius=5, fill=hexc('#ffb703'), outline=hexc('#b36b00'))
    for dy in (0, 8): d.polygon([(16, 5 + dy), (24, 13 + dy), (19, 13 + dy), (19, 19 + dy), (13, 19 + dy), (13, 13 + dy), (8, 13 + dy)], fill=hexc('#fff3b0'))   # two chevron arrows, both inside the tile
    img.save(f'{ART}/boost.png')

# ================================================================ sound effects (mono, 22.05 kHz, 16-bit)
SR = 22050
def tone(freq, dur, decay=8, vol=1.0, kind='sine', sweep=None):
    out = []; phase = 0.0
    for i in range(int(SR * dur)):
        t = i / SR; f = freq if sweep is None else freq + (sweep - freq) * (t / dur)
        phase += 2 * math.pi * f / SR
        s = math.sin(phase) if kind == 'sine' else (1.0 if math.sin(phase) > 0 else -1.0) * 0.5 if kind == 'square' else (2 * ((phase / (2 * math.pi)) % 1) - 1) * 0.6
        out.append(s * vol * math.exp(-decay * t))
    return out
def noise(dur, decay=10, vol=1.0, lp=0.3, seed=1):
    rnd = random.Random(seed); out = []; y = 0.0
    for i in range(int(SR * dur)):
        y += lp * (rnd.uniform(-1, 1) - y); out.append(y * vol * math.exp(-decay * i / SR))
    return out
def mix(*parts):
    n = max(len(p) for p in parts); out = [0.0] * n
    for p in parts:
        for i, v in enumerate(p): out[i] += v
    return out
def delay(p, sec): return [0.0] * int(SR * sec) + p
def save(name, samples, gain=0.8):
    peak = max(1e-9, max(abs(v) for v in samples)); data = b''.join(struct.pack('<h', int(max(-1, min(1, v / peak * gain)) * 32767)) for v in samples)
    with wave.open(f'{SFX}/{name}.wav', 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data)
def sounds():
    save('hit', mix(tone(170, 0.16, 26, 1.0, sweep=90), noise(0.05, 60, 0.7, 0.5, 2), tone(900, 0.03, 90, 0.35)))         # putter: thump + click
    save('wall', mix(tone(1250, 0.12, 38, 0.8), tone(830, 0.14, 30, 0.6), noise(0.03, 120, 0.8, 0.9, 3)))                  # hard clack
    save('bumper', mix(tone(280, 0.3, 9, 1.0, sweep=640), tone(560, 0.3, 11, 0.4, sweep=1280)))                           # boing
    save('rock', mix(tone(210, 0.12, 30, 0.9), noise(0.1, 40, 0.6, 0.15, 4)))                                               # dull thunk
    save('sand', mix(noise(0.35, 9, 0.8, 0.12, 5), tone(95, 0.2, 14, 0.4)))                                                  # soft crunch
    save('boost', mix(tone(260, 0.35, 4, 0.8, 'saw', sweep=1100), noise(0.3, 6, 0.25, 0.4, 6)))                              # rising zip
    save('tunnel', mix(noise(0.5, 4, 0.9, 0.06, 7), tone(180, 0.5, 5, 0.5, sweep=520)))                                      # whoosh
    save('sink', mix(delay(tone(988, 0.12, 14, 0.7), 0.0), delay(tone(740, 0.14, 12, 0.7), 0.1), delay(tone(494, 0.2, 9, 0.8), 0.22), tone(120, 0.25, 12, 0.7)))   # plink, plink, plonk
    notes = [523, 659, 784, 1047]
    save('win', mix(*[delay(mix(tone(f, 0.45, 5, 0.7), tone(f * 2, 0.45, 8, 0.2)), 0.11 * i) for i, f in enumerate(notes)], delay(mix(tone(1047, 0.7, 3, 0.8), tone(784, 0.7, 3, 0.5), tone(659, 0.7, 3, 0.5)), 0.5)))
    save('cheer', mix(noise(0.7, 3, 0.7, 0.35, 8), tone(660, 0.4, 6, 0.2)), 0.5)
    save('click', mix(tone(1800, 0.04, 80, 1.0), tone(1200, 0.05, 70, 0.5)), 0.6)

if __name__ == '__main__':
    ball(); flag(); rocks(); decor(); windmill(); tunnel(); hole(); pad(); sounds()
    print('art:', sorted(os.listdir(ART))); print('sfx:', sorted(os.listdir(SFX)))
