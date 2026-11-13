#!/usr/bin/env python3
"""Generates the nine Mini Golf holes (scenes/hole1..9.json), the scene registry (scenes/index.js) and previews.
Run:  python3 Tools/minigolf/make_course.py [--preview]      (previews go to tools/preview/*.png and need Pillow)
Everything is plain scene JSON, so each hole can be opened and tuned in the Piston editor afterwards.
"""
import json, math, os, random, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'Samples', 'MiniGolf')
SCENES = os.path.join(ROOT, 'scenes')
RES_W, RES_H = 1920, 1080
FONT = 'Chewy'   # the UI font (any Google Fonts family, or one downloaded into assets/fonts). Change it here and re-run, or set it per Text in the editor.

# ------------------------------------------------------------------ geometry helpers
def catmull(points, n=14):
    if len(points) < 3 or n <= 1: return [tuple(p) for p in points]
    pts = [points[0]] + list(points) + [points[-1]]; out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for k in range(n):
            t = k / n; t2 = t * t; t3 = t2 * t
            out.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in (0, 1)))
    out.append(tuple(points[-1])); return out

def corridor(points, width, n=14, cap_steps=10):
    c = catmull(points, n); half = width / 2
    def normal(i):
        a, b = c[max(0, i - 1)], c[min(len(c) - 1, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]; d = math.hypot(dx, dy) or 1
        return (-dy / d, dx / d), (dx / d, dy / d)
    left, right = [], []
    for i, p in enumerate(c):
        nrm, _ = normal(i); left.append((p[0] + nrm[0] * half, p[1] + nrm[1] * half)); right.append((p[0] - nrm[0] * half, p[1] - nrm[1] * half))
    def cap(center, nrm, tan, sign):   # semicircle from the left offset around the front to the right offset
        pts = []; base = math.atan2(nrm[1], nrm[0])
        for k in range(1, cap_steps):
            a = base - sign * math.pi * k / cap_steps
            pts.append((center[0] + math.cos(a) * half, center[1] + math.sin(a) * half))
        return pts
    n0, t0 = normal(0); n1, t1 = normal(len(c) - 1)
    poly = left + cap(c[-1], n1, t1, 1) + right[::-1] + cap(c[0], (-n0[0], -n0[1]), t0, 1)
    return poly, c

def rect(x0, y0, x1, y1): return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
def chamfer(x0, y0, x1, y1, r):
    return [(x0 + r, y0), (x1 - r, y0), (x1, y0 + r), (x1, y1 - r), (x1 - r, y1), (x0 + r, y1), (x0, y1 - r), (x0, y0 + r)]
def octagon(cx, cy, r): return [(cx + math.cos(math.pi / 8 + k * math.pi / 4) * r, cy + math.sin(math.pi / 8 + k * math.pi / 4) * r) for k in range(8)]
def centroid(poly): return (sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly))

def inside(poly, x, y):
    ins = False; j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]; xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi: ins = not ins
        j = i
    return ins
def dist_to_poly(poly, x, y):
    best = 1e9
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        dx, dy = b[0] - a[0], b[1] - a[1]; l2 = dx * dx + dy * dy or 1
        t = max(0, min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)); best = min(best, math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy)))
    return best

# ------------------------------------------------------------------ entity builders (the JSON the engine saves)
class Scene:
    def __init__(self, n, title, par, bg='#2f7d45'):
        self.n, self.title, self.par, self.bg = n, title, par, bg
        self.entities, self.grounds, self.counts = [], [], {}
    def key(self, kind):
        self.counts[kind] = self.counts.get(kind, 0) + 1; return f'{kind}-{self.counts[kind]}'
    def add(self, e): self.entities.append(e); return e['sceneKey']

def base(key, tag, typ, x, y, w, h, rot=0, fields=None, comps=None, rb=None, col=None, name=None, parent=None):
    e = {'sceneKey': key, 'tag': tag, 'name': name, 'type': typ, 'parentKey': parent,
         'transform': {'position': {'x': round(x, 2), 'y': round(y, 2)}, 'rotation': rot, 'size': {'x': w, 'y': h}}, 'fields': fields or {}}
    if rb is not None: e['rigidbody'] = rb
    if col is not None: e['collider'] = col
    if comps is not None: e['components'] = comps
    return e
STATIC = {'velocity': {'x': 0, 'y': 0}, 'angularVelocity': 0, 'mass': 0, 'isStatic': True, 'useGravity': False}
def collider(trigger=False, inverse=False): return {'enabled': True, 'isTrigger': trigger, 'isInverse': inverse}
def sprite(**f):
    d = {'imagePath': '', 'frameWidth': 0, 'frameHeight': 0, 'frameCount': 1, 'columns': 1, 'fps': 0, 'loop': True, 'anchorX': 0.5, 'anchorY': 0.5, 'opacity': 1, 'pixelArt': True, 'sortingOrder': 0}
    d.update(f); return {'type': 'SpriteRenderer', 'fields': d}
def polygon_renderer(verts, color, stroke, width, order):
    return {'type': 'PolygonRenderer', 'fields': {'vertices': [{'x': round(x, 2), 'y': round(y, 2)} for x, y in verts], 'color': color, 'strokeColor': stroke, 'strokeWidth': width, 'opacity': 1, 'sortingOrder': order}}
def clip(name, duration, tracks, loop=False): return {'name': name, 'duration': duration, 'loop': loop, 'tracks': tracks, 'events': []}
def track(path, *keys): return {'path': path, 'keys': [{'t': t, 'v': v, 'ease': e} for t, v, e in keys]}
def animator(clips, default='', play=False): return {'type': 'Animator', 'fields': {'clips': clips, 'asset': '', 'defaultClip': default, 'playOnStart': play, 'speed': 1}}
def emitter(**f):
    d = dict(emitting=False, rate=20, burstCount=12, lifetime=0.6, speed=120, speedVariation=0.4, angle=-90, spread=360, gravity=0, shape='circle',
             startSize=6, endSize=0, startColor='#ffffff', endColor='#ffffff', fade=True, worldSpace=True, maxParticles=300, sortingOrder=5)
    d.update(f); return {'type': 'ParticleEmitter', 'fields': d}

def add_ground(sc, poly, layer=None, ignores=''):
    cx, cy = centroid(poly); sc.grounds.append(poly)
    local = [(x - cx, y - cy) for x, y in poly]
    comps = [polygon_renderer(local, '#69c26f', '#6b4a2b', 9, 0)]
    if layer: comps.append({'type': 'CollisionLayer', 'fields': {'layer': layer, 'ignores': ignores}})   # separate sections hold the ball only while it is in them
    sc.add(base(sc.key('ground'), 'Polygon', 'Polygon', cx, cy, 20, 20, rb=dict(STATIC), col=collider(inverse=True), name='Fairway', comps=comps))

def add_zone(sc, poly, kind, color, stroke, name, rotation=0, boost=None, friction=None):
    cx, cy = centroid(poly); local = [(x - cx, y - cy) for x, y in poly]
    fields = {'kind': kind, 'zone': True, 'affectTag': 'Ball'}
    if boost is not None: fields['boost'] = boost
    if friction is not None: fields['friction'] = friction   # overrides the preset's friction (ball speeds here are pixels per frame)
    sc.add(base(sc.key(kind), 'Polygon', 'Polygon', cx, cy, 20, 20, rot=rotation, rb=dict(STATIC), col=collider(trigger=True), name=name,
                comps=[polygon_renderer(local, color, stroke, 3, 1), {'type': 'PhysicsMaterial', 'fields': fields}]))
def add_sand(sc, poly, name='Sand'): add_zone(sc, poly, 'sand', '#e8d5a0', '#c4a86a', name, friction=0.08)
def add_ice(sc, poly, name='Ice'): add_zone(sc, poly, 'ice', '#c4ecf7', '#8fc7dc', name, friction=0.004)

def add_wall(sc, x, y, w, h, rot=0, name='Wall', comps_extra=None):
    comps = [{'type': 'ShapeRenderer', 'fields': {'shape': 'rect', 'color': '#9a6a3a', 'strokeColor': '#5c3a1c', 'strokeWidth': 3, 'radius': 10, 'opacity': 1, 'sortingOrder': 4}}] + (comps_extra or [])
    return sc.add(base(sc.key('wall'), 'Wall', 'Wall', x, y, w, h, rot, rb=dict(STATIC), col=collider(), name=name, comps=comps))

def add_rock(sc, x, y, radius, variant):
    sc.add(base(sc.key('rock'), 'Rock', 'Rock', x, y, radius * 2.3, radius * 2.3, fields={'radius': radius, 'variant': variant}, name='Rock'))

def add_blade(sc, x, y, length, start, seconds, name):
    spin = clip('spin', seconds, [track('transform.rotation', (0, start, 'linear'), (seconds, start + 360, 'linear'))], loop=True)
    sc.add(base(sc.key('blade'), 'Blade', 'Blade', x, y, length, 16, start, rb=dict(STATIC), col=collider(), name=name,
                comps=[sprite(imagePath='./assets/art/blade.png', sortingOrder=5), animator([spin], 'spin', True)]))

def add_decor(sc, kind, x, y, size):
    sc.add(base(sc.key('decor'), 'Decor', 'Decor', x, y, size, size, fields={'kind': kind}, name=kind.capitalize()))

def add_ball(sc, x, y):
    clips = [
        clip('sink', 0.45, [track('transform.size.x', (0, 24, 'easeIn'), (0.45, 0, 'linear')), track('transform.size.y', (0, 24, 'easeIn'), (0.45, 0, 'linear')),
                            track('SpriteRenderer.opacity', (0, 1, 'linear'), (0.3, 1, 'easeIn'), (0.45, 0.2, 'linear'))]),
        clip('tunnelIn', 0.25, [track('transform.size.x', (0, 24, 'easeIn'), (0.25, 0, 'linear')), track('transform.size.y', (0, 24, 'easeIn'), (0.25, 0, 'linear'))]),
        clip('tunnelOut', 0.3, [track('transform.size.x', (0, 0, 'backOut'), (0.3, 24, 'linear')), track('transform.size.y', (0, 0, 'backOut'), (0.3, 24, 'linear'))]),
    ]
    sc.add(base('ball', 'Ball', 'Ball', x, y, 24, 24, name='Ball',
                fields={'radius': 12, 'maxDragDistance': 180, 'powerScale': 0.1, 'pickRadius': 40, 'restSpeed': 5, 'sinkDuration': 0.4, 'shotCount': 0},
                rb={'velocity': {'x': 0, 'y': 0}, 'angularVelocity': 0, 'mass': 1, 'isStatic': False, 'useGravity': False}, col=collider(),
                comps=[sprite(imagePath='./assets/art/ball.png', frameWidth=16, frameHeight=16, sortingOrder=3), animator(clips),
                       emitter(burstCount=8, lifetime=0.5, speed=55, speedVariation=0.5, startSize=7, endSize=1, startColor='#e9e4d0', endColor='#e9e4d0')]))

def add_hole(sc, x, y):
    confetti = [dict(startColor='#ffd166', endColor='#ff9f1c'), dict(startColor='#ef476f', endColor='#c77dff'), dict(startColor='#7ec8e3', endColor='#ffffff')]
    comps = [sprite(imagePath='./assets/art/hole.png', frameWidth=24, frameHeight=24, frameCount=2, columns=2)]
    for c in confetti:
        comps.append(emitter(burstCount=18, lifetime=1.1, speed=300, speedVariation=0.5, angle=-90, spread=150, gravity=420, shape='square', startSize=8, endSize=4, **c))
    hid = sc.add(base('hole', 'Hole', 'Hole', x, y, 38.4, 38.4, name='Hole',
                      rb={'velocity': {'x': 0, 'y': 0}, 'angularVelocity': 0, 'mass': 1000, 'isStatic': True, 'useGravity': False}, col=collider(trigger=True), comps=comps))
    sc.add(base('flag', 'Flag', 'Flag', x + 2, y + 3, 32, 60, name='Flag', parent=hid))

def add_tunnel(sc, x, y, rotation, role, link='a', ball_layer='Player'):
    comps = [sprite(imagePath='./assets/art/tunnel.png', frameWidth=48, frameHeight=48, frameCount=2, columns=2, sortingOrder=2),
             emitter(burstCount=14, lifetime=0.6, speed=90, speedVariation=0.5, spread=120, startSize=9, endSize=2, startColor='#c9ccd6', endColor='#8a8d96')]
    sc.add(base(sc.key('tunnel'), 'Tunnel', 'Tunnel', x, y, 92, 92, rotation, fields={'linkId': link, 'role': role, 'exitSpeed': 280, 'radius': 26, 'ballLayer': ball_layer}, name=f'Tunnel {role}',
                rb=dict(STATIC), col=collider(trigger=True), comps=comps))

def add_scenery(sc, seed, count=30):
    rnd = random.Random(seed); xs = [p[0] for g in sc.grounds for p in g]; ys = [p[1] for g in sc.grounds for p in g]
    x0, x1, y0, y1 = min(xs) - 230, max(xs) + 230, min(ys) - 190, max(ys) + 190
    placed = []
    for _ in range(count * 25):
        if len(placed) >= count: break
        x, y = rnd.uniform(x0, x1), rnd.uniform(y0, y1)
        if any(inside(g, x, y) or dist_to_poly(g, x, y) < 78 for g in sc.grounds): continue
        if any(math.hypot(x - px, y - py) < 70 for px, py in placed): continue
        placed.append((x, y)); kind = rnd.choices(['tree', 'bush', 'flowers', 'pine'], [3, 3, 3, 2])[0]
        add_decor(sc, kind, x, y, rnd.choice([70, 80, 90]) if kind in ('tree', 'pine') else rnd.choice([54, 60, 66]))

def ui_element(sc, key, name, x, y, w, h, text, color, size, order, extra=None, radius=16):
    comps = [{'type': 'Text', 'fields': {'text': text, 'fontFamily': FONT, 'fontSize': size, 'color': '#ffffff', 'align': 'center', 'sortingOrder': order + 1}},
             {'type': 'UIContainer', 'fields': {'color': color, 'imagePath': '', 'cornerRadius': radius, 'sortingOrder': order}}] + (extra or [])
    sc.add(base(key, name, 'UIElement', x, y, w, h, name=name, comps=comps))

def finish(sc):
    xs = [p[0] for g in sc.grounds for p in g]; ys = [p[1] for g in sc.grounds for p in g]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2 - 30
    w, h = max(xs) - min(xs) + 240, max(ys) - min(ys) + 300
    zoom = round(max(0.45, min(1.3, RES_W / w, (RES_H - 170) / h)), 3)
    sc.add(base('camera', 'MainCamera', 'MainCamera', cx, cy, 20, 20, name='Camera', comps=[{'type': 'Camera', 'fields': {'zoom': zoom}}]))
    nxt = f'hole{sc.n + 1}' if sc.n < 9 else ''
    # Big, readable HUD (the game renders at 1920x1080): stroke count, par, and the hole number.
    ui_element(sc, 'shotcount', 'ShotCount', 175, 62, 290, 80, 'Stroke 0', '#1f2a24', 44, 1)
    ui_element(sc, 'par', 'Par', 440, 62, 200, 80, f'Par {sc.par}', '#26332c', 44, 0,
               extra=[{'type': 'LevelInfo', 'fields': {'title': f'Hole {sc.n}', 'par': sc.par, 'nextScene': nxt}}])
    ui_element(sc, 'title', 'Title', 960, 62, 300, 88, f'Hole {sc.n}', '#1f2a24', 54, 1, radius=18)
    # The score card slides down from above the screen; it sits where it ends up so it can be edited, and starts hidden when the game plays.
    shown, hidden = 540, -460
    slide_in = clip('slideIn', 0.8, [track('transform.position.y', (0, hidden, 'backOut'), (0.8, shown, 'linear'))])
    slide_out = clip('slideOut', 0.5, [track('transform.position.y', (0, shown, 'easeIn'), (0.5, hidden, 'linear'))])
    sc.add(base('scorecard', 'Scorecard', 'Scorecard', 960, shown, 1560, 700, name='Score card', fields={'space': 'Screen'}, comps=[animator([slide_in, slide_out])]))
    return zoom

def menu():
    sc = Scene(0, 'Main Menu', 0, bg='#2f7d45'); sc.is_menu = True
    poly, c = corridor([(380, 905), (1540, 905)], 170, n=1)                      # a little fairway strip for the ball and flag
    cx, cy = centroid(poly); local = [(x - cx, y - cy) for x, y in poly]
    sc.add(base('fairway', 'Polygon', 'Polygon', cx, cy, 20, 20, rb=dict(STATIC), col=collider(trigger=True), name='Fairway', comps=[polygon_renderer(local, '#69c26f', '#6b4a2b', 9, 0)]))
    rnd = random.Random(5)
    for _ in range(60):
        x, y = rnd.uniform(40, 1880), rnd.uniform(380, 1040)
        if dist_to_poly(poly, x, y) < 110 or inside(poly, x, y) or abs(x - 960) < 420 and y < 700: continue
        add_decor(sc, rnd.choices(['tree', 'bush', 'flowers', 'pine'], [3, 3, 3, 2])[0], x, y, rnd.choice([84, 96, 110]))
    add_decor(sc, 'ball', 560, 905, 56); add_decor(sc, 'hole', 1380, 912, 64)
    sc.add(base('flag', 'Flag', 'Flag', 1384, 918, 48, 90, name='Flag'))
    drop = clip('drop', 1.2, [track('transform.position.y', (0, -300, 'bounceOut'), (1.2, 280, 'linear'))])
    sc.add(base('sign', 'Title', 'UIElement', 960, 280, 1080, 300, name='Title', comps=[
        {'type': 'Text', 'fields': {'text': 'Mini Golf', 'fontFamily': FONT, 'fontSize': 190, 'color': '#fff6d5', 'align': 'center', 'sortingOrder': 2}},
        {'type': 'UIContainer', 'fields': {'color': '#6b4a2b', 'imagePath': '', 'cornerRadius': 40, 'sortingOrder': 1}},
        animator([drop], 'drop', True)]))
    pulse = clip('pulse', 1.6, [track('transform.size.x', (0, 440, 'easeInOut'), (0.8, 470, 'easeInOut'), (1.6, 440, 'linear')), track('transform.size.y', (0, 140, 'easeInOut'), (0.8, 150, 'easeInOut'), (1.6, 140, 'linear'))], loop=True)
    sc.add(base('play', 'PlayButton', 'UIElement', 960, 610, 440, 140, name='Play button', comps=[
        {'type': 'Text', 'fields': {'text': 'Play', 'fontFamily': FONT, 'fontSize': 96, 'color': '#2b1b0a', 'align': 'center', 'sortingOrder': 4}},
        {'type': 'UIContainer', 'fields': {'color': '#e9a23b', 'imagePath': '', 'cornerRadius': 36, 'sortingOrder': 3}},
        {'type': 'Button', 'fields': {'sortingOrder': 3}},
        {'type': 'ButtonAction', 'fields': {'action': 'newGame', 'target': 'hole1', 'hoverColor': '#f6bd5c'}},
        animator([pulse], 'pulse', True)]))
    sc.add(base('hint', 'Hint', 'UIElement', 960, 770, 900, 70, name='Hint', comps=[
        {'type': 'Text', 'fields': {'text': 'Pull back from the ball and let go to putt', 'fontFamily': FONT, 'fontSize': 46, 'color': '#fff6d5', 'align': 'center', 'sortingOrder': 4}},
        {'type': 'UIContainer', 'fields': {'color': 'rgba(31,42,36,0.55)', 'imagePath': '', 'cornerRadius': 24, 'sortingOrder': 3}}]))
    sc.add(base('camera', 'MainCamera', 'MainCamera', 960, 540, 20, 20, name='Camera', comps=[{'type': 'Camera', 'fields': {'zoom': 1}}]))
    return sc

# ------------------------------------------------------------------ the nine holes
def hole1():
    sc = Scene(1, 'Straight Shot', 2)
    poly, c = corridor([(0, 0), (1000, 0)], 280, n=1); add_ground(sc, poly)
    add_ball(sc, 60, 0); add_hole(sc, 900, 0); add_scenery(sc, 11); return sc

def hole2():
    sc = Scene(2, 'The Dogleg', 3)
    poly, c = corridor([(0, 300), (380, 300), (700, 150), (900, -150), (1250, -250)], 250); add_ground(sc, poly)
    add_ball(sc, 60, 300); add_hole(sc, 1190, -250); add_scenery(sc, 22); return sc

def hole3():
    sc = Scene(3, 'Sand Alley', 3)
    add_ground(sc, chamfer(-120, -210, 1450, 210, 40))
    add_sand(sc, rect(300, -210, 1050, -45), 'Sand (north)'); add_sand(sc, rect(300, 45, 1050, 210), 'Sand (south)')
    add_ball(sc, 40, 0); add_hole(sc, 1290, 0); add_scenery(sc, 33); return sc

def hole4():
    sc = Scene(4, 'The Windmill', 3)
    poly, c = corridor([(0, 0), (1200, 0)], 250, n=1); add_ground(sc, poly)
    add_decor(sc, 'windmill', 600, -190, 150)
    add_blade(sc, 600, 0, 224, 0, 7, 'Blade A'); add_blade(sc, 600, 0, 224, 90, 7, 'Blade B'); add_decor(sc, 'hub', 600, 0, 34)
    add_ball(sc, 60, 0); add_hole(sc, 1100, 0); add_scenery(sc, 44); return sc

def hole5():
    sc = Scene(5, 'Rocky Creek', 4)
    poly, c = corridor([(0, 0), (380, -110), (760, 90), (1140, -110), (1500, 0)], 250); add_ground(sc, poly)
    def on(u, off):
        i = int(u * (len(c) - 1)); a, b = c[max(0, i - 1)], c[min(len(c) - 1, i + 1)]
        d = math.hypot(b[0] - a[0], b[1] - a[1]) or 1; nx, ny = -(b[1] - a[1]) / d, (b[0] - a[0]) / d
        return c[i][0] + nx * off, c[i][1] + ny * off
    for k, (u, off, r, v) in enumerate([(0.2, 60, 24, 0), (0.38, -70, 28, 1), (0.52, 55, 22, 2), (0.66, -60, 26, 0), (0.8, 70, 24, 1), (0.88, -40, 20, 2)]):
        x, y = on(u, off); add_rock(sc, x, y, r, v)
    bx, by = on(0.03, 0); hx, hy = on(0.96, 0); add_ball(sc, bx, by); add_hole(sc, hx, hy); add_scenery(sc, 55); return sc

def hole6():
    sc = Scene(6, 'Tunnel Vision', 3)
    a, _ = corridor([(0, 0), (700, 0)], 260, n=1); b, _ = corridor([(1000, 440), (1700, 440)], 260, n=1)
    add_ground(sc, a, 'Wall', 'Enemy'); add_ground(sc, b, 'Pickup', 'Player')    # the ball is on layer Player in A, Enemy in B (set by the exit tunnel)
    add_tunnel(sc, 705, 0, 90, 'entrance'); add_tunnel(sc, 995, 440, -90, 'exit', ball_layer='Enemy')
    add_ball(sc, 60, 0); add_hole(sc, 1620, 440); add_scenery(sc, 66); return sc

def hole7():
    sc = Scene(7, 'Ice Rink', 3, bg='#2b6f58')
    add_ground(sc, chamfer(0, -260, 1400, 260, 70)); add_ice(sc, rect(250, -260, 1050, 260), 'Ice')
    for x, y, r, v in [(520, -120, 24, 0), (700, 110, 28, 1), (880, -70, 22, 2)]: add_rock(sc, x, y, r, v)
    add_ball(sc, 90, 0); add_hole(sc, 1290, 0); add_scenery(sc, 77); return sc

def hole8():
    sc = Scene(8, 'Boost Alley', 3)
    poly, c = corridor([(0, 0), (1350, 0)], 300, n=1); add_ground(sc, poly)
    add_zone(sc, rect(190, -70, 340, 70), 'boost', '#ffb703', '#b36b00', 'Boost pad', rotation=0, boost=60); add_decor(sc, 'boost', 265, 0, 54)
    def gate(x, y0, y1, name):
        slide = clip('slide', 3.2, [track('transform.position.y', (0, y0, 'easeInOut'), (1.6, y1, 'easeInOut'), (3.2, y0, 'linear'))], loop=True)
        add_wall(sc, x, y0, 26, 175, 0, name, [animator([slide], 'slide', True)])
    gate(700, -80, 80, 'Gate A'); gate(950, 80, -80, 'Gate B')
    add_ball(sc, 50, 0); add_hole(sc, 1250, 0); add_scenery(sc, 88); return sc

def hole9():
    sc = Scene(9, 'Grand Finale', 5)
    poly, c = corridor([(0, 220), (420, 220), (780, -40), (1100, -250), (1560, -250), (1900, -40)], 290); add_ground(sc, poly)
    add_sand(sc, octagon(1840, -50, 105), 'Bunker')
    add_blade(sc, 1330, -250, 252, 20, 6, 'Blade A'); add_blade(sc, 1330, -250, 252, 110, 6, 'Blade B'); add_decor(sc, 'hub', 1330, -250, 34); add_decor(sc, 'windmill', 1330, -470, 150)
    for x, y, r, v in [(430, 160, 24, 0), (600, 130, 26, 1), (860, -110, 22, 2)]: add_rock(sc, x, y, r, v)
    add_ball(sc, 60, 220); add_hole(sc, 1860, -45); add_scenery(sc, 99, 36); return sc

HOLES = [hole1, hole2, hole3, hole4, hole5, hole6, hole7, hole8, hole9]

def write():
    os.makedirs(SCENES, exist_ok=True); built = []
    for make in HOLES:
        sc = make(); zoom = finish(sc)
        data = {'version': 3, 'sceneName': f'Mini Golf - Hole {sc.n}', 'backgroundColor': sc.bg, 'deletedKeys': [], 'entities': sc.entities}
        with open(os.path.join(SCENES, f'hole{sc.n}.json'), 'w') as f: json.dump(data, f, indent=2)
        built.append((sc, zoom)); print(f'hole{sc.n}: {sc.title}  par {sc.par}  entities {len(sc.entities)}  zoom {zoom}')
    m = menu()
    with open(os.path.join(SCENES, 'menu.json'), 'w') as f: json.dump({'version': 3, 'sceneName': 'Mini Golf - Menu', 'backgroundColor': m.bg, 'deletedKeys': [], 'entities': m.entities}, f, indent=2)
    print(f'menu: entities {len(m.entities)}')
    lines = ["import { Scene } from '@piston/Scene.js';", "import { SceneRegistry } from '@piston/SceneRegistry.js';", '',
             '// Generated by Tools/minigolf/make_course.py. Each scene is an id and a name; its layout lives in scenes/<id>.json.', '',
             "SceneRegistry.register(new Scene({ id: 'menu', name: 'Main Menu', backgroundColor: '#2f7d45' }));"]
    for sc, _ in built: lines.append(f"SceneRegistry.register(new Scene({{ id: 'hole{sc.n}', name: 'Hole {sc.n}', backgroundColor: '{sc.bg}' }}));")
    with open(os.path.join(SCENES, 'index.js'), 'w') as f: f.write('\n'.join(lines) + '\n')
    scripts = os.path.join(ROOT, 'scripts')
    with open(os.path.join(scripts, 'Course.js'), 'w') as f:
        f.write('// Generated by Tools/minigolf/make_course.py: the holes in play order, with their pars (the score card reads this).\nexport const COURSE = [\n'
                + ''.join(f"    {{ id: 'hole{sc.n}', par: {sc.par} }},\n" for sc, _ in built) + '];\n')
    with open(os.path.join(scripts, 'Theme.js'), 'w') as f:
        f.write(f"// Generated by Tools/minigolf/make_course.py (FONT at the top of that file). The font the score card draws with.\nexport const FONT = '{FONT}';\n")
    cfg_path = os.path.join(ROOT, 'project.piston.json'); cfg = json.load(open(cfg_path))
    cfg['sampleRevision'] = 3; cfg['startScene'] = 'menu'; cfg['sceneOrder'] = ['menu'] + [f'hole{sc.n}' for sc, _ in built]
    json.dump(cfg, open(cfg_path, 'w'), indent=2); open(cfg_path, 'a').write('\n')
    return built

def preview(built):
    from PIL import Image, ImageDraw
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'preview'); os.makedirs(out, exist_ok=True)
    for sc, zoom in built:
        cam = [e for e in sc.entities if e['type'] == 'MainCamera'][0]['transform']['position']
        img = Image.new('RGB', (RES_W // 2, RES_H // 2), sc.bg); d = ImageDraw.Draw(img); s = zoom / 2
        P = lambda x, y: ((x - cam['x']) * s + RES_W / 4, (y - cam['y']) * s + RES_H / 4)
        for e in sc.entities:
            t = e['transform']; x, y = t['position']['x'], t['position']['y']
            comps = {c['type']: c['fields'] for c in e.get('components', [])}
            if 'PolygonRenderer' in comps:
                pf = comps['PolygonRenderer']; pts = [P(x + v['x'], y + v['y']) for v in pf['vertices']]
                d.polygon(pts, fill=pf['color'], outline=pf['strokeColor'])
            elif e['type'] == 'Wall': w, h = t['size']['x'] * s, t['size']['y'] * s; px, py = P(x, y); d.rectangle([px - w / 2, py - h / 2, px + w / 2, py + h / 2], fill='#9a6a3a')
            elif e['type'] == 'Blade':
                a = math.radians(t['rotation']); L = t['size']['x'] / 2 * s; px, py = P(x, y); d.line([px - math.cos(a) * L, py - math.sin(a) * L, px + math.cos(a) * L, py + math.sin(a) * L], fill='#f1e9d2', width=5)
            elif e['type'] == 'Rock': r = e['fields']['radius'] * s; px, py = P(x, y); d.ellipse([px - r, py - r, px + r, py + r], fill='#888')
            elif e['type'] == 'Decor': r = t['size']['x'] * s * 0.35; px, py = P(x, y); d.ellipse([px - r, py - r, px + r, py + r], fill={'tree': '#1d7a3a', 'pine': '#17602e', 'bush': '#35a050', 'flowers': '#e0609a'}.get(e['fields']['kind'], '#d9cdb8'))
            elif e['type'] == 'Tunnel': px, py = P(x, y); d.rectangle([px - 12, py - 12, px + 12, py + 12], fill='#444' if e['fields']['role'] == 'entrance' else '#37a')
            elif e['type'] == 'Ball': px, py = P(x, y); d.ellipse([px - 5, py - 5, px + 5, py + 5], fill='white', outline='black')
            elif e['type'] == 'Hole': px, py = P(x, y); d.ellipse([px - 8, py - 8, px + 8, py + 8], fill='black')
        img.save(os.path.join(out, f'hole{sc.n}.png'))
    sheet = Image.new('RGB', (RES_W // 2 * 3, RES_H // 2 * 3)); 
    for i, (sc, _) in enumerate(built): sheet.paste(Image.open(os.path.join(out, f'hole{sc.n}.png')), ((i % 3) * RES_W // 2, (i // 3) * RES_H // 2))
    sheet.resize((sheet.width // 2, sheet.height // 2)).save(os.path.join(out, 'all.png')); print('previews in', out)

if __name__ == '__main__':
    built = write()
    if '--preview' in sys.argv: preview(built)
