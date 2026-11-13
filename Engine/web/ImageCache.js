// Shared image loader keyed by path, so multiple SpriteRenderers pointing at the same file
// (e.g. a spritesheet reused by many bullets or enemies) share one Image and one load instead
// of each creating and decoding their own copy.
class ImageCacheImpl {
    constructor() {
        this.cache = new Map();
    }

    get(path) {
        if (!this.cache.has(path)) {
            const image = new window.Image();
            const entry = { image, loaded: false };
            image.onload = () => { entry.loaded = true; };
            image.src = path;
            this.cache.set(path, entry);
        }
        return this.cache.get(path);
    }
}

export const ImageCache = new ImageCacheImpl();
