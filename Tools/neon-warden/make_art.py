#!/usr/bin/env python3
"""Generates all Neon Warden sprites. Run:  python3 Tools/neon-warden/make_art.py [name ...]    (needs Pillow; no numpy, no external assets)
Every sprite is authored at 2x its on-screen size with 3x supersampling. Sheets are single rows unless noted; frame sizes are listed next to each generator.
"""
import math, random, sys
from PIL import Image, ImageChops, ImageFilter, ImageDraw
from gfx import *

VOID = hexc('#070a1a'); HULL0 = hexc('#141a33'); HULL1 = hexc('#26305a'); HULL2 = hexc('#4a5a8c'); HULL_HI = hexc('#8fa3d8')
CYAN = hexc('#33e6ff'); CYAN_W = hexc('#d8fbff'); CYAN_D = hexc('#0b6f99')
MAG = hexc('#ff2e88'); MAG_D = hexc('#7a0f45'); MAG_W = hexc('#ffd0e6')
AMB = hexc('#ffb02e'); AMB_W = hexc('#fff0c8'); AMB_D = hexc('#8a4a08')
WHITE = (255, 255, 255, 255)

def body(cv, mask, c0=HULL2, c1=HULL0, angle=70, ao=0.8, ao_r=5, bevel=0.6, rim=CYAN, rim_s=0.8):
    cv.gradient_fill(mask, c0, c1, angle)
    cv.shadow_inner(mask, ao, ao_r)
    if bevel: cv.bevel(mask, (220, 235, 255, 255), 1.3, bevel)
    if rim: cv.rim(mask, rim, 2.2, rim_s)

def panel_line(cv, pts, w=1.1, dark=(3, 5, 16, 255), light=(120, 150, 210, 255)):
    cv.paint(cv.line_mask(pts, w), dark, 0.9)
    cv.paint(cv.line_mask([(x + 0.7, y + 0.7) for x, y in pts], w * 0.6), light, 0.35)

def tf(pts, dx, dy): return [(x + dx, y + dy) for x, y in pts]

# =========================================================================================== player ship: 6 frames of 288x192 (flame: 0-2 idle, 3-5 thrust)
def ship_frame(i):
    W, H = 288, 192; cx, cy = 144, 96
    cv = Cv(W, H)
    fl = [0.55, 0.75, 0.6, 1.0, 1.25, 1.1][i]; wob = [0, 1, -1, 0, 1.5, -1.5][i]
    # engine flames first (behind the hull)
    for sy in (-1, 1):
        ex, ey = cx - 48, cy + sy * 11
        L = 62 * fl; hw = 9 * (0.8 + 0.2 * fl)
        pts = [(ex, ey - hw), (ex - L * 0.45, ey - hw * 0.8 + wob), (ex - L, ey + wob * 0.6), (ex - L * 0.45, ey + hw * 0.8 + wob), (ex, ey + hw)]
        m = cv.poly_mask(pts).filter(ImageFilter.GaussianBlur(1.0 * cv.ss))
        cv.glow(m, CYAN, 14, 0.9); cv.paint(m, CYAN, 0.9)
        core = cv.poly_mask([(ex, ey - hw * 0.5), (ex - L * 0.5, ey + wob * 0.3), (ex, ey + hw * 0.5)]).filter(ImageFilter.GaussianBlur(0.8 * cv.ss))
        cv.paint(core, CYAN_W)
    # wings
    for sy in (-1, 1):
        wing = [(cx + 16, cy + sy * 10), (cx - 8, cy + sy * 47), (cx - 34, cy + sy * 54), (cx - 42, cy + sy * 50), (cx - 30, cy + sy * 20), (cx - 20, cy + sy * 12)]
        m = cv.poly_mask(wing)
        cv.shadow(m, (0, 0), 6, 0.0)
        body(cv, m, HULL2, HULL0, 60 if sy < 0 else 120, 0.9, 6, 0.8, CYAN, 0.9)
        # leading-edge trim light
        edge = [(cx + 14, cy + sy * 12), (cx - 6, cy + sy * 44)]
        cv.emissive(cv.line_mask(edge, 1.6), CYAN, 5, 0.7, CYAN_W)
        panel_line(cv, [(cx - 16, cy + sy * 16), (cx - 30, cy + sy * 46)])
        # wing gun
        gun = cv.rrect_mask((cx - 4, cy + sy * 24 - 2.2, cx + 40, cy + sy * 24 + 2.2), 1.6)
        body(cv, gun, HULL2, HULL0, 90, 0.5, 2, 0.5, None)
        cv.emissive(cv.circle_mask(cx + 40, cy + sy * 24, 2.4), CYAN, 4, 0.6, WHITE)
        # engine pod
        pod = cv.rrect_mask((cx - 54, cy + sy * 11 - 8, cx - 34, cy + sy * 11 + 8), 3)
        body(cv, pod, HULL2, HULL0, 90, 0.9, 3, 0.5, None)
        cv.emissive(cv.ellipse_mask(cx - 53, cy + sy * 11, 2.5, 6), CYAN_W, 4, 0.9, WHITE)
    # fuselage
    fus = [(cx + 60, cy), (cx + 38, cy - 7), (cx + 8, cy - 14), (cx - 28, cy - 17), (cx - 46, cy - 10), (cx - 46, cy + 10), (cx - 28, cy + 17), (cx + 8, cy + 14), (cx + 38, cy + 7)]
    m = cv.poly_mask(fus)
    body(cv, m, HULL_HI, HULL0, 75, 0.85, 6, 0.8, CYAN, 0.7)
    panel_line(cv, [(cx - 22, cy - 15), (cx - 22, cy + 15)]); panel_line(cv, [(cx + 30, cy - 8), (cx + 30, cy + 8)])
    panel_line(cv, [(cx - 40, cy - 6), (cx - 4, cy - 10)], 0.8); panel_line(cv, [(cx - 40, cy + 6), (cx - 4, cy + 10)], 0.8)
    # centre spine light
    cv.emissive(cv.line_mask([(cx - 34, cy), (cx - 10, cy)], 1.4), CYAN, 4, 0.6, CYAN_W)
    # canopy
    can = cv.ellipse_mask(cx + 12, cy, 17, 7.5)
    cv.gradient_fill(can, hexc('#123a57'), hexc('#02111f'), 90)
    cv.rim(can, CYAN, 1.5, 0.9, 0.8)
    cv.specular(cx + 17, cy - 3, 8, 1.8, 0.0, 0.8)
    cv.paint(cv.ellipse_mask(cx + 3, cy + 2, 5, 1.2), CYAN, 0.35)
    # nose light
    cv.emissive(cv.circle_mask(cx + 54, cy, 1.8), CYAN_W, 3, 0.7, WHITE)
    return cv.out()

def make_ship():
    save_sheet([ship_frame(i) for i in range(6)], 'ship.png')


# =========================================================================================== drone: 8 frames of 160x160 (4-fold blades rotate 90 deg over the loop; core pulses)
def drone_frame(i, n=8):
    S = 160; cx = cy = 80
    cv = Cv(S, S)
    rot = (i / n) * (math.pi / 2); pulse = 0.5 + 0.5 * math.sin(i / n * 2 * math.pi)
    # blades
    for k in range(4):
        a = rot + k * math.pi / 2
        outer = [(cx + 62 * math.cos(a + t), cy + 62 * math.sin(a + t)) for t in [(-0.62 + 1.24 * j / 14) for j in range(15)]]
        inner = [(cx + 38 * math.cos(a + t), cy + 38 * math.sin(a + t)) for t in [(0.38 - 0.76 * j / 14) for j in range(15)]]
        m = cv.poly_mask(outer + inner)
        body(cv, m, HULL2, HULL0, math.degrees(a) + 20, 0.9, 5, 0.7, MAG, 1.0)
        tip = (cx + 61 * math.cos(a + 0.6), cy + 61 * math.sin(a + 0.6))
        cv.emissive(cv.circle_mask(tip[0], tip[1], 2.6), MAG, 6, 0.9, MAG_W)
        # blade edge light
        edge = [(cx + 59 * math.cos(a + t), cy + 59 * math.sin(a + t)) for t in [(-0.5 + 1.0 * j / 8) for j in range(9)]]
        cv.emissive(cv.line_mask(edge, 1.2), MAG, 4, 0.5)
        # spoke
        sp = [(cx + 24 * math.cos(a), cy + 24 * math.sin(a)), (cx + 40 * math.cos(a), cy + 40 * math.sin(a))]
        spm = cv.line_mask(sp, 9, False)
        body(cv, spm, HULL1, HULL0, 90, 0.7, 2, 0.4, None)
    # hull disc
    disc = cv.circle_mask(cx, cy, 30)
    body(cv, disc, HULL_HI, HULL0, 60, 0.9, 7, 0.9, MAG, 0.8)
    cv.paint(cv.ring_mask(cx, cy, 22, 1.6), (3, 5, 16, 255), 0.9)
    cv.paint(cv.ring_mask(cx + 0.5, cy + 0.5, 22, 0.9), (150, 170, 220, 255), 0.35)
    for k in range(4):  # vents
        a = rot * 0 + k * math.pi / 2 + math.pi / 4
        v = cv.line_mask([(cx + 24 * math.cos(a), cy + 24 * math.sin(a)), (cx + 28 * math.cos(a), cy + 28 * math.sin(a))], 2.4, False)
        cv.paint(v, MAG_D)
    # core eye
    r = 10 + 2.4 * pulse
    cv.emissive(cv.circle_mask(cx, cy, r), MAG, 12, 0.7 + 0.3 * pulse, MAG_W)
    cv.paint(cv.circle_mask(cx, cy, r * 0.45), WHITE, 0.95)
    cv.specular(cx - 3, cy - 4, 3, 1.5, -0.5, 0.6)
    return cv.out()

def make_drone():
    save_sheet([drone_frame(i) for i in range(8)], 'drone.png')

# =========================================================================================== turret base (256) and head sheet (6 x 256: idle, charge x4, fire)
def make_turret_base():
    S = 256; cx = cy = 128
    cv = Cv(S, S)
    hexpts = [(cx + 118 * math.cos(math.radians(60 * k + 30)), cy + 118 * math.sin(math.radians(60 * k + 30))) for k in range(6)]
    m = cv.poly_mask(hexpts)
    cv.shadow(m, (3, 6), 8, 0.55)
    body(cv, m, HULL1, HULL0, 70, 0.9, 9, 0.8, None)
    for k in range(6):  # hazard chevrons on each flat
        a = math.radians(60 * k + 30 + 30)
        p = (cx + 102 * math.cos(a), cy + 102 * math.sin(a))
        ch = rotate_pts([(-9, -5), (4, -5), (9, 0), (4, 5), (-9, 5), (-4, 0)], a + math.pi / 2, p[0], p[1])
        cv.paint(cv.poly_mask(ch), AMB, 0.85)
    inner = cv.circle_mask(cx, cy, 86)
    body(cv, inner, HULL0, hexc('#0a0e22'), 90, 1.0, 10, 0.5, None)
    cv.paint(cv.ring_mask(cx, cy, 80, 3), AMB_D, 0.9)
    cv.emissive(cv.ring_mask(cx, cy, 78, 1.4), AMB, 6, 0.6)
    for k in range(8):  # bolts
        a = math.radians(45 * k + 22)
        bm = cv.circle_mask(cx + 108 * math.cos(a) * 0.93, cy + 108 * math.sin(a) * 0.93, 3.6)
        body(cv, bm, HULL_HI, HULL0, 60, 0.6, 1.5, 0.5, None)
    cv.save('turret_base.png')

def turret_head_frame(i):
    S = 256; cx = cy = 128
    cv = Cv(S, S)
    charge = [0, 0.25, 0.5, 0.75, 1.0, 0][i]; fire = i == 5
    kick = -9 if fire else 0
    # barrels
    for sy in (-1, 1):
        bm = cv.rrect_mask((cx + 14 + kick, cy + sy * 20 - 9, cx + 112 + kick, cy + sy * 20 + 9), 4)
        cv.shadow(bm, (2, 4), 4, 0.5)
        body(cv, bm, HULL2, HULL0, 90, 0.8, 3, 0.7, MAG, 0.6)
        slit = cv.rrect_mask((cx + 34 + kick, cy + sy * 20 - 1.5, cx + 100 + kick, cy + sy * 20 + 1.5), 1.2)
        cv.emissive(slit, scale_c(AMB, 0.25 + 0.75 * charge), 5 + 5 * charge, 0.3 + 0.7 * charge, AMB_W if charge > 0.6 else None)
        tip = cv.circle_mask(cx + 112 + kick, cy + sy * 20, 5)
        cv.emissive(tip, scale_c(AMB, 0.3 + 0.7 * charge), 8 + 8 * charge, 0.3 + 0.7 * charge, AMB_W if charge > 0.5 else None)
    # dome
    dome = cv.circle_mask(cx, cy, 58)
    body(cv, dome, HULL_HI, HULL0, 65, 0.95, 12, 0.9, MAG, 0.9)
    cv.paint(cv.ring_mask(cx, cy, 44, 2), (3, 5, 16, 255), 0.9)
    cv.paint(cv.ring_mask(cx + 0.6, cy + 0.6, 44, 1.1), (150, 170, 220, 255), 0.35)
    for k in range(6):
        a = math.radians(60 * k); panel_line(cv, [(cx + 44 * math.cos(a), cy + 44 * math.sin(a)), (cx + 56 * math.cos(a), cy + 56 * math.sin(a))])
    eye = cv.circle_mask(cx, cy, 15)
    cv.gradient_fill(eye, hexc('#10142c'), hexc('#02030a'), 90)
    cv.emissive(cv.circle_mask(cx, cy, 8 + 3 * charge), scale_c(AMB, 0.45 + 0.55 * charge), 10 + 8 * charge, 0.5 + 0.5 * charge, AMB_W if charge > 0.3 else None)
    cv.specular(cx - 16, cy - 24, 14, 3, -0.7, 0.6)
    if fire:
        for sy in (-1, 1):
            f = cv.circle_mask(cx + 112 + kick, cy + sy * 20, 18)
            cv.emissive(f, AMB, 22, 1.0, AMB_W)
    return cv.out()

def make_turret_head():
    save_sheet([turret_head_frame(i) for i in range(6)], 'turret_head.png')

# =========================================================================================== projectiles
def orb_frame(i, S, col, col_w, col_d, n=4):
    cv = Cv(S, S); cx = cy = S / 2
    pulse = 0.5 + 0.5 * math.sin(i / n * 2 * math.pi)
    r = S * (0.22 + 0.025 * pulse)
    cv.glow(cv.circle_mask(cx, cy, r * 1.15), col, S * 0.075, 0.95)
    cv.paint(cv.circle_mask(cx, cy, r * 1.12), col_d)
    sph = cv.circle_mask(cx, cy, r)
    cv.gradient_fill(sph, col, col_d, 60)
    inner = cv.circle_mask(cx - r * 0.12, cy - r * 0.12, r * 0.62)
    cv.paint(inner.filter(ImageFilter.GaussianBlur(r * 0.12 * cv.ss)), col_w, 0.95)
    cv.paint(cv.circle_mask(cx - r * 0.18, cy - r * 0.2, r * 0.28), WHITE, 0.95)
    cv.rim(sph, col_w, 1.5 * S / 96, 0.7)
    return cv.out()

def make_orbs():
    save_sheet([orb_frame(i, 96, MAG, MAG_W, MAG_D) for i in range(4)], 'orb_mag.png')
    save_sheet([orb_frame(i, 96, AMB, AMB_W, AMB_D) for i in range(4)], 'orb_amb.png')
    save_sheet([orb_frame(i, 192, MAG, MAG_W, MAG_D) for i in range(4)], 'bigorb.png')

def make_bolt():
    W, H = 160, 64; cy = 32
    cv = Cv(W, H)
    # tail fades toward -x; head bright at the right. Glow radii are kept small so nothing is clipped by the sprite bounds.
    tail = cv.poly_mask([(10, cy), (120, cy - 5), (150, cy), (120, cy + 5)]).filter(ImageFilter.GaussianBlur(2.2 * cv.ss))
    cv.glow(tail, CYAN, 6, 1.0)
    grad = grad_img(cv.size, (51, 230, 255, 0), (51, 230, 255, 255), 0)
    cv.paint(tail, grad)
    core = cv.poly_mask([(40, cy), (126, cy - 2.8), (148, cy), (126, cy + 2.8)]).filter(ImageFilter.GaussianBlur(0.8 * cv.ss))
    cv.paint(core, grad_img(cv.size, (216, 251, 255, 0), (255, 255, 255, 255), 0))
    head = cv.circle_mask(140, cy, 6.5)
    cv.emissive(head, CYAN_W, 7, 0.9, WHITE)
    cv.save('bolt.png')

# =========================================================================================== glows (256), rings (512), beams, aim
def make_glows():
    for name, col, hot in [('glow', (255, 255, 255, 255), None), ('glow_cyan', CYAN, CYAN_W), ('glow_mag', MAG, MAG_W), ('glow_amb', AMB, AMB_W), ('glow_wht', (255, 255, 255, 255), None)]:
        g = glow_sprite(256, col, 2.2)
        if hot:
            core = glow_sprite(256, hot, 3.5, 0.9, 0.5)
            g = Image.alpha_composite(g, core)
        g.save(os.path.join(ART, name + '.png'))
    glow_sprite(64, (255, 255, 255, 255), 1.6).save(os.path.join(ART, 'dot.png'))

def make_rings():
    for name, col, hot in [('ring_cyan', CYAN, CYAN_W), ('ring_amb', AMB, AMB_W), ('ring_mag', MAG, MAG_W)]:
        S = 512; cv = Cv(S, S)
        m = cv.ring_mask(S / 2, S / 2, S * 0.43, 9)
        cv.glow(m, col, 22, 1.0)
        cv.glow(m, col, 8, 0.8)
        cv.paint(m, col)
        cv.paint(cv.ring_mask(S / 2, S / 2, S * 0.43, 3.6), hot)
        cv.save(name + '.png')
    # soft full-arena edge glow (display 1000 px: radius 470)
    S = 1024; cv = Cv(S, S, 2)
    m = cv.ring_mask(S / 2, S / 2, 470 * 1.024, 6)
    cv.glow(m, CYAN, 26, 1.0); cv.glow(m, CYAN, 8, 0.8); cv.paint(m, CYAN, 0.9)
    cv.save('arena_glow.png')

def make_beams():
    W, H = 256, 96
    for name, col, hot in [('beam_mag', MAG, MAG_W), ('beam_cyan', CYAN, CYAN_W)]:
        cv = Cv(W, H)
        band = cv.rrect_mask((0, 36, W, 60), 0)
        cv.glow(band, col, 18, 1.0)
        cv.paint(cv.rrect_mask((0, 30, W, 66), 0).filter(ImageFilter.GaussianBlur(6 * cv.ss)), col, 0.9)
        cv.paint(cv.rrect_mask((0, 42, W, 54), 0).filter(ImageFilter.GaussianBlur(2 * cv.ss)), hot)
        cv.paint(cv.rrect_mask((0, 45, W, 51), 0), WHITE)
        cv.save(name + '.png')
    # telegraph aim line: dashes fading with distance
    cv = Cv(256, 16)
    for k in range(16):
        x = k * 16
        cv.paint(cv.rrect_mask((x, 6, x + 9, 10), 1.5), AMB, max(0.15, 1 - k / 16))
    cv.save('aim.png')

def make_crosshair():
    S = 96; cv = Cv(S, S); c = S / 2
    for k in range(4):
        a = math.radians(90 * k + 45)
        seg = cv.line_mask([(c + 24 * math.cos(a - 0.45), c + 24 * math.sin(a - 0.45)), (c + 24 * math.cos(a + 0.45), c + 24 * math.sin(a + 0.45))], 3.2, False)
        for t in range(1, 8):
            pass
    ring = cv.ring_mask(c, c, 26, 3)
    # four arcs: ring with gaps at the axes
    gaps, d = cv.new_mask()
    for k in range(4):
        a = math.radians(90 * k)
        d.line(cv.P([(c + 16 * math.cos(a), c + 16 * math.sin(a)), (c + 40 * math.cos(a), c + 40 * math.sin(a))]), fill=255, width=int(11 * cv.ss))
    ring = ImageChops.subtract(ring, gaps)
    cv.glow(ring, CYAN, 4, 0.8); cv.paint(ring, CYAN_W)
    for k in range(4):
        a = math.radians(90 * k)
        cv.emissive(cv.line_mask([(c + 32 * math.cos(a), c + 32 * math.sin(a)), (c + 42 * math.cos(a), c + 42 * math.sin(a))], 3), CYAN, 3, 0.7, WHITE)
    cv.emissive(cv.circle_mask(c, c, 2.4), CYAN_W, 3, 0.7, WHITE)
    cv.save('crosshair.png')

# =========================================================================================== effects sheets
def make_muzzle():     # 4 frames of 128x96, flash points right from the left edge (anchor X=0, Y=0.5)
    frames = []
    for i in range(4):
        W, H = 128, 96; cv = Cv(W, H)
        k = [1.0, 0.85, 0.55, 0.3][i]; L = 110 * k; hw = 26 * k
        cone = cv.poly_mask([(4, H / 2), (L * 0.35, H / 2 - hw), (L, H / 2 - 4), (L * 1.02, H / 2), (L, H / 2 + 4), (L * 0.35, H / 2 + hw)]).filter(ImageFilter.GaussianBlur(1.2 * cv.ss))
        cv.glow(cone, CYAN, 12, 1.0); cv.paint(cone, CYAN)
        star = cv.poly_mask([(4, H / 2), (L * 0.5, H / 2 - 8 * k), (L * 0.95, H / 2), (L * 0.5, H / 2 + 8 * k)]).filter(ImageFilter.GaussianBlur(0.8 * cv.ss))
        cv.paint(star, WHITE)
        cv.emissive(cv.circle_mask(12, H / 2, 12 * k), CYAN_W, 12, 0.9, WHITE)
        frames.append(cv.out())
    save_sheet(frames, 'muzzle.png')

def make_sparks():     # 6 frames of 128x128, starburst; amber (enemy hits) and cyan (wall/shield hits)
    for name, col, hot in [('spark_amb', AMB, AMB_W), ('spark_cyan', CYAN, CYAN_W)]:
        rng = random.Random(11); lines = [(rng.uniform(0, 2 * math.pi), rng.uniform(0.6, 1.0), rng.choice([2.0, 2.6, 3.2])) for _ in range(11)]
        frames = []
        for i in range(6):
            S = 128; cv = Cv(S, S); c = S / 2; t = i / 5
            for ang, ln, wd in lines:
                r0 = 6 + t * 40 * ln; r1 = r0 + (30 * (1 - t) + 6) * ln
                m = cv.line_mask([(c + r0 * math.cos(ang), c + r0 * math.sin(ang)), (c + r1 * math.cos(ang), c + r1 * math.sin(ang))], wd * (1 - t * 0.6))
                cv.glow(m, col, 3, 0.8); cv.paint(m, col, 1 - t * 0.5); cv.paint(m.filter(ImageFilter.MinFilter(3)), hot, 1 - t * 0.6)
            fl = max(0, 1 - t * 1.6)
            if fl > 0:
                cv.emissive(cv.circle_mask(c, c, 7 + 14 * (1 - fl)), hot, 14, fl, WHITE)
            frames.append(cv.out())
        save_sheet(frames, name + '.png')

def heat(t):   # 0 = white-hot ... 1 = deep red
    stops = [(0.0, (255, 250, 230, 255)), (0.25, (255, 214, 110, 255)), (0.55, (255, 120, 30, 255)), (0.8, (214, 40, 40, 255)), (1.0, (90, 10, 40, 255))]
    t = max(0, min(1, t))
    for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
        if t <= t1: return mix(c0, c1, (t - t0) / (t1 - t0))
    return stops[-1][1]

def explosion_frame(i, S, seed, n=16, blobs=11):
    t = i / (n - 1); cv = Cv(S, S, 2 if S > 300 else 3); c = S / 2
    rng = random.Random(seed)
    R = S * (0.12 + 0.36 * (1 - (1 - t) ** 2.2))
    fade = max(0.0, 1 - t ** 1.6)
    # shock ring early
    if t < 0.55:
        rr = S * (0.1 + 0.4 * t / 0.55); a = (1 - t / 0.55) ** 1.5
        cv.paint(cv.ring_mask(c, c, rr, S * 0.012), (255, 240, 200, 255), a * 0.8)
    for b in range(blobs):
        ang = rng.uniform(0, 2 * math.pi); dist = rng.uniform(0.0, 0.62) * R * (0.4 + 0.6 * t); rad = rng.uniform(0.32, 0.55) * R
        local_t = min(1, t * 1.15 + rng.uniform(-0.12, 0.12) + dist / (R * 3))
        m = cv.circle_mask(c + dist * math.cos(ang), c + dist * math.sin(ang), rad).filter(ImageFilter.GaussianBlur(rad * 0.26 * cv.ss))
        cv.paint(m, heat(local_t), min(1, 0.95 * fade + 0.05))
    core_r = R * 0.55 * max(0, 1 - t * 1.7)
    if core_r > 1:
        cv.paint(cv.circle_mask(c, c, core_r).filter(ImageFilter.GaussianBlur(core_r * 0.4 * cv.ss)), (255, 255, 245, 255), 0.95)
    # embers
    for e in range(14):
        ang = rng.uniform(0, 2 * math.pi); sp = rng.uniform(0.5, 1.0); d = R * (0.7 + 1.1 * sp * t)
        if d < S * 0.47:
            m = cv.circle_mask(c + d * math.cos(ang), c + d * math.sin(ang), max(0.6, S * 0.008 * (1 - t)))
            cv.paint(m, heat(0.15 + t * 0.4), max(0, 1 - t * 1.1))
    return cv.out()

def make_explosions():
    save_sheet([explosion_frame(i, 256, 5) for i in range(16)], 'explosion.png', 4)
    save_sheet([explosion_frame(i, 512, 9, blobs=15) for i in range(16)], 'explosion_big.png', 4)

def make_smoke():
    S = 128; cv = Cv(S, S); rng = random.Random(3); c = S / 2
    for k in range(9):
        a = rng.uniform(0, 2 * math.pi); d = rng.uniform(0, 22); r = rng.uniform(18, 30)
        m = cv.circle_mask(c + d * math.cos(a), c + d * math.sin(a), r).filter(ImageFilter.GaussianBlur(9 * cv.ss))
        cv.paint(m, (235, 238, 250, 255), 0.55)
    fall = radial_mask(S * cv.ss, lambda r: 255 * max(0, 1 - r) ** 0.8)
    a = ImageChops.multiply(cv.img.getchannel('A'), fall); cv.img.putalpha(a)
    cv.save('smoke.png')

def make_shard():
    S = 64; cv = Cv(S, S)
    pts = [(10, 36), (30, 10), (52, 24), (40, 52), (18, 50)]
    m = cv.poly_mask(pts)
    body(cv, m, hexc('#c9d4f5'), hexc('#6a78ad'), 60, 0.5, 4, 0.9, None)
    cv.save('shard.png')

# =========================================================================================== the Warden
def boss_head_frame(i):
    S = 384; cx, cy = 168, 192
    cv = Cv(S, S, 2)
    dmg = [0, 0, 1, 2][i]; snarl = i == 1
    # mandibles
    for sy in (-1, 1):
        open_ = 26 if snarl else 8
        mand = [(cx + 20, cy + sy * 46), (cx + 120, cy + sy * (62 + open_)), (cx + 176, cy + sy * (30 + open_ * 1.3)), (cx + 130, cy + sy * (44 + open_ * 0.8)), (cx + 52, cy + sy * 28)]
        m = cv.poly_mask(mand)
        cv.shadow(m, (3, 6), 7, 0.5)
        body(cv, m, HULL2, HULL0, 70 if sy < 0 else 110, 0.9, 6, 0.8, AMB, 0.9)
        cv.emissive(cv.line_mask([(cx + 130, cy + sy * (44 + open_ * 0.8)), (cx + 176, cy + sy * (30 + open_ * 1.3))], 2), AMB, 6, 0.8, AMB_W)
    # side horns
    for sy in (-1, 1):
        horn = [(cx - 60, cy + sy * 70), (cx - 150, cy + sy * 120), (cx - 130, cy + sy * 70), (cx - 90, cy + sy * 40)]
        m = cv.poly_mask(horn)
        body(cv, m, HULL1, HULL0, 90, 0.9, 5, 0.7, AMB, 0.8)
    # main skull plate
    skull = [(cx + 150, cy), (cx + 100, cy - 40), (cx + 30, cy - 78), (cx - 50, cy - 84), (cx - 110, cy - 50), (cx - 120, cy), (cx - 110, cy + 50), (cx - 50, cy + 84), (cx + 30, cy + 78), (cx + 100, cy + 40)]
    m = cv.poly_mask(skull)
    cv.shadow(m, (4, 8), 10, 0.55)
    body(cv, m, HULL_HI, HULL0, 70, 1.0, 12, 0.9, AMB, 0.9)
    # plating seams
    for pts in ([(cx + 140, cy - 8), (cx + 40, cy - 30), (cx - 20, cy - 70)], [(cx + 140, cy + 8), (cx + 40, cy + 30), (cx - 20, cy + 70)], [(cx - 30, cy - 84), (cx - 40, cy + 84)],
                [(cx + 40, cy - 30), (cx + 40, cy + 30)]):
        panel_line(cv, pts, 2.0)
    # brow ridge + eyes
    for sy in (-1, 1):
        brow = cv.poly_mask([(cx + 118, cy + sy * 10), (cx + 30, cy + sy * 20), (cx + 8, cy + sy * 44), (cx + 70, cy + sy * 36)])
        body(cv, brow, HULL1, HULL0, 90, 0.8, 4, 0.6, None)
        eye = cv.poly_mask([(cx + 104, cy + sy * 16), (cx + 48, cy + sy * 24), (cx + 30, cy + sy * 38), (cx + 80, cy + sy * 30)])
        cv.emissive(eye, AMB if not snarl else MAG, 10, 0.9, AMB_W if not snarl else MAG_W)
    # forehead core
    cv.paint(cv.circle_mask(cx - 30, cy, 26), (3, 5, 16, 255), 0.9)
    core_col = AMB if dmg < 2 else MAG
    cv.emissive(cv.circle_mask(cx - 30, cy, 15 + (4 if snarl else 0)), core_col, 14, 0.9, AMB_W)
    # mouth glow
    if snarl:
        mg = cv.poly_mask([(cx + 120, cy - 12), (cx + 175, cy), (cx + 120, cy + 12)])
        cv.emissive(mg, MAG, 16, 1.0, MAG_W)
    # damage: cracks that glow
    rng = random.Random(21 + i)
    for k in range(dmg * 4):
        x0, y0 = cx + rng.uniform(-100, 100), cy + rng.uniform(-60, 60)
        pts = [(x0, y0)]
        for s in range(rng.randint(3, 5)): pts.append((pts[-1][0] + rng.uniform(-20, 20), pts[-1][1] + rng.uniform(-20, 20)))
        mk = cv.line_mask(pts, 2.2, False)
        cv.glow(mk, AMB if dmg == 1 else MAG, 4, 0.9); cv.paint(mk, (255, 190, 100, 255) if dmg == 1 else (255, 120, 180, 255), 0.95)
    if dmg == 2:   # a plate blown off the left side
        hole = cv.poly_mask([(cx - 70, cy - 40), (cx - 20, cy - 56), (cx - 10, cy - 20), (cx - 60, cy - 14)])
        cv.paint(hole, (8, 4, 14, 255)); cv.emissive(hole.filter(ImageFilter.MinFilter(9)), MAG, 10, 0.8, MAG_W)
    return cv.out()

def make_boss_head():
    save_sheet([boss_head_frame(i) for i in range(4)], 'boss_head.png')

def boss_segment_frame(i, S=256, tail=False):
    cx = cy = S / 2
    cv = Cv(S, S)
    # side fins (give the segment a heading: +x is forward along the chain)
    for sy in (-1, 1):
        fin = [(cx + 20, cy + sy * 84), (cx - 40, cy + sy * 112), (cx - 56, cy + sy * 90), (cx - 20, cy + sy * 72)]
        if i == 3: fin = [(cx + 10, cy + sy * 84), (cx - 30, cy + sy * 100), (cx - 40, cy + sy * 88)]
        m = cv.poly_mask(fin)
        body(cv, m, HULL1, HULL0, 90, 0.9, 5, 0.6, AMB if i < 3 else None, 0.8)
    # outer armour ring made of 6 plates
    for k in range(6):
        if (i == 1 and k in (1,)) or (i == 2 and k in (0, 1, 5)) or (i == 3 and k in (1, 4)): continue
        a0 = math.radians(60 * k + 4); a1 = math.radians(60 * k + 56)
        outer = [(cx + 100 * math.cos(a0 + (a1 - a0) * j / 8), cy + 100 * math.sin(a0 + (a1 - a0) * j / 8)) for j in range(9)]
        inner = [(cx + 62 * math.cos(a1 - (a1 - a0) * j / 8), cy + 62 * math.sin(a1 - (a1 - a0) * j / 8)) for j in range(9)]
        m = cv.poly_mask(outer + inner)
        base0, base1 = (HULL_HI, HULL0) if i < 3 else (hexc('#39405f'), hexc('#0a0d1c'))
        body(cv, m, base0, base1, 40 + 60 * k, 0.9, 5, 0.8 if i < 3 else 0.3, AMB if i < 3 else None, 0.9)
    # seam glow ring and inner ring
    ringm = cv.ring_mask(cx, cy, 60, 3)
    if i < 3: cv.emissive(ringm, AMB, 7, 0.7 if i == 0 else 1.0, AMB_W if i > 0 else None)
    else: cv.paint(ringm, (20, 18, 28, 255))
    # central dome
    dome = cv.circle_mask(cx, cy, 50)
    body(cv, dome, hexc('#5a6aa0') if i < 3 else hexc('#2a3050'), HULL0, 60, 0.9, 8, 0.8 if i < 3 else 0.3, None)
    cv.paint(cv.ring_mask(cx, cy, 36, 1.6), (3, 5, 16, 255), 0.9)
    if i < 2:
        cv.emissive(cv.circle_mask(cx, cy, 15 if not tail else 22), AMB, 14, 0.85 if i == 0 else 1.0, AMB_W)
        cv.paint(cv.circle_mask(cx, cy, 6), WHITE, 0.9)
    elif i == 2:
        cv.emissive(cv.circle_mask(cx, cy, 30), MAG, 26, 1.0, MAG_W); cv.paint(cv.circle_mask(cx, cy, 12), WHITE)
    else:
        cv.paint(cv.circle_mask(cx, cy, 14), (10, 8, 14, 255)); cv.emissive(cv.circle_mask(cx + 5, cy + 3, 3), hexc('#ff5020'), 5, 0.6)
    # damage
    if i >= 1:
        rng = random.Random(7 + i)
        for k in range(3 + 3 * i):
            x0, y0 = cx + rng.uniform(-80, 80), cy + rng.uniform(-80, 80)
            pts = [(x0, y0)]
            for s in range(3): pts.append((pts[-1][0] + rng.uniform(-16, 16), pts[-1][1] + rng.uniform(-16, 16)))
            mk = cv.line_mask(pts, 1.8, False)
            if i < 3: cv.glow(mk, AMB, 3, 0.8); cv.paint(mk, (255, 200, 110, 255), 0.95)
            else: cv.paint(mk, (6, 6, 12, 255), 0.9)
    return cv.out()

def make_boss_segment():
    save_sheet([boss_segment_frame(i) for i in range(4)], 'boss_seg.png')

def make_boss_tail():
    frames = []
    for i in range(4):
        base = boss_segment_frame(0 if i < 2 else 1, 256, True)
        cv = Cv(256, 256); cv.img = base.resize((256 * SS, 256 * SS), Image.LANCZOS)
        cx = cy = 128; p = 0.5 + 0.5 * math.sin(i / 4 * 2 * math.pi)
        spike = [(cx - 20, cy - 22), (cx - 118, cy), (cx - 20, cy + 22)]
        m = cv.poly_mask(spike); cv.shadow(m, (0, 0), 1, 0)
        body(cv, m, HULL2, HULL0, 90, 0.9, 5, 0.8, AMB, 0.9)
        cv.emissive(cv.circle_mask(cx, cy, 20 + 5 * p), MAG, 22, 0.9, MAG_W); cv.paint(cv.circle_mask(cx, cy, 9), WHITE)
        frames.append(cv.out())
    save_sheet(frames, 'boss_tail.png')

# =========================================================================================== soft shadow, pips, bars
def make_shadow():
    S = 256; cv = Cv(S, S)
    m = cv.circle_mask(S / 2, S / 2, 78).filter(ImageFilter.GaussianBlur(26 * cv.ss))
    cv.paint(m, (0, 0, 8, 255), 0.85)
    cv.save('shadow.png')

def make_pips():       # 2 frames of 96x96: full, empty
    frames = []
    for full in (True, False):
        S = 96; cv = Cv(S, S); c = S / 2
        pts = [(c + 34 * math.cos(math.radians(60 * k + 30)), c + 34 * math.sin(math.radians(60 * k + 30))) for k in range(6)]
        m = cv.poly_mask(pts)
        if full:
            cv.glow(m, CYAN, 8, 0.9); cv.gradient_fill(m, CYAN_W, CYAN_D, 80); cv.bevel(m, WHITE, 1.2, 0.7)
            cv.paint(cv.poly_mask([(c + 18 * math.cos(math.radians(60 * k + 30)), c + 18 * math.sin(math.radians(60 * k + 30))) for k in range(6)]).filter(ImageFilter.GaussianBlur(2 * cv.ss)), WHITE, 0.55)
        else:
            cv.gradient_fill(m, hexc('#1a2140'), hexc('#0a0e22'), 90); cv.outline(m, hexc('#33406e'), 2)
        frames.append(cv.out())
    save_sheet(frames, 'pip.png')

def make_bars():
    W, H = 1600, 48
    cv = Cv(W, H)
    m = cv.rrect_mask((2, 2, W - 2, H - 2), 10)
    cv.gradient_fill(m, hexc('#0d1330'), hexc('#05081a'), 90); cv.outline(m, hexc('#3a4a86'), 2); cv.bevel(m, WHITE, 1, 0.3)
    cv.save('bar_frame.png')
    for name, c0, c1 in [('bar_fill', hexc('#ffd46a'), hexc('#ff2e88')), ('bar_chip', hexc('#ffffff'), hexc('#ffb0cc'))]:
        cv = Cv(W, H); m = cv.rrect_mask((6, 6, W - 6, H - 6), 6)
        cv.gradient_fill(m, c0, c1, 0)
        cv.paint(cv.rrect_mask((6, 8, W - 6, 20), 4), WHITE, 0.22)
        for x in range(30, W - 20, 40): cv.paint(cv.line_mask([(x, 8), (x, H - 8)], 1.2, False), (0, 0, 0, 255), 0.18)
        cv.save(name + '.png')
    cv = Cv(256, 24); m = cv.rrect_mask((2, 2, 254, 22), 6); cv.gradient_fill(m, CYAN_W, CYAN, 0); cv.paint(cv.rrect_mask((4, 4, 252, 10), 3), WHITE, 0.3); cv.save('dash_fill.png')

# =========================================================================================== logo (stroke-built letters)
LETTERS = {
    'N': [[(0, 1.4), (0, 0), (1, 1.4), (1, 0)]], 'E': [[(1, 0), (0, 0), (0, 1.4), (1, 1.4)], [(0, 0.7), (0.78, 0.7)]],
    'O': [[(0.18, 0), (0.82, 0), (1, 0.2), (1, 1.2), (0.82, 1.4), (0.18, 1.4), (0, 1.2), (0, 0.2), (0.18, 0)]],
    'W': [[(0, 0), (0.25, 1.4), (0.5, 0.5), (0.75, 1.4), (1, 0)]], 'A': [[(0, 1.4), (0.5, 0), (1, 1.4)], [(0.2, 0.98), (0.8, 0.98)]],
    'R': [[(0, 1.4), (0, 0), (0.8, 0), (1, 0.2), (1, 0.5), (0.8, 0.7), (0, 0.7)], [(0.5, 0.7), (1, 1.4)]],
    'D': [[(0, 0), (0.7, 0), (1, 0.3), (1, 1.1), (0.7, 1.4), (0, 1.4), (0, 0)]],
}
def draw_word(cv, word, x0, y0, size, gap, stroke, col, hot):
    x = x0
    for ch in word:
        for poly in LETTERS[ch]:
            pts = [(x + px * size * 0.72, y0 + py * size) for px, py in poly]
            m = cv.line_mask(pts, stroke)
            cv.glow(m, col, stroke * 2.2, 0.9)
            cv.paint(m, col)
            cv.paint(cv.line_mask(pts, stroke * 0.42), hot)
        x += size * 0.72 + gap
    return x

def make_logo():
    W, H = 1700, 560
    cv = Cv(W, H, 2)
    s1, g1, st1 = 150, 52, 20
    w1 = 4 * (s1 * 0.72) + 3 * g1
    draw_word(cv, 'NEON', (W - w1) / 2, 50, s1, g1, st1, CYAN, CYAN_W)
    s2, g2, st2 = 110, 40, 15
    w2 = 6 * (s2 * 0.72) + 5 * g2
    draw_word(cv, 'WARDEN', (W - w2) / 2, 340, s2, g2, st2, MAG, MAG_W)
    for y, col in ((286, AMB), (294, AMB)):
        cv.paint(cv.line_mask([(W / 2 - 520, y), (W / 2 + 520, y)], 2.4, False), col, 0.9)
    cv.save('logo.png')

# =========================================================================================== arena floor (jpg) and background
def make_floor():
    import math as m
    W, H = 2560, 1440; k = W / 1920
    cx, cy = W / 2, H / 2; R = 470 * k
    rng = random.Random(2)
    base = grad_img((W, H), hexc('#0b1129'), hexc('#05071a'), 60).convert('RGB')
    d = ImageDraw.Draw(base)
    # hex plating over the whole floor
    hr = 36 * k * 0.75
    hw = hr * m.sqrt(3); vstep = hr * 1.5
    row = 0; y = -hr
    lines_dark, lines_light = [], []
    while y < H + hr:
        x = -hw + (hw / 2 if row % 2 else 0)
        while x < W + hw:
            pts = [(x + hr * m.cos(m.radians(60 * i + 30)), y + hr * m.sin(m.radians(60 * i + 30))) for i in range(6)]
            lines_dark.append(pts)
            x += hw
        y += vstep; row += 1
    tile = Image.new('L', (W, H), 0); td = ImageDraw.Draw(tile)
    for idx, pts in enumerate(lines_dark):
        shade = 8 + (idx * 37 % 17)
        td.polygon(pts, fill=shade)
    base = ImageChops.add(base, Image.merge('RGB', (tile.point(lambda v: int(v * 0.8)), tile.point(lambda v: int(v * 0.95)), tile)))
    d = ImageDraw.Draw(base)
    for pts in lines_dark:
        d.line(pts + [pts[0]], fill=(3, 5, 16), width=3)
    hi = Image.new('RGB', (W, H), (0, 0, 0)); hd = ImageDraw.Draw(hi)
    for pts in lines_dark:
        hd.line([(x - 1.5, y - 1.5) for x, y in pts[3:6]], fill=(34, 46, 88), width=2)
    base = ImageChops.add(base, hi)
    # circuit traces (outside and inside), faint cyan with glow
    tr = Image.new('L', (W, H), 0); td = ImageDraw.Draw(tr)
    for n in range(46):
        x0, y0 = rng.uniform(0, W), rng.uniform(0, H)
        pts = [(x0, y0)]; horiz = rng.random() < 0.5
        for s in range(rng.randint(3, 6)):
            L = rng.uniform(60, 220)
            x, y = pts[-1]; pts.append((x + (L * rng.choice([-1, 1]) if horiz else 0), y + (0 if horiz else L * rng.choice([-1, 1])))); horiz = not horiz
        td.line(pts, fill=150, width=3, joint='curve')
        for p in (pts[0], pts[-1]): td.ellipse([p[0] - 6, p[1] - 6, p[0] + 6, p[1] + 6], fill=220)
    glow = tr.filter(ImageFilter.GaussianBlur(7))
    trace = ImageChops.add(tr.point(lambda v: int(v * 0.35)), glow.point(lambda v: int(v * 0.8)))
    base = ImageChops.add(base, Image.merge('RGB', (trace.point(lambda v: int(v * 0.12)), trace.point(lambda v: int(v * 0.5)), trace.point(lambda v: int(v * 0.8)))))
    # outside the arena: darken + big machinery blocks
    ss = 2
    mask = Image.new('L', (W * ss // 2, H * ss // 2), 0)
    md = ImageDraw.Draw(mask); sc = ss / 2
    md.ellipse([(cx - R) * sc, (cy - R) * sc, (cx + R) * sc, (cy + R) * sc], fill=255)
    mask = mask.resize((W, H), Image.LANCZOS)
    dark = Image.new('RGB', (W, H), (2, 3, 12))
    outside = ImageChops.invert(mask)
    base = Image.composite(Image.blend(base, dark, 0.55), base, outside)
    # inner floor glow toward the middle
    inner = radial_mask(int(2 * R), lambda r: 60 * max(0, 1 - r) ** 1.6).resize((int(2 * R), int(2 * R)))
    glowimg = Image.new('RGB', (int(2 * R), int(2 * R)), (20, 60, 110))
    base.paste(ImageChops.add(base.crop((int(cx - R), int(cy - R), int(cx + R), int(cy + R))), Image.composite(glowimg, Image.new('RGB', glowimg.size, 0), inner)), (int(cx - R), int(cy - R)))
    # rim: build supersampled ring art
    rs = 2; RW = int(2 * (R + 120)); ring = Cv(RW // 1, RW // 1, rs) if False else None
    rim = Image.new('RGBA', (int((R + 130) * 2 * rs), int((R + 130) * 2 * rs)), (0, 0, 0, 0)); rd = ImageDraw.Draw(rim); c0 = rim.size[0] / 2
    def ringm(r, w):
        mm = Image.new('L', rim.size, 0); dd = ImageDraw.Draw(mm)
        dd.ellipse([c0 - (r + w / 2) * rs, c0 - (r + w / 2) * rs, c0 + (r + w / 2) * rs, c0 + (r + w / 2) * rs], fill=255)
        dd.ellipse([c0 - (r - w / 2) * rs, c0 - (r - w / 2) * rs, c0 + (r - w / 2) * rs, c0 + (r - w / 2) * rs], fill=0)
        return mm
    def put(mm, col, a=1.0):
        layer = Image.new('RGBA', rim.size, col); layer.putalpha(mm.point(lambda v: int(v * a)))
        return layer
    # shadow of the rim wall onto the outside, then wall, then bevels and lights
    sh = ringm(R + 30, 80).filter(ImageFilter.GaussianBlur(26 * rs))
    rim = Image.alpha_composite(rim, put(sh, (0, 0, 6, 255), 0.85))
    wall = ringm(R + 28, 56)
    wallimg = Image.alpha_composite(rim, put(wall, (38, 48, 88, 255)))
    rim = wallimg
    rim = Image.alpha_composite(rim, put(ImageChops.subtract(wall, ImageChops.offset(wall, 5 * rs, 5 * rs)).filter(ImageFilter.GaussianBlur(2 * rs)), (170, 190, 240, 255), 0.5))
    rim = Image.alpha_composite(rim, put(ringm(R + 6, 10), (4, 6, 20, 255), 0.95))
    glow_ring = ringm(R - 2, 5)
    rim = Image.alpha_composite(rim, put(glow_ring.filter(ImageFilter.GaussianBlur(22 * rs)), (51, 230, 255, 255), 1.0))
    rim = Image.alpha_composite(rim, put(glow_ring.filter(ImageFilter.GaussianBlur(7 * rs)), (51, 230, 255, 255), 0.9))
    rim = Image.alpha_composite(rim, put(glow_ring, (51, 230, 255, 255), 1.0))
    rim = Image.alpha_composite(rim, put(ringm(R - 2, 1.8), (230, 253, 255, 255), 1.0))
    # amber hazard dashes on the wall
    dm = Image.new('L', rim.size, 0); dd = ImageDraw.Draw(dm)
    for kd in range(72):
        a0 = m.radians(kd * 5); a1 = a0 + m.radians(2.2)
        pts = [(c0 + (R + 12) * rs * m.cos(a), c0 + (R + 12) * rs * m.sin(a)) for a in (a0, a1)] + [(c0 + (R + 44) * rs * m.cos(a), c0 + (R + 44) * rs * m.sin(a)) for a in (a1, a0)]
        dd.polygon(pts, fill=255)
    rim = Image.alpha_composite(rim, put(dm, (255, 176, 46, 255), 0.55))
    rim = rim.resize((rim.size[0] // rs, rim.size[1] // rs), Image.LANCZOS)
    b = base.convert('RGBA'); b.alpha_composite(rim, (int(cx - rim.size[0] / 2), int(cy - rim.size[1] / 2)))
    # turret bays
    bayl = Image.new('RGBA', (W * 2, H * 2), (0, 0, 0, 0))
    for ang in (45, 135, 225, 315):
        bx, by = cx + 350 * k * m.cos(m.radians(ang)), cy + 350 * k * m.sin(m.radians(ang))
        s = int(110 * k)
        bay = Image.new('RGBA', (s * 2 * 3, s * 2 * 3), (0, 0, 0, 0)); bd = ImageDraw.Draw(bay); bc = s * 3
        bd.ellipse([bc - 80 * k * 3 * 0.9, bc - 80 * k * 3 * 0.9, bc + 80 * k * 3 * 0.9, bc + 80 * k * 3 * 0.9], fill=(2, 3, 12, 255))
        bd.ellipse([bc - 92 * k * 3 * 0.9, bc - 92 * k * 3 * 0.9, bc + 92 * k * 3 * 0.9, bc + 92 * k * 3 * 0.9], outline=(255, 176, 46, 200), width=int(4 * 3))
        bay = bay.filter(ImageFilter.GaussianBlur(1)).resize((s * 2, s * 2), Image.LANCZOS)
        halo = Image.new('RGBA', bay.size, (255, 176, 46, 0)); hm = Image.new('L', bay.size, 0)
        ImageDraw.Draw(hm).ellipse([s - 86 * k * 0.9, s - 86 * k * 0.9, s + 86 * k * 0.9, s + 86 * k * 0.9], outline=120, width=3)
        halo.putalpha(hm.filter(ImageFilter.GaussianBlur(10)))
        b.alpha_composite(halo, (int(bx - s), int(by - s))); b.alpha_composite(bay, (int(bx - s), int(by - s)))
    # centre emblem: concentric thin rings
    em = Image.new('L', (W, H), 0); ed = ImageDraw.Draw(em)
    for r, w, a in ((90, 3, 110), (150, 2, 70), (210, 2, 50)):
        ed.ellipse([cx - r * k, cy - r * k, cx + r * k, cy + r * k], outline=a, width=w)
    for kk in range(12):
        a = m.radians(30 * kk); ed.line([(cx + 70 * k * m.cos(a), cy + 70 * k * m.sin(a)), (cx + 100 * k * m.cos(a), cy + 100 * k * m.sin(a))], fill=100, width=3)
    eg = em.filter(ImageFilter.GaussianBlur(4))
    emc = Image.merge('RGBA', (Image.new('L', (W, H), 40), Image.new('L', (W, H), 180), Image.new('L', (W, H), 255), ImageChops.add(em.point(lambda v: int(v * 0.6)), eg.point(lambda v: int(v * 0.9)))))
    b.alpha_composite(emc)
    # grain + baked vignette
    noise = Image.effect_noise((W, H), 14).convert('L').point(lambda v: int(abs(v - 128) * 0.45))
    b = Image.alpha_composite(b, Image.merge('RGBA', (noise, noise, noise, noise.point(lambda v: v // 2))))
    vg = radial_mask(1440, lambda r: 255 * min(1, max(0, (r - 0.55) / 0.9) ** 1.5) * 0.85).resize((W, int(H * 1.0)))
    vgl = Image.new('RGBA', (W, H), (2, 3, 10, 0)); vgl.putalpha(vg.resize((W, H)).crop((0, 0, W, H)))
    b = Image.alpha_composite(b, vgl)
    b.convert('RGB').save(os.path.join(ART, 'floor.jpg'), quality=90)

if __name__ == '__main__':
    want = sys.argv[1:]
    for name, fn in [(n[5:], f) for n, f in sorted(globals().items()) if n.startswith('make_') and callable(f)]:
        if not want or name in want:
            print('drawing', name, flush=True); fn()
