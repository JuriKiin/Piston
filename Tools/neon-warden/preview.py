#!/usr/bin/env python3
"""Writes contact sheets of the generated art onto a dark background so you can eyeball it: python3 preview.py [outdir]"""
import os, sys
from PIL import Image
from gfx import ART
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
def card(name, cols=None, fw=None, maxw=1500, bg=(10, 14, 34)):
    im = Image.open(os.path.join(ART, name)).convert('RGBA')
    b = Image.new('RGBA', im.size, bg + (255,)); b.alpha_composite(im)
    if b.width > maxw: b = b.resize((maxw, int(b.height * maxw / b.width)), Image.LANCZOS)
    return b
def stack(names, path, maxw=1500):
    cards = [card(n, maxw=maxw) for n in names]
    H = sum(c.height + 6 for c in cards); sheet = Image.new('RGBA', (max(c.width for c in cards), H), (30, 30, 40, 255)); y = 0
    for c in cards: sheet.paste(c, (0, y)); y += c.height + 6
    sheet.convert('RGB').save(path)
stack(['drone.png', 'turret_head.png', 'boss_seg.png', 'boss_head.png', 'boss_tail.png'], os.path.join(out, 'prev_enemies.png'))
stack(['orb_mag.png', 'orb_amb.png', 'bigorb.png', 'muzzle.png', 'spark_amb.png', 'spark_cyan.png', 'bolt.png', 'pip.png'], os.path.join(out, 'prev_small.png'))
stack(['explosion.png', 'explosion_big.png'], os.path.join(out, 'prev_explosions.png'), 1000)
stack(['logo.png', 'ring_cyan.png', 'glow_cyan.png', 'beam_mag.png', 'aim.png', 'crosshair.png', 'turret_base.png', 'smoke.png', 'shard.png', 'bar_frame.png', 'bar_fill.png'], os.path.join(out, 'prev_misc.png'), 700)
Image.open(os.path.join(ART, 'floor.jpg')).resize((1280, 720)).save(os.path.join(out, 'prev_floor.png'))
