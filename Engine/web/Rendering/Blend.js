// Blend modes shared by every renderer component (SpriteRenderer, ParticleEmitter, TrailRenderer, ...).
// The names are renderer-neutral; the Canvas2D backend maps them to globalCompositeOperation. A future GPU backend maps the same names to blend functions.
export const BLEND_MODES = ['normal', 'additive', 'screen', 'multiply'];

const OPS = { normal: 'source-over', additive: 'lighter', screen: 'screen', multiply: 'multiply' };

/** The Canvas2D `globalCompositeOperation` for a blend mode name. Unknown names fall back to normal. */
export function compositeOp(mode) { return OPS[mode] ?? 'source-over'; }
