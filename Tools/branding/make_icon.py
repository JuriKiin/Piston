#!/usr/bin/env python3
"""Generates Piston's brand artwork. Pillow only:  python3 Tools/branding/make_icon.py   (run from the repo root)

Writes
  Resources/Piston.iconset/*.png, Resources/Piston.icns (needs macOS `iconutil`), Resources/Piston-1024.png
  Resources/branding/piston-mark-{white,orange}.{svg,png}   the bare mark, transparent background, for in-app and web use
  Resources/branding/piston-icon.svg                         the app icon as a vector

The mark is one colour plus white: a cylinder (open at the top), a piston head inside it and a rod with a cap.
Geometry lives in MARK below (100 x 100 units). The SwiftUI PistonMark (Sources/Piston/Branding.swift) and the web
splash (Engine/web/static/splash.js) repeat the same numbers, so change all three together.
"""
import os, subprocess, shutil, sys
from PIL import ImageChops, Image, ImageDraw, ImageFilter

BRAND = (0xFF, 0x5A, 0x1F)      # Piston orange  #FF5A1F
INK = (0x0E, 0x10, 0x14)        # splash / dark background
TILE_TOP, TILE_BOTTOM = (0x23, 0x27, 0x30), (0x0B, 0x0D, 0x11)   # the app icon tile
WHITE = (255, 255, 255)

# name: (x0, y0, x1, y1, radius, only-bottom-corners-rounded)
CYL_OUT = (22, 38, 78, 92, 13, True)
CYL_IN = (30, 38, 70, 84, 6, True)      # subtracted: leaves a U with 8-unit walls
HEAD = (34, 54, 66, 70, 3, False)
ROD = (46, 20, 54, 56, 0, False)
CAP = (38, 12, 62, 21, 4.5, False)
MARK_BOX = (22, 12, 78, 92)             # tight bounds of the glyph

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RES = os.path.join(ROOT, "Resources")


def hexs(c): return "#%02X%02X%02X" % c


def svg_u(o, i):
    x0, y0, x1, y1, r, _ = o
    ix0, iy0, ix1, iy1, ir, _ = i
    return (f"M{x0} {y0}H{ix0}V{iy1 - ir}Q{ix0} {iy1} {ix0 + ir} {iy1}H{ix1 - ir}Q{ix1} {iy1} {ix1} {iy1 - ir}V{y0}H{x1}"
            f"V{y1 - r}Q{x1} {y1} {x1 - r} {y1}H{x0 + r}Q{x0} {y1} {x0} {y1 - r}Z")


def mark_svg_body(fill):
    def rect(s):
        x0, y0, x1, y1, r, _ = s
        return f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" rx="{r}"/>'
    return (f'<g fill="{fill}"><path d="{svg_u(CYL_OUT, CYL_IN)}"/>{rect(HEAD)}{rect(ROD)}{rect(CAP)}</g>')


def draw_mark_mask(size, box, scale=4):
    """Anti-aliased L mask of the glyph, with MARK_BOX fitted into `box` (x0,y0,x1,y1 in px) of a size x size canvas."""
    S = size * scale
    m = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(m)
    bx0, by0, bx1, by1 = [v * scale for v in box]
    k = min((bx1 - bx0) / (MARK_BOX[2] - MARK_BOX[0]), (by1 - by0) / (MARK_BOX[3] - MARK_BOX[1]))
    ox = (bx0 + bx1) / 2 - k * (MARK_BOX[0] + MARK_BOX[2]) / 2
    oy = (by0 + by1) / 2 - k * (MARK_BOX[1] + MARK_BOX[3]) / 2

    def rr(s, fill):
        x0, y0, x1, y1, r, bottom = s
        corners = (False, False, True, True) if bottom else (True, True, True, True)
        d.rounded_rectangle([ox + k * x0, oy + k * y0, ox + k * x1 - 1, oy + k * y1 - 1], radius=k * r, fill=fill, corners=corners)
    rr(CYL_OUT, 255); rr(CYL_IN, 0); rr(HEAD, 255); rr(ROD, 255); rr(CAP, 255)
    return m.resize((size, size), Image.LANCZOS)


def mark_png(size, color):
    img = Image.new("RGBA", (size, size), color + (0,))
    img.putalpha(draw_mark_mask(size, (0, 0, size, size)))
    return img


def icon_png(size):
    """The macOS app icon: a dark rounded tile (824/1024 of the canvas, like Apple's grid) with the mark in brand orange and a soft warm glow."""
    S = 1024
    tile = (100, 100, 924, 924)
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([tile[0], tile[1] + 12, tile[2], tile[3] + 12], radius=188, fill=(0, 0, 0, 105))
    canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(16)))
    ss = 4
    tmask = Image.new("L", (S * ss, S * ss), 0)
    ImageDraw.Draw(tmask).rounded_rectangle([v * ss for v in tile], radius=188 * ss, fill=255)
    tmask = tmask.resize((S, S), Image.LANCZOS)
    # dark tile: a faint top-to-bottom gradient so it does not read as a flat black square
    t = Image.new("RGBA", (S, S), TILE_BOTTOM + (255,))
    top = Image.new("RGBA", (S, S), TILE_TOP + (255,))
    t = Image.composite(top, t, Image.linear_gradient("L").rotate(180).resize((S, S)))
    t.putalpha(tmask)
    canvas = Image.alpha_composite(canvas, t)
    mask = draw_mark_mask(S, (300, 215, 724, 809))
    glow = Image.new("RGBA", (S, S), BRAND + (0,))
    glow.putalpha(mask.filter(ImageFilter.GaussianBlur(46)).point(lambda v: int(v * 0.55)))
    glow.putalpha(ImageChops.darker(glow.getchannel("A"), tmask))
    canvas = Image.alpha_composite(canvas, glow)
    glyph = Image.new("RGBA", (S, S), BRAND + (0,))
    glyph.putalpha(mask)
    canvas = Image.alpha_composite(canvas, glyph)
    return canvas if size == S else canvas.resize((size, size), Image.LANCZOS)


def main():
    br = os.path.join(RES, "branding")
    os.makedirs(br, exist_ok=True)
    for name, col in (("white", WHITE), ("orange", BRAND)):
        with open(os.path.join(br, f"piston-mark-{name}.svg"), "w") as f:
            f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{MARK_BOX[0]} {MARK_BOX[1]} {MARK_BOX[2] - MARK_BOX[0]} {MARK_BOX[3] - MARK_BOX[1]}">'
                    f'{mark_svg_body(hexs(col))}</svg>\n')
        mark_png(512, col).save(os.path.join(br, f"piston-mark-{name}.png"))
    with open(os.path.join(br, "piston-icon.svg"), "w") as f:
        f.write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">'
                f'<rect x="100" y="100" width="824" height="824" rx="188" fill="{hexs(INK)}"/>'
                f'<svg x="300" y="215" width="424" height="594" viewBox="{MARK_BOX[0]} {MARK_BOX[1]} {MARK_BOX[2] - MARK_BOX[0]} {MARK_BOX[3] - MARK_BOX[1]}">'
                f'{mark_svg_body(hexs(BRAND))}</svg></svg>\n')

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
