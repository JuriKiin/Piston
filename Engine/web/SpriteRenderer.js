import { Component } from './Component.js';
import { ComponentRegistry } from './ComponentRegistry.js';
import { ImageCache } from './ImageCache.js';
import Constants from './static/Constants.js';

/**
 * Draws a static image, or plays a frame animation sliced out of a spritesheet, sized from the
 * entity's transform.size (falling back to the image's natural size if that's unset) - the visual
 * counterpart to ShapeRenderer/PolygonRenderer for entities backed by real art instead of a flat
 * fill. Images are shared via ImageCache, so many entities pointing at the same file (bullets,
 * enemies of the same kind) decode it once between them rather than each loading their own copy.
 */
export class SpriteRenderer extends Component {
    static description = "Draws an image, or plays a frame animation cut from a sprite sheet. Use the Sprite Sheet editor in the Inspector to set up the grid.";

    static fields = [
        { key: 'imagePath', label: 'Image Path', type: 'text', accept: 'image' },
        { key: 'frameWidth', label: 'Frame Width', type: 'number' },
        { key: 'frameHeight', label: 'Frame Height', type: 'number' },
        { key: 'frameCount', label: 'Frame Count', type: 'number' },
        { key: 'columns', label: 'Columns', type: 'number' },
        { key: 'fps', label: 'FPS', type: 'number' },
        { key: 'loop', label: 'Loop', type: 'checkbox' },
        // Where transform.position sits within the drawn image, as a 0-1 fraction of its width/
        // height - (0.5, 0.5) (the default, and every renderer's only option before this) is
        // dead-center, matching ShapeRenderer/PolygonRenderer's own centered drawing. (0.5, 1) is
        // bottom-center - useful for anything that should stand ON its position rather than be
        // centered over it, e.g. a flagpole planted at the hole.
        { key: 'anchorX', label: 'Anchor X', type: 'number', animatable: true },
        { key: 'anchorY', label: 'Anchor Y', type: 'number', animatable: true },
        { key: 'opacity', label: 'Opacity', type: 'number', animatable: true },
        // Pixel art stays crisp when scaled up (no smoothing). Leave off for photos and smooth art.
        { key: 'pixelArt', label: 'Pixel art (no smoothing)', type: 'checkbox' },
        // Lower draws first (further back) - see Entity.getSortingOrder(), which every renderer
        // component opts into just by having this same field name.
        { key: 'sortingOrder', label: 'Order', type: 'number' },
    ];

    /**
     * @param {object} [options]
     * @param {string} [options.imagePath] Path to the image; empty draws nothing until one's set.
     * @param {number} [options.frameWidth=0] Frame width in pixels. 0 (with frameHeight) means
     *   "not a spritesheet" - draw the whole image as one static frame.
     * @param {number} [options.frameHeight=0] Frame height in pixels.
     * @param {number} [options.frameCount=1] Number of frames in the animation.
     * @param {number} [options.columns] Frames per row in the sheet (defaults to frameCount, i.e. a single row).
     * @param {number} [options.fps=12] Playback speed in frames per second.
     * @param {boolean} [options.loop=true] Whether the animation repeats or holds its last frame.
     * @param {number} [options.anchorX=0.5] 0 = left edge, 0.5 = centered, 1 = right edge.
     * @param {number} [options.anchorY=0.5] 0 = top edge, 0.5 = centered, 1 = bottom edge.
     * @param {number} [options.sortingOrder=0]
     */
    constructor({
        imagePath = '', frameWidth = 0, frameHeight = 0, frameCount = 1,
        columns = null, fps = 12, loop = true, anchorX = 0.5, anchorY = 0.5, sortingOrder = 0,
    } = {}) {
        super();
        this._imagePath = imagePath;
        this._entry = imagePath ? ImageCache.get(imagePath) : null;

        this.frameWidth = frameWidth;
        this.frameHeight = frameHeight;
        this.frameCount = frameCount;
        this.columns = columns ?? frameCount;
        this.fps = fps;
        this.loop = loop;
        this.anchorX = anchorX;
        this.anchorY = anchorY;
        this.sortingOrder = sortingOrder;
        this.opacity = 1; // 0..1
        this.pixelArt = false;

        this.currentFrame = 0;
        // Always starts true, even for a single frame right now (update()'s own
        // `frameCount <= 1` check already makes that a harmless no-op) - frameCount is a plain
        // mutable field (e.g. set later via the spritesheet editor's Apply, well after
        // construction), so deciding this once here from the CONSTRUCTION-time frame count would
        // leave a sprite that started static permanently unable to animate once it was actually
        // given more than one frame.
        this.playing = true;
        this._frameTimer = 0;
    }

    /** Re-points this renderer at a different image (e.g. edited via the Inspector's text field) -
     * a plain property wouldn't actually reload anything, since the real image lives in ImageCache
     * keyed by path. Restarts the animation from frame 0 so a mismatched old frame doesn't flash
     * on the new sheet for one tick. */
    get imagePath() { return this._imagePath; }
    set imagePath(path) {
        this._imagePath = path;
        this._entry = path ? ImageCache.get(path) : null;
        this.currentFrame = 0;
        this._frameTimer = 0;
    }

    get loaded() { return !!this._entry?.loaded; }
    get image() { return this._entry?.image; }

    play() { this.playing = true; }

    stop() {
        this.playing = false;
        this.currentFrame = 0;
        this._frameTimer = 0;
    }

    /** Advances the animation - called automatically every simulated frame, like any Component. */
    update() {
        if (!this.playing || this.frameCount <= 1) return;

        this._frameTimer += Constants.DELTA_TIME;
        const frameDuration = 1 / this.fps;

        while (this._frameTimer >= frameDuration) {
            this._frameTimer -= frameDuration;
            this.currentFrame++;

            if (this.currentFrame >= this.frameCount) {
                if (this.loop) {
                    this.currentFrame = 0;
                } else {
                    this.currentFrame = this.frameCount - 1;
                    this.playing = false;
                    break;
                }
            }
        }
    }

    draw(ctx) {
        if (!this.loaded) return;
        ctx.globalAlpha *= this.opacity;
        ctx.imageSmoothingEnabled = !this.pixelArt;
        if (!this.pixelArt) ctx.imageSmoothingQuality = 'high'; // large sprites are scaled down: use the good filter

        const size = this.entity.transform.size;
        const w = size?.x || this.image.width;
        const h = size?.y || this.image.height;
        const dx = -w * this.anchorX;
        const dy = -h * this.anchorY;

        if (this.frameWidth && this.frameHeight) {
            const col = this.currentFrame % this.columns;
            const row = Math.floor(this.currentFrame / this.columns);
            ctx.drawImage(
                this.image,
                col * this.frameWidth, row * this.frameHeight, this.frameWidth, this.frameHeight,
                dx, dy, w, h
            );
        } else {
            ctx.drawImage(this.image, dx, dy, w, h);
        }
    }
}

ComponentRegistry.register('SpriteRenderer', SpriteRenderer, 'engine');
