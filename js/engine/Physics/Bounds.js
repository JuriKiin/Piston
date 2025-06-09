export class Bounds {
    constructor(left, right, top, bottom) {
        this.left = left ?? 0;
        this.right = right ?? 0;
        this.top = top ?? Infinity;
        this.bottom = bottom ?? Infinity;
    }
}