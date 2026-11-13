#!/usr/bin/env python3
"""Generates Piston's brand artwork. Pillow only:  python3 Tools/branding/make_icon.py   (run from the repo root)

Writes
  Resources/Piston.iconset/*.png, Resources/Piston.icns (needs macOS `iconutil`), Resources/Piston-1024.png
  Resources/branding/piston-mark-{white,orange}.{svg,png}   the bare mark, transparent background, for in-app and web use
  Resources/branding/piston-icon.svg                         the app icon as a vector

The mark is a piston tilted 38 degrees clockwise: an orange cylinder (a U, open at the top) with a rod and cap, and a cream head
inside it. Geometry is defined upright in a 1024 frame (below) and rotated about (512, 512). The SwiftUI PistonMark and PistonHead
(Sources/Piston/Branding.swift) and the web splash (Engine/web/MadeWithPiston.js) repeat the same numbers, so change all three together.
"""
import os, subprocess, shutil, sys
from PIL import ImageChops, Image, ImageDraw, ImageFilter

BRAND = (0xFF, 0x5A, 0x1F)      # Piston orange  #FF5A1F
CREAM = (0xFF, 0xF4, 0xD6)      # the piston head  #FFF4D6
INK = (0x0E, 0x10, 0x14)        # splash / dark background
TILE_TOP, TILE_BOTTOM = (0x23, 0x27, 0x30), (0x0B, 0x0D, 0x11)   # the app icon tile
WHITE = (255, 255, 255)

# Upright geometry, 1024 frame. The cylinder is a U: outer box 290..734 x 400..820 (bottom corners r93), inner cut 350..674 down to 760 (r68).
U_PATH = ("M290 400H350V692A68 68 0 0 0 418 760H606A68 68 0 0 0 674 692V400H734V727A93 93 0 0 1 641 820H383A93 93 0 0 1 290 727Z")
ROD = (484, 150, 540, 530, 0)           # x0, y0, x1, y1, radius
CAP = (392, 150, 632, 230, 40)
HEAD = (392, 520, 632, 640, 22)
TILT = 38                                # degrees clockwise
# Bounds of the tilted glyph in the 1024 frame (x0, y0, x1, y1); measured by bounds() below, repeated in Branding.swift and MadeWithPiston.js.
MARK_BOX = (182, 167, 816, 857)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RES = os.path.join(ROOT, "Resources")
SS = 3
N = 1024


def hexs(c): return "#%02X%02X%02X" % c


def _layer(): return Image.new("L", (N * SS, N * SS), 0)


def _rr(d, box, r, fill=255):
    d.rounded_rectangle([v * SS for v in box], radius=r * SS, fill=fill)


def _down(m): return m.resize((N, N), Image.LANCZOS)


def body_mask():
    """The cylinder, rod and cap, upright, as an N x N mask."""
    m = _layer(); d = ImageDraw.Draw(m)
    _rr(d, (290, 200, 734, 820), 93); _rr(d, (350, 140, 674, 760), 68, 0)
    d.rectangle([290 * SS, 100 * SS, 734 * SS, 400 * SS], fill=0)          # open top
    _rr(d, ROD[:4], 0); _rr(d, CAP[:4], CAP[4])
    return _down(m)


def head_mask():
    m = _layer(); _rr(ImageDraw.Draw(m), HEAD[:4], HEAD[4]); return _down(m)


def tilt(m): return m.rotate(-TILT, resample=Image.BICUBIC, center=(N / 2, N / 2))


def bounds():
    """Bounding box of the tilted glyph in the 1024 frame (used to fill MARK_BOX)."""
    return ImageChops.lighter(tilt(body_mask()), tilt(head_mask())).getbbox()


def fit(masks, box):
    """Scale and place the tilted masks so the glyph fits inside `box` (x0,y0,x1,y1) of an N x N canvas, centred."""
    bx0, by0, bx1, by1 = MARK_BOX
    k = min((box[2] - box[0]) / (bx1 - bx0), (box[3] - box[1]) / (by1 - by0))
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    tx, ty = (box[0] + box[2]) / 2 - k * cx, (box[1] + box[3]) / 2 - k * cy
    out = []
    for m in masks:
        r = m.resize((round(N * k), round(N * k)), Image.LANCZOS)
        c = Image.new("L", (N, N), 0)
        c.paste(r, (round(tx), round(ty)))
        out.append(c)
    return out


def mark_svg_body(body, head):
    def rect(s):
        x0, y0, x1, y1, r = s
        return f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" rx="{r}"/>'
    return (f'<g transform="rotate({TILT} 512 512)"><g fill="{hexs(body)}"><path d="{U_PATH}"/>{rect(ROD)}{rect(CAP)}</g>'
            f'<g fill="{hexs(head)}">{rect(HEAD)}</g></g>')


def view_box(): return f"{MARK_BOX[0]} {MARK_BOX[1]} {MARK_BOX[2] - MARK_BOX[0]} {MARK_BOX[3] - MARK_BOX[1]}"


def mark_png(size, body, head):
    body_m, head_m = fit([tilt(body_mask()), tilt(head_mask())], (0, 0, N, N))
    out = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    for m, col in ((body_m, body), (head_m, head)):
        layer = Image.new("RGBA", (N, N), col + (0,)); layer.putalpha(m); out = Image.alpha_composite(out, layer)
    return out.resize((size, size), Image.LANCZOS)


def icon_png(size):
    """The macOS app icon: a dark rounded tile (824/1024 of the canvas, like Apple's grid) with the tilted piston: orange cylinder and rod, glowing cream head."""
    S = N
    tile = (100, 100, 924, 924)
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([tile[0], tile[1] + 12, tile[2], tile[3] + 12], radius=188, fill=(0, 0, 0, 105))
    canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(16)))
    ss = 4
    tmask = Image.new("L", (S * ss, S * ss), 0)
    ImageDraw.Draw(tmask).rounded_rectangle([v * ss for v in tile], radius=188 * ss, fill=255)
    tmask = tmask.resize((S, S), Image.LANCZOS)
    t = Image.new("RGBA", (S, S), TILE_BOTTOM + (255,))
    top = Image.new("RGBA", (S, S), TILE_TOP + (255,))
    t = Image.composite(top, t, Image.linear_gradient("L").rotate(180).resize((S, S)))
    t.putalpha(tmask)
    canvas = Image.alpha_composite(canvas, t)
    body_m, head_m = fit([tilt(body_mask()), tilt(head_mask())], (202, 202, 822, 822))
    glow = Image.new("RGBA", (S, S), BRAND + (0,))
    glow.putalpha(ImageChops.darker(body_m.filter(ImageFilter.GaussianBlur(40)).point(lambda v: int(v * 0.5)), tmask))
    canvas = Image.alpha_composite(canvas, glow)
    body = Image.new("RGBA", (S, S), BRAND + (0,)); body.putalpha(body_m)
    canvas = Image.alpha_composite(canvas, body)
    hg = Image.new("RGBA", (S, S), (255, 170, 80, 0)); hg.putalpha(head_m.filter(ImageFilter.GaussianBlur(34)))
    canvas = Image.alpha_composite(canvas, hg)
    head = Image.new("RGBA", (S, S), CREAM + (0,)); head.putalpha(head_m)
    canvas = Image.alpha_composite(canvas, head)
    return canvas if size == S else canvas.resize((size, size), Image.LANCZOS)


def main():
    br = os.path.join(RES, "branding")
    os.makedirs(br, exist_ok=True)
    for name, body, head in (("white", WHITE, WHITE), ("orange", BRAND, CREAM)):
        with open(os.path.join(br, f"piston-mark-{name}.svg"), "w") as f:
            f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box()}">{mark_svg_body(body, head)}</svg>\n')
        mark_png(512, body, head).save(os.path.join(br, f"piston-mark-{name}.png"))
    with open(os.path.join(br, "piston-icon.svg"), "w") as f:
        f.write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">'
                f'<rect x="100" y="100" width="824" height="824" rx="188" fill="{hexs(INK)}"/>'
                f'<svg x="202" y="202" width="620" height="620" viewBox="{view_box()}">'
                f'{mark_svg_body(BRAND, CREAM)}</svg></svg>\n')

    iconset = os.path.join(RES, "Piston.iconset")
    shutil.rmtree(iconset, ignore_errors=True)
    os.makedirs(iconset)
    master = icon_png(1024)
    master.save(os.path.join(RES, "Piston-1024.png"))
    for base in (16, 32, 128, 256, 512):
        for mult in (1, 2):
            px = base * mult
            (master if px == 1024 else icon_png(px)).save(os.path.join(iconset, f"icon_{base}x{base}{'@2x' if mult == 2 else ''}.png"))
    if shutil.which("iconutil"):
        subprocess.check_call(["iconutil", "-c", "icns", iconset, "-o", os.path.join(RES, "Piston.icns")])
    else:
        print("iconutil not found (macOS only): Piston.icns was not regenerated", file=sys.stderr)
    print("branding written to", RES)


if __name__ == "__main__":
    main()
