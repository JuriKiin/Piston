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

# ---------------------------------------------------------------- smooth, high-resolution art
# Everything is drawn at 4x size and shrunk with a good filter, so edges are anti-aliased and the sprites stay sharp when the game scales them.
SS = 4
def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(4))

class HD:
    """A drawing surface in final-pixel coordinates (drawn at SS x, downsampled on save)."""
    def __init__(self, w, h):
        self.w, self.h = w, h; self.img = Image.new('RGBA', (w * SS, h * SS), (0, 0, 0, 0)); self.d = ImageDraw.Draw(self.img)
    def box(self, b): return [v * SS for v in b]
    def _op(self, fn, color):
        """Draws with `fn`. A translucent colour is composited (not overwritten), so soft shadows and speckles blend with what is underneath."""
        if isinstance(color, tuple) and len(color) == 4 and color[3] < 255:
            layer = Image.new('RGBA', self.img.size, (0, 0, 0, 0)); fn(ImageDraw.Draw(layer))
            self.img = Image.alpha_composite(self.img, layer); self.d = ImageDraw.Draw(self.img)
        else: fn(self.d)
    def ellipse(self, b, fill=None, outline=None, width=1): self._op(lambda d: d.ellipse(self.box(b), fill=fill, outline=outline, width=int(width * SS)), fill or outline)
    def circle(self, cx, cy, r, fill=None, outline=None, width=1): self.ellipse([cx - r, cy - r, cx + r, cy + r], fill, outline, width)
    def polygon(self, pts, fill=None, outline=None): self._op(lambda d: d.polygon([(x * SS, y * SS) for x, y in pts], fill=fill, outline=outline), fill or outline)
    def line(self, pts, fill, width=1): self._op(lambda d: d.line([(x * SS, y * SS) for x, y in pts], fill=fill, width=max(1, int(width * SS)), joint='curve'), fill)
    def rect(self, b, fill=None, outline=None, width=1): self._op(lambda d: d.rectangle(self.box(b), fill=fill, outline=outline, width=int(width * SS)), fill or outline)
    def rrect(self, b, r, fill=None, outline=None, width=1): self._op(lambda d: d.rounded_rectangle(self.box(b), radius=r * SS, fill=fill, outline=outline, width=int(width * SS)), fill or outline)
    def sphere(self, cx, cy, r, edge, core, light=(-0.35, -0.4), steps=48):
        """A shaded ball: concentric discs whose centre drifts toward the light while the colour goes from edge to core."""
        for i in range(steps):
            t = i / (steps - 1); rr = r * (1 - 0.92 * t)
            self.circle(cx + light[0] * r * t * 0.9, cy + light[1] * r * t * 0.9, rr, fill=lerp(edge, core, t ** 0.8))
    def shadow(self, cx, cy, rx, ry, alpha=70):
        layer = Image.new('RGBA', self.img.size, (0, 0, 0, 0)); ImageDraw.Draw(layer).ellipse(self.box([cx - rx, cy - ry, cx + rx, cy + ry]), fill=(0, 0, 0, alpha))
        self.img = Image.alpha_composite(layer, self.img); self.d = ImageDraw.Draw(self.img)
    def out(self): return self.img.resize((self.w, self.h), Image.LANCZOS)

def paste_frames(frames, name):
    w, h = frames[0].size; sheet = Image.new('RGBA', (w * len(frames), h), (0, 0, 0, 0))
    for i, f in enumerate(frames): sheet.paste(f, (i * w, 0))
    sheet.save(f'{ART}/{name}.png')

# ---------------------------------------------------------------- ball (64x64): shaded white sphere with dimples and a highlight
def ball():
    g = HD(64, 64); g.shadow(33, 36, 27, 24, 60)
    g.circle(32, 32, 28.5, fill=hexc('#3b3f4a'))
    g.sphere(32, 32, 26.5, hexc('#aeb4c2'), hexc('#ffffff'), light=(-0.38, -0.42))
    rnd = random.Random(4)
    for ring, (rad, n) in enumerate([(0, 1), (9, 6), (17, 11), (23, 15)]):             # dimples: rings that squash toward the rim
        for k in range(n):
            a = (k / n) * 2 * math.pi + ring * 0.4; x = 32 + math.cos(a) * rad - 2; y = 32 + math.sin(a) * rad - 3
            if math.hypot(x - 32, y - 32) > 24: continue
            squash = 1 - 0.55 * (math.hypot(x - 32, y - 32) / 26) ** 2
            g.ellipse([x - 2.1 * squash, y - 2.1, x + 2.1 * squash, y + 2.1], fill=(176, 182, 196, 150))
    g.ellipse([17, 13, 29, 22], fill=(255, 255, 255, 235))                              # specular highlight
    g.ellipse([21, 15, 26, 18], fill=(255, 255, 255, 255))
    g.out().save(f'{ART}/ball.png')

# ---------------------------------------------------------------- flag (4 frames of 64x120): metal pole, cloth waving in a travelling wave
def flag():
    frames = []
    for f in range(4):
        g = HD(64, 120); g.shadow(20, 112, 17, 5, 70)
        g.ellipse([8, 104, 34, 116], fill=hexc('#4a3322')); g.ellipse([10, 104, 32, 112], fill=hexc('#6b4a31'))        # mound of soil
        g.rect([16, 8, 20, 110], fill=hexc('#d7dae3')); g.rect([16, 8, 17.5, 110], fill=hexc('#f4f6fb')); g.rect([19, 8, 20, 110], fill=hexc('#9a9eae'))
        g.sphere(18, 8, 5.5, hexc('#c98f1a'), hexc('#ffe27a'))
        top, bot = [], []
        for i in range(0, 41):
            x = 20 + i; w = math.sin(i * 0.28 - f * math.pi / 2) * 4.2 * (0.35 + i / 40)
            top.append((x, 14 + w + i * 0.12)); bot.append((x, 46 + w - i * 0.35))
        g.polygon(top + bot[::-1], fill=hexc('#e63946'))
        for i in range(0, 40, 2):                                                                                    # fold shading
            shade_c = (160, 28, 40, 140) if math.sin(i * 0.28 - f * math.pi / 2) < 0 else (255, 120, 125, 90)
            g.polygon([top[i], top[i + 1], bot[i + 1], bot[i]], fill=shade_c)
        g.line(top, hexc('#b3202c'), 1.4); g.line(bot, hexc('#8f1520'), 1.4)
        frames.append(g.out())
    paste_frames(frames, 'flag')

# ---------------------------------------------------------------- rocks (3 frames of 128x128)
def rocks():
    frames = []
    for seed, (rx, ry) in zip((3, 7, 11), ((50, 46), (56, 38), (44, 52))):
        rnd = random.Random(seed); g = HD(128, 128); g.shadow(66, 78, rx * 0.95, ry * 0.5, 70)
        n = 18; radii = [rnd.uniform(0.84, 1.08) for _ in range(n)]
        pts = [(64 + math.cos(2 * math.pi * k / n) * rx * radii[k], 62 + math.sin(2 * math.pi * k / n) * ry * radii[k]) for k in range(n)]
        g.polygon(pts, fill=hexc('#3a383e'))                                                                                     # outline layer
        inner = [(64 + (x - 64) * 0.94, 62 + (y - 62) * 0.94) for x, y in pts]
        g.polygon(inner, fill=hexc('#8b8a90'))
        for shade_c, scale, dx, dy in ((hexc('#a2a1a8'), 0.8, -4, -5), (hexc('#b8b7bd'), 0.55, -9, -10), (hexc('#cfcfd2'), 0.28, -13, -15)):   # lit facets toward the top left
            g.polygon([(64 + (x - 64) * scale + dx, 62 + (y - 62) * scale + dy) for x, y in inner], fill=shade_c)
        g.polygon([(x + 5, y + 7) for x, y in [(64 + (x - 64) * 0.55, 62 + (y - 62) * 0.55) for x, y in inner]], fill=(70, 68, 76, 45))   # shaded underside
        for _ in range(26):
            a = rnd.uniform(0, 6.28); r = rnd.uniform(0, 0.8); g.circle(64 + math.cos(a) * rx * r, 62 + math.sin(a) * ry * r, rnd.uniform(0.8, 1.8), fill=(90, 88, 96, 120))
        crack = [(58, 56), (63, 63), (61, 70), (67, 78)]; g.line(crack, (62, 60, 68, 220), 1.4)
        frames.append(g.out())
    paste_frames(frames, 'rocks')

# ---------------------------------------------------------------- decor (4 frames of 128x128): tree, bush, flowers, pine
def decor():
    frames = []
    g = HD(128, 128); g.shadow(66, 112, 44, 10, 60)                                                                               # tree
    g.polygon([(57, 74), (71, 74), (74, 112), (54, 112)], fill=hexc('#6b4423')); g.polygon([(57, 74), (62, 74), (62, 112), (54, 112)], fill=hexc('#8a5a30'))
    for cx, cy, r, base in ((64, 50, 34, '#2e9e4f'), (40, 62, 24, '#2a8c47'), (88, 62, 24, '#2a8c47'), (60, 34, 24, '#34ad57'), (78, 42, 18, '#3bb862')):
        g.sphere(cx, cy, r, hexc('#1f6e36'), hexc(base), light=(-0.3, -0.4), steps=26)
    rnd = random.Random(2)
    for _ in range(60): g.circle(rnd.uniform(30, 98), rnd.uniform(18, 80), rnd.uniform(1.2, 2.6), fill=(110, 205, 120, 110))
    frames.append(g.out())
    g = HD(128, 128); g.shadow(66, 106, 46, 10, 60)                                                                               # bush
    for cx, cy, r in ((64, 74, 36), (38, 84, 26), (92, 84, 26), (54, 62, 24), (78, 64, 22)):
        g.sphere(cx, cy, r, hexc('#2c8a47'), hexc('#4fc468'), light=(-0.3, -0.4), steps=24)
    for x, y in ((50, 70), (76, 62), (62, 88), (88, 80), (40, 86)): g.circle(x, y, 3.2, fill=hexc('#e63946')); g.circle(x - 1, y - 1, 1.1, fill=(255, 200, 200, 255))
    frames.append(g.out())
    g = HD(128, 128); g.shadow(66, 108, 40, 8, 40)                                                                                # flowers
    for x, y, c, s in ((34, 52, '#ffd166', 1.0), (84, 40, '#ef476f', 1.1), (58, 78, '#ffffff', 1.0), (96, 82, '#ffd166', 0.9), (28, 96, '#c77dff', 0.9), (72, 100, '#ef476f', 0.9)):
        g.line([(x, y + 6), (x + 1, y + 26 * s)], hexc('#2e7d32'), 2.2); g.polygon([(x + 1, y + 20 * s), (x + 11, y + 14 * s), (x + 3, y + 25 * s)], fill=hexc('#3a9a42'))
        for k in range(6):
            a = k * math.pi / 3; g.circle(x + math.cos(a) * 6.5 * s, y + math.sin(a) * 6.5 * s, 5.2 * s, fill=hexc(c), outline=(0, 0, 0, 40), width=0.6)
        g.circle(x, y, 4.4 * s, fill=hexc('#ffa200')); g.circle(x - 1, y - 1, 1.4, fill=hexc('#ffe27a'))
    frames.append(g.out())
    g = HD(128, 128); g.shadow(66, 116, 32, 7, 60)                                                                               # pine
    g.rect([57, 96, 71, 118], fill=hexc('#5a3a1e')); g.rect([57, 96, 62, 118], fill=hexc('#74502b'))
    for i, (w, y) in enumerate(((50, 100), (42, 78), (34, 56), (24, 34))):
        g.polygon([(64 - w, y), (64 + w, y), (64, y - 40)], fill=hexc('#15602e'))
        g.polygon([(64 - w, y), (64, y), (64, y - 40)], fill=hexc('#1f8a43' if i % 2 == 0 else '#24984b'))
        g.line([(64 - w + 4, y - 2), (64 + w - 4, y - 2)], hexc('#104a22'), 1.6)
    frames.append(g.out())
    paste_frames(frames, 'decor')

# ---------------------------------------------------------------- windmill: tower (192x256), blade bar (440x32 with two sails) and hub (64x64)
def windmill():
    g = HD(192, 256); g.shadow(98, 244, 70, 10, 60)
    for y in range(70, 246):
        half = 40 + (y - 70) * 0.2
        for_row = (y // 14)
        g.rect([96 - half, y, 96 + half, y + 1.2], fill=hexc('#d9cdb8'))
    g.polygon([(56, 70), (136, 70), (150, 246), (42, 246)], fill=hexc('#d6c9b0'))
    g.polygon([(56, 70), (74, 70), (62, 246), (42, 246)], fill=hexc('#b9ab92')); g.polygon([(124, 70), (136, 70), (150, 246), (134, 246)], fill=hexc('#c2b49b'))
    for row in range(0, 12):                                                                                                       # brick courses
        y = 74 + row * 14.5; off = (row % 2) * 9
        g.line([(52 - row * 0.55, y), (140 + row * 0.55, y)], (150, 135, 110, 150), 1.1)
        for x in range(0, 9): g.line([(58 + x * 10 + off - row * 0.4, y), (58 + x * 10 + off - row * 0.4, y + 14.5)], (150, 135, 110, 110), 1)
    g.polygon([(30, 74), (162, 74), (96, 8)], fill=hexc('#a82a25')); g.polygon([(30, 74), (96, 8), (96, 74)], fill=hexc('#c93b35'))
    g.polygon([(30, 74), (162, 74), (150, 82), (42, 82)], fill=hexc('#7a1f1b'))
    g.rrect([76, 98, 116, 142], 20, fill=hexc('#5b3a29'), outline=hexc('#3a2418'), width=2) if False else None
    g.circle(96, 112, 18, fill=hexc('#7ec8e3'), outline=hexc('#4a5568'), width=3); g.line([(96, 94), (96, 130)], hexc('#4a5568'), 2); g.line([(78, 112), (114, 112)], hexc('#4a5568'), 2)
    g.ellipse([78, 178, 114, 214], fill=hexc('#5b3a29')); g.rect([78, 196, 114, 246], fill=hexc('#5b3a29')); g.rect([78, 196, 90, 246], fill=hexc('#734a34')); g.circle(106, 224, 2.6, fill=hexc('#e9c46a'))
    g.out().save(f'{ART}/windmill.png')
    b = HD(440, 32); b.shadow(220, 25, 205, 4, 40)
    b.rect([0, 14, 439, 18], fill=hexc('#6b4423')); b.rect([0, 14, 439, 15.6], fill=hexc('#8a5a30'))
    for x0, x1 in ((24, 204), (236, 416)):                                                                                        # sails with a lattice
        b.rrect([x0, 2, x1, 30], 3, fill=hexc('#f4ecd4'), outline=hexc('#8a6a3c'), width=2)
        for x in range(int(x0) + 24, int(x1), 24): b.line([(x, 2), (x, 30)], hexc('#cdbf9a'), 1.6)
        b.line([(x0, 10), (x1, 10)], hexc('#cdbf9a'), 1.4); b.line([(x0, 22), (x1, 22)], hexc('#cdbf9a'), 1.4); b.line([(x0, 16), (x1, 16)], hexc('#8a6a3c'), 2)
    b.out().save(f'{ART}/blade.png')
    h = HD(64, 64); h.shadow(33, 36, 26, 22, 60); h.circle(32, 32, 28, fill=hexc('#3a2512'))
    h.sphere(32, 32, 25, hexc('#7a5230'), hexc('#d9a441'), light=(-0.3, -0.35)); h.circle(32, 32, 10, fill=hexc('#3a2512')); h.sphere(32, 32, 8, hexc('#a67a2d'), hexc('#ffe27a'))
    h.out().save(f'{ART}/hub.png')

# ---------------------------------------------------------------- tunnel (2 frames of 192x192): stone mouth, opening downward; frame 1 shows the exit arrow
def tunnel():
    frames = []
    for f in range(2):
        g = HD(192, 192); g.shadow(98, 178, 74, 10, 60)
        g.rrect([14, 28, 178, 180], 38, fill=hexc('#4a4d57')); g.rrect([18, 32, 174, 176], 34, fill=hexc('#8e919b'))
        rnd = random.Random(5)
        for i in range(8):                                                                                                           # arch stones
            a0 = math.pi + i * math.pi / 8; a1 = a0 + math.pi / 8
            pts = [(96 + math.cos(a0) * 70, 100 + math.sin(a0) * 62), (96 + math.cos(a1) * 70, 100 + math.sin(a1) * 62), (96 + math.cos(a1) * 92, 100 + math.sin(a1) * 80), (96 + math.cos(a0) * 92, 100 + math.sin(a0) * 80)]
            g.polygon(pts, fill=lerp(hexc('#a7aab4'), hexc('#c9ccd6'), rnd.random()), outline=hexc('#4a4d57'))
        g.rrect([44, 56, 148, 182], 34, fill=hexc('#0e0f14'))
        for i in range(14): g.rrect([48 + i * 1.4, 60 + i * 1.6, 144 - i * 1.4, 182], 30 - i, fill=lerp(hexc('#10121a'), hexc('#1d2030' if f == 0 else '#27304a'), i / 13))
        if f == 1:
            g.rect([88, 86, 104, 122], fill=hexc('#7ec8e3')); g.polygon([(96, 160), (126, 122), (66, 122)], fill=hexc('#7ec8e3')); g.polygon([(96, 150), (118, 126), (74, 126)], fill=hexc('#b6e2f2'))
        frames.append(g.out())
    paste_frames(frames, 'tunnel')

# ---------------------------------------------------------------- hole (2 frames of 96x96): open, and lit green when the ball is in
def hole():
    frames = []
    for f in range(2):
        g = HD(96, 96); g.circle(48, 50, 46, fill=(0, 0, 0, 70)); g.circle(48, 48, 45, fill=hexc('#2b241e'))
        for i in range(20): g.circle(48 - i * 0.18, 48 - i * 0.18, 44 - i * 0.6, fill=lerp(hexc('#7d6b58'), hexc('#4a3d30'), i / 19))        # rolled lip, lit from the top left
        g.circle(48, 50, 36, fill=hexc('#1a1612'))
        base = hexc('#07070a') if f == 0 else hexc('#1d5c30')
        for i in range(30): g.circle(48 + i * 0.1, 51 + i * 0.1, 35 - i * 1.0, fill=lerp(hexc('#101014') if f == 0 else hexc('#2f8a4c'), base, i / 29))
        frames.append(g.out())
    paste_frames(frames, 'hole')

# ---------------------------------------------------------------- boost pad (128x128): gold tile with two chevrons
def pad():
    g = HD(128, 128); g.rrect([6, 6, 122, 122], 20, fill=hexc('#b36b00')); g.rrect([8, 8, 120, 118], 18, fill=hexc('#ffb703')); g.rrect([8, 8, 120, 60], 18, fill=hexc('#ffc93c'))
    for dy in (0, 34):
        g.polygon([(64, 24 + dy), (98, 56 + dy), (78, 56 + dy), (78, 74 + dy), (50, 74 + dy), (50, 56 + dy), (30, 56 + dy)], fill=hexc('#b36b00'))
        g.polygon([(64, 20 + dy), (96, 52 + dy), (77, 52 + dy), (77, 70 + dy), (51, 70 + dy), (51, 52 + dy), (32, 52 + dy)], fill=hexc('#fff3b0'))
    g.out().save(f'{ART}/boost.png')

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
