// js/engine/SpriteRenderer.js
// A component to render PNG or SVG images for an entity

export class SpriteRenderer {
    constructor(imagePath) {
        this.imagePath = imagePath;
        this.image = new window.Image();
        this.loaded = false;
        this.image.onload = () => {
            this.loaded = true;
        };
        this.image.src = imagePath;
    }

    draw(ctx, transform) {
        if (!this.loaded) return;
        const w = transform.size?.x || this.image.width;
        const h = transform.size?.y || this.image.height;
        ctx.drawImage(
            this.image,
            -w / 2,
            -h / 2,
            w,
            h
        );
    }
}
