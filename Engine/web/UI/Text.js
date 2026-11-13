import { Component } from '../Component.js';
import { ComponentRegistry } from '../ComponentRegistry.js';
import { GoogleFonts } from './GoogleFonts.js';

/**
 * Draws a string at its entity's position - same "just a component, attach it to anything" idea as
 * ShapeRenderer/PolygonRenderer, but for text instead of a shape. `fontFamily` accepts any Google
 * Fonts name (see GoogleFonts.js) alongside the usual generic CSS keywords, so swapping a HUD
 * label's look over is a one-field Inspector edit, not a new asset to import.
 */
export class Text extends Component {
    static description = "Draws text on screen, for labels and scores.";

    static fields = [
        { key: 'text', label: 'Text', type: 'text' },
        { key: 'fontFamily', label: 'Font (Google Fonts name)', type: 'text' },
        { key: 'fontSize', label: 'Font Size', type: 'number', animatable: true },
        { key: 'color', label: 'Color', type: 'color', animatable: true },
        { key: 'align', label: 'Align (left/center/right)', type: 'text' },
        { key: 'sortingOrder', label: 'Order', type: 'number' },
    ];

    constructor({ text = 'Text', fontFamily = 'sans-serif', fontSize = 20, color = '#ffffff', align = 'center', sortingOrder = 0 } = {}) {
        super();
        this.text = text;
        this.fontSize = fontSize;
        this.color = color;
        this.align = align;
        this.sortingOrder = sortingOrder;
        this.fontFamily = fontFamily; // setter below - triggers the Google Fonts fetch
    }

    get fontFamily() { return this._fontFamily; }
    set fontFamily(name) {
        this._fontFamily = name;
        GoogleFonts.ensure(name);
    }

    /** `text` is the one field game code (e.g. Ball's shot counter) routinely overwrites at
     * runtime rather than only through the Inspector, so it needs the same Play->Stop revert
     * Entity fields get via captureEditState - see Component.js's base (no-op) hooks. */
    captureState() { return { text: this.text }; }
    restoreState(state) { this.text = state.text; }

    draw(ctx) {
        if (!this.text) return;
        // The trailing sans-serif is a real fallback, not decoration - it's what actually renders
        // for the handful of frames before a Google Font finishes loading (see GoogleFonts.js).
        ctx.font = `${this.fontSize}px "${this.fontFamily}", sans-serif`;
        ctx.fillStyle = this.color;
        ctx.textAlign = ['left', 'center', 'right'].includes(this.align) ? this.align : 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.text, 0, 0);
    }
}

ComponentRegistry.register('Text', Text, 'engine');
