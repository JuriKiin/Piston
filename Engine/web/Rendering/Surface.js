// Offscreen drawing surfaces and cached recoloured copies of images.
// `Surface.create` is replaceable so tests (and non-browser platforms) can supply their own canvas implementation.
export const Surface = {
    create(width, height) {
        const c = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(width, height);
        c.width = Math.max(1, Math.round(width)); c.height = Math.max(1, Math.round(height));
        return c;
    },
};

const MAX_VARIANTS = 96;           // per source image; the oldest recolour is dropped past this
const variants = new WeakMap();    // image -> Map(key -> canvas)

function cached(image, key, build) {
    let m = variants.get(image);
    if (!m) { m = new Map(); variants.set(image, m); }
    let v = m.get(key);
    if (!v) {
        v = build();
        m.set(key, v);
        if (m.size > MAX_VARIANTS) m.delete(m.keys().next().value);
    }
    return v;
}

/** Snaps an [r,g,b] colour to a coarse grid so a colour that changes smoothly over a particle's life only ever makes a few cached copies. */
export function quantizeColor([r, g, b], step = 24) {
    const q = (v) => Math.max(0, Math.min(255, Math.round(v / step) * step));
    return '#' + [q(r), q(g), q(b)].map(x => Math.min(255, x).toString(16).padStart(2, '0')).join('');
}

/** A copy of `image` multiplied by `color` (white stays that colour, black stays black, transparency is kept). Cached per image and colour. */
export function tintedImage(image, color) {
    if (!image || !color || color === '#ffffff') return image;
    return cached(image, `tint:${color}`, () => {
        const c = Surface.create(image.width, image.height), g = c.getContext('2d');
        g.drawImage(image, 0, 0);
        g.globalCompositeOperation = 'multiply'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
        g.globalCompositeOperation = 'destination-in'; g.drawImage(image, 0, 0);
        return c;
    });
}

/** A solid-white copy of `image` with the same transparency (used for hit flashes). Cached per image. */
export function silhouetteImage(image) {
    if (!image) return image;
    return cached(image, 'silhouette', () => {
        const c = Surface.create(image.width, image.height), g = c.getContext('2d');
        g.drawImage(image, 0, 0);
        g.globalCompositeOperation = 'source-in'; g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
        return c;
    });
}

/** How many recoloured copies exist for an image (tests and the profiler). */
export function variantCount(image) { return variants.get(image)?.size ?? 0; }
