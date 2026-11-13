#!/usr/bin/env python3
"""Writes Samples/NeonWarden/scenes/*.json. The scenes are small: scenery sprites, the camera with its PostProcess, and a Director that spawns the fight.
Run: python3 Tools/neon-warden/make_scenes.py"""
import json, os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'Samples', 'NeonWarden', 'scenes')

def ent(key, typ, name, x, y, w=20, h=20, components=None, fields=None):
    e = {'sceneKey': key, 'tag': typ, 'name': name, 'type': typ, 'parentKey': None,
         'transform': {'position': {'x': x, 'y': y}, 'rotation': 0, 'size': {'x': w, 'y': h}}, 'fields': fields or {}}
    if components is not None: e['components'] = components
    return e

def sprite(path, order, blend='normal', opacity=1):
    return {'type': 'SpriteRenderer', 'fields': {'imagePath': path, 'frameWidth': 0, 'frameHeight': 0, 'frameCount': 1, 'columns': 1, 'fps': 0, 'loop': True,
            'anchorX': 0.5, 'anchorY': 0.5, 'opacity': opacity, 'blendMode': blend, 'flash': 0, 'pixelArt': False, 'sortingOrder': order}}

def camera(bloom=0.7):
    return ent('camera', 'MainCamera', 'Camera', 960, 540, components=[
        {'type': 'Camera', 'fields': {'zoom': 1}},
        {'type': 'PostProcess', 'fields': {'bloom': bloom, 'bloomThreshold': 0.62, 'bloomRadius': 3, 'ambient': '#808cbe', 'lightStrength': 0.3, 'exposure': 1.0, 'contrast': 1.06,
            'saturation': 1.12, 'tintColor': '#6a5cff', 'tintAmount': 0.0, 'vignette': 0.45, 'vignetteColor': '#000000', 'chromatic': 0.8, 'flashColor': '#ffffff', 'flashAmount': 0}}])

def pulse_glow():
    return {'type': 'Animator', 'fields': {'clips': [{'name': 'pulse', 'duration': 3.2, 'loop': True, 'tracks': [
        {'path': 'SpriteRenderer.opacity', 'keys': [{'t': 0, 'v': 0.45, 'ease': 'easeInOut'}, {'t': 1.6, 'v': 0.95, 'ease': 'easeInOut'}, {'t': 3.2, 'v': 0.45}]}], 'events': []}],
        'asset': '', 'defaultClip': 'pulse', 'playOnStart': True, 'speed': 1}}

def scene(name, entities):
    return {'version': 3, 'sceneName': name, 'backgroundColor': '#05071a', 'deletedKeys': [], 'entities': entities}

def common():
    return [camera(),
            ent('floor', 'Prop', 'Floor', 960, 540, 1920, 1080, [sprite('./assets/art/floor.jpg', -10)]),
            ent('arena-glow', 'Prop', 'Arena edge glow', 960, 540, 1000, 1000, [sprite('./assets/art/arena_glow.png', -9, 'additive', 0.7), pulse_glow()])]

os.makedirs(ROOT, exist_ok=True)
json.dump(scene('Arena', common() + [ent('director', 'Director', 'Director', 960, 540)]), open(f'{ROOT}/arena.json', 'w'), indent=1)
json.dump(scene('Title', common() + [ent('title-director', 'TitleDirector', 'Title Director', 960, 540)]), open(f'{ROOT}/title.json', 'w'), indent=1)
print('scenes written')
