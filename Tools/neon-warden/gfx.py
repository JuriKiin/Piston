"""Shared drawing helpers for the Neon Warden art generators (Pillow only, no numpy).

Everything is drawn on a supersampled canvas (SS x) in final-pixel coordinates and shrunk with Lanczos on save, so edges are anti-aliased.
The look comes from a few cheap, composable passes: a gradient fill, inner ambient occlusion, a top-left bevel highlight, a coloured rim light on the
opposite edge, emissive shapes with a blurred glow, and soft contact shadows.
"""
import math, os, random
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageOps

SS = 3
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'Samples', 'NeonWarden')
ART = os.path.join(ROOT, 'assets', 'art')
os.makedirs(ART, exist_ok=True)


def hexc(h, a=255):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def mix(c0, c1, t):
    return tuple(int(c0[i] + (c1[i] - c0[i]) * t) for i in range(4))


def scale_c(c, f):
    return (min(255, int(c[0] * f)), min(255, int(c[1] * f)), min(255, int(c[2] * f)), c[3])


def grad_img(size, c0, c1, angle=90):
    """Linear gradient from colour c0 to c1; `angle` is the direction of travel in degrees (90 = top to bottom, 0 = left to right)."""
    w, h = size
    d = int(math.hypot(w, h)) + 2
    g = Image.linear_gradient('L').resize((d, d), Image.BILINEAR).rotate(90 - angle, resample=Image.BICUBIC)
    g = g.crop(((d - w) // 2, (d - h) // 2, (d - w) // 2 + w, (d - h) // 2 + h))
    out = ImageOps.colorize(g, c0[:3], c1[:3]).convert('RGBA')
    a = ImageChops.add(ImageChops.multiply(g.point(lambda v: 255 - v), Image.new('L', size, c0[3])), ImageChops.multiply(g, Image.new('L', size, c1[3])), scale=255) if c0[3] != 255 or c1[3] != 255 else None
    if a is not None:
        out.putalpha(a)
    return out


_RAD = Image.radial_gradient('L')


def radial_mask(size, fn):
    """An 'L' image where value = fn(r) for r = distance / (size/2) (r=1 is the inscribed circle). fn returns 0..255."""
    lut = [max(0, min(255, int(fn(min(v / 180.3, 1.5))))) for v in range(256)]
    return _RAD.resize((size, size), Image.BICUBIC).point(lut)


def glow_sprite(size, color, power=2.2, core=1.0, falloff=1.0):
    """A soft round glow: bright centre fading to transparent at the edge. Returns RGBA."""
    m = radial_mask(size, lambda r: 255 * core * max(0.0, 1 - r / falloff) ** power if r < falloff else 0)
    img = Image.new('RGBA', (size, size), color[:3] + (0,))
    img.putalpha(m)
    return img


class Cv:
    """A supersampled RGBA canvas addressed in final-pixel coordinates."""

    def __init__(self, w, h, ss=SS):
        self.w, self.h, self.ss = w, h, ss
        self.img = Image.new('RGBA', (w * ss, h * ss), (0, 0, 0, 0))
        self.size = (w * ss, h * ss)

    # ----- masks
    def new_mask(self):
        m = Image.new('L', self.size, 0)
        return m, ImageDraw.Draw(m)

    def P(self, pts):
        return [(x * self.ss, y * self.ss) for x, y in pts]

    def poly_mask(self, pts):
        m, d = self.new_mask(); d.polygon(self.P(pts), fill=255); return m

    def circle_mask(self, cx, cy, r):
        m, d = self.new_mask(); s = self.ss; d.ellipse([(cx - r) * s, (cy - r) * s, (cx + r) * s, (cy + r) * s], fill=255); return m

    def ellipse_mask(self, cx, cy, rx, ry, rot=0):
        m, d = self.new_mask(); s = self.ss
        pts = [(cx + rx * math.cos(t) * math.cos(rot) - ry * math.sin(t) * math.sin(rot), cy + rx * math.cos(t) * math.sin(rot) + ry * math.sin(t) * math.cos(rot)) for t in [i * math.pi / 90 for i in range(180)]]
        d.polygon(self.P(pts), fill=255); return m

    def rrect_mask(self, box, r):
        m, d = self.new_mask(); s = self.ss; d.rounded_rectangle([v * s for v in box], radius=r * s, fill=255); return m

    def line_mask(self, pts, width, round_caps=True):
        m, d = self.new_mask(); s = self.ss
        d.line(self.P(pts), fill=255, width=max(1, int(width * s)), joint='curve')
        if round_caps:
            for x, y in (pts[0], pts[-1]):
                d.ellipse([(x - width / 2) * s, (y - width / 2) * s, (x + width / 2) * s, (y + width / 2) * s], fill=255)
        return m

    def ring_mask(self, cx, cy, r, width):
        m, d = self.new_mask(); s = self.ss
        d.ellipse([(cx - r - width / 2) * s, (cy - r - width / 2) * s, (cx + r + width / 2) * s, (cy + r + width / 2) * s], fill=255)
        d.ellipse([(cx - r + width / 2) * s, (cy - r + width / 2) * s, (cx + r - width / 2) * s, (cy + r - width / 2) * s], fill=0)
        return m

    # ----- painting
    def paint(self, mask, fill, alpha=1.0):
        """Composite `fill` (an RGBA colour tuple, or an RGBA image the size of the canvas) through `mask` over the canvas."""
        if isinstance(fill, tuple):
            layer = Image.new('RGBA', self.size, fill)
        else:
            layer = fill.copy()
        a = layer.getchannel('A')
        a = ImageChops.multiply(a, mask)
        if alpha < 1: a = a.point(lambda v: int(v * alpha))
        layer.putalpha(a)
        self.img = Image.alpha_composite(self.img, layer)

    def gradient_fill(self, mask, c0, c1, angle=90, alpha=1.0):
        self.paint(mask, grad_img(self.size, c0, c1, angle), alpha)

    def shadow_inner(self, mask, strength=0.6, radius=6, color=(4, 6, 20)):
        """Ambient occlusion: darkens the inside of `mask` near its edges."""
        inv = ImageChops.invert(mask).filter(ImageFilter.GaussianBlur(radius * self.ss))
        a = ImageChops.multiply(inv, mask).point(lambda v: int(min(255, v * 2.2 * strength)))
        self.paint(a, color + (255,)) if len(color) == 3 else self.paint(a, color)

    def bevel(self, mask, color=(255, 255, 255, 255), dist=1.2, strength=0.55, blur=0.5, direction=(-1, -1)):
        """Highlight on the edge that faces the light (top-left): mask minus itself shifted away from the light."""
        dx, dy = int(direction[0] * -dist * self.ss), int(direction[1] * -dist * self.ss)
        shifted = ImageChops.offset(mask, dx, dy)
        edge = ImageChops.subtract(mask, shifted).filter(ImageFilter.GaussianBlur(blur * self.ss))
        self.paint(edge.point(lambda v: int(min(255, v * 2))), color, strength)

    def rim(self, mask, color, dist=2.0, strength=0.9, blur=1.2, direction=(1, 1)):
        """Coloured rim light on the edge opposite the key light (bottom-right)."""
        dx, dy = int(direction[0] * -dist * self.ss), int(direction[1] * -dist * self.ss)
        shifted = ImageChops.offset(mask, dx, dy)
        edge = ImageChops.subtract(mask, shifted).filter(ImageFilter.GaussianBlur(blur * self.ss))
        self.paint(edge.point(lambda v: int(min(255, v * 2))), color, strength)

    def outline(self, mask, color, width=1.0):
        grown = mask.filter(ImageFilter.MaxFilter(max(3, int(width * self.ss) // 2 * 2 + 1)))
        self.paint(ImageChops.subtract(grown, mask), color)

    def glow(self, mask, color, radius=8, strength=1.0, passes=1):
        """Soft additive-looking halo from `mask` (drawn under/over the existing pixels with a bright colour)."""
        b = mask.filter(ImageFilter.GaussianBlur(radius * self.ss)).point(lambda v: int(min(255, v * strength * 1.4)))
        for _ in range(passes):
            self.paint(b, color)

    def emissive(self, mask, color, glow_r=6, glow_s=0.9, core=None):
        """A lit-up shape: a glow halo, the colour, and a brighter inner core."""
        self.glow(mask, color, glow_r, glow_s)
        self.paint(mask, color)
        if core is not None:
            inner = mask.filter(ImageFilter.MinFilter(max(3, int(1.5 * self.ss) // 2 * 2 + 1))).filter(ImageFilter.GaussianBlur(0.6 * self.ss))
            self.paint(inner, core)

    def specular(self, cx, cy, rx, ry, rot=0, alpha=0.7):
        m = self.ellipse_mask(cx, cy, rx, ry, rot).filter(ImageFilter.GaussianBlur(0.7 * self.ss))
        self.paint(m, (255, 255, 255, 255), alpha)

    def shadow(self, mask, offset=(3, 5), blur=5, alpha=0.5):
        """Soft drop shadow UNDER everything drawn so far (so call it first, or composite it back below)."""
        dx, dy = int(offset[0] * self.ss), int(offset[1] * self.ss)
        sh = ImageChops.offset(mask, dx, dy).filter(ImageFilter.GaussianBlur(blur * self.ss)).point(lambda v: int(v * alpha))
        layer = Image.new('RGBA', self.size, (0, 0, 0, 255)); layer.putalpha(sh)
        self.img = Image.alpha_composite(layer, self.img)

    def clip_to(self, mask):
        a = self.img.getchannel('A'); self.img.putalpha(ImageChops.multiply(a, mask))

    def out(self):
        return self.img.resize((self.w, self.h), Image.LANCZOS)

    def save(self, name):
        self.out().save(os.path.join(ART, name))


def sheet_from(frames, cols=None):
    """Pack equally sized RGBA frames into one image (a single row, or `cols` columns)."""
    w, h = frames[0].size; cols = cols or len(frames); rows = (len(frames) + cols - 1) // cols
    sheet = Image.new('RGBA', (w * cols, h * rows), (0, 0, 0, 0))
    for i, f in enumerate(frames): sheet.paste(f, ((i % cols) * w, (i // cols) * h))
    return sheet


def save_sheet(frames, name, cols=None):
    sheet_from(frames, cols).save(os.path.join(ART, name))


def rotate_pts(pts, ang, cx=0, cy=0):
    c, s = math.cos(ang), math.sin(ang)
    return [(cx + x * c - y * s, cy + x * s + y * c) for x, y in pts]


def mirror_y(pts):
    return [(x, -y) for x, y in pts]
