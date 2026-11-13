import { UIElement } from "@piston/UIElement.js";
import { Vector2 } from "@piston/Physics/Vector2.js";
import { Animator } from "@piston/Animator.js";
import { LevelFlow } from "@piston/LevelFlow.js";
import { EntityRegistry } from "@piston/EntityRegistry.js";
import { GoogleFonts } from "@piston/UI/GoogleFonts.js";
import input from "@piston/static/Input.js";
import { COURSE } from "./Course.js";
import { FONT } from "./Theme.js";
import { sfx } from "./Sfx.js";

const W = 1560, H = 700, CELL = 118, LABEL_W = 230, TOTAL_W = 190;
const INK = '#2b3a2f', PAPER = '#f6efd9', GREEN = '#2e7d45', GOLD = 'rgba(255, 214, 102, 0.45)';

/**
 * A golf score card that slides down from the top of the screen. It lives in every hole's scene as a screen-space entity with an Animator
 * ("slideIn" / "slideOut" clips move it), so the motion is edited in the Animation panel. `show()` slides it in, draws the course so far
 * (par, strokes, birdie circles and bogey squares), and resolves when the player continues (click the button or press Space).
 */
export class Scorecard extends UIElement {
    static description = "A golf score card that slides in from the top and shows par and strokes for every hole. Call show() from game code.";

    constructor(position, size) {
        super(position, size ?? new Vector2(W, H));
        this.tag = 'Scorecard';
        this.final = false;
        this.highlight = '';
        this.open = false;
        this.ready = false;
        this.waiting = null;
        this.wasDown = false;
        this.hover = false;
    }

    getSortingOrder() { return 100; }

    start() {
        super.start();
        this.transform.size = new Vector2(W, H);
        GoogleFonts.ensure(FONT);
    }

    #animator() { return this.getComponent(Animator); }

    update() {
        super.update();
        if (!this.ready) { // start hidden: pose the slide-in clip at its first moment (the entity sits where it ends up so you can edit it)
            this.ready = true;
            this.#animator()?.seek('slideIn', 0);
        }
        if (!this.open || !this.waiting) return;
        const mouse = input.getCanvasMousePosition(), t = this.transform.position, b = this.#button();
        this.hover = Math.abs(mouse.x - (t.x + b.x)) <= b.w / 2 && Math.abs(mouse.y - (t.y + b.y)) <= b.h / 2;
        const down = input.isMouseButtonPressed(0) || input.getKeyDown('Space') || input.getKeyDown('Enter');
        if (this.canContinue && down && !this.wasDown && (this.hover || input.getKeyDown('Space') || input.getKeyDown('Enter'))) this.#continue();
        this.wasDown = down;
    }

    #button() { return { x: 0, y: H / 2 - 82, w: 430, h: 86 }; }

    /** Continues as if the player pressed the button (used by tests and by code that wants to dismiss the card). */
    continueNow() { if (this.waiting) this.#continue(); }

    /** Slides the card in. Resolves after the player continues and the card has slid away again. */
    async show({ highlight = '', final = false } = {}) {
        this.highlight = highlight;
        this.final = final;
        this.open = true;
        this.canContinue = false;
        this.wasDown = true; // a click that is still held from the last putt must not dismiss the card
        const animator = this.#animator();
        const done = new Promise((resolve) => { this.waiting = resolve; });
        await (animator ? animator.playAsync('slideIn') : Promise.resolve());
        this.canContinue = true;
        await done;
        await (animator ? animator.playAsync('slideOut') : Promise.resolve());
        this.open = false;
    }

    #continue() {
        sfx.play('click', { minGap: 0 });
        const resolve = this.waiting;
        this.waiting = null;
        resolve?.();
    }

    restoreEditState(state) {
        super.restoreEditState(state);
        this.ready = false; this.open = false; this.waiting = null;
    }

    // ------------------------------------------------------------------ drawing (local space: the card's centre is 0,0)
    draw(ctx) {
        super.draw?.(ctx);
        const results = new Map(LevelFlow.results.map(r => [r.scene, r]));
        const family = GoogleFonts.familyFor(FONT);
        const font = (px, weight = '') => `${weight} ${px}px "${family}", sans-serif`.trim();
        const left = -W / 2, top = -H / 2;

        // paper with a soft shadow, a green band and a double rule
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
        ctx.fillStyle = PAPER; this.#round(ctx, left, top, W, H, 34); ctx.fill();
        ctx.restore();
        ctx.fillStyle = GREEN; this.#round(ctx, left, top, W, 118, { tl: 34, tr: 34, bl: 0, br: 0 }); ctx.fill();
        ctx.strokeStyle = 'rgba(46,125,69,0.55)'; ctx.lineWidth = 3; this.#round(ctx, left + 14, top + 132, W - 28, H - 146, 24); ctx.stroke();
        ctx.fillStyle = '#fff6d5'; ctx.font = font(74); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(this.final ? 'FINAL SCORE CARD' : 'SCORE CARD', 0, top + 60);

        // the table
        const x0 = left + (W - (LABEL_W + CELL * COURSE.length + TOTAL_W)) / 2;
        const rows = [{ label: 'HOLE', y: top + 190 }, { label: 'PAR', y: top + 290 }, { label: 'SCORE', y: top + 390 }];
        const cx = (i) => x0 + LABEL_W + CELL * i + CELL / 2, totalX = x0 + LABEL_W + CELL * COURSE.length + TOTAL_W / 2;
        const current = COURSE.findIndex(h => h.id === this.highlight);
        if (current >= 0) { ctx.fillStyle = GOLD; this.#round(ctx, cx(current) - CELL / 2 + 4, top + 140, CELL - 8, 330, 16); ctx.fill(); }
        ctx.strokeStyle = 'rgba(43,58,47,0.35)'; ctx.lineWidth = 2;
        for (const r of [top + 240, top + 340, top + 440]) { ctx.beginPath(); ctx.moveTo(x0, r); ctx.lineTo(totalX + TOTAL_W / 2, r); ctx.stroke(); }
        ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.font = font(44);
        for (const r of rows) ctx.fillText(r.label, x0 + 8, r.y);
        ctx.textAlign = 'center';
        let strokes = 0, par = 0;
        COURSE.forEach((hole, i) => {
            const res = results.get(hole.id);
            ctx.fillStyle = INK; ctx.font = font(52); ctx.fillText(String(i + 1), cx(i), rows[0].y);
            ctx.font = font(50); ctx.fillStyle = 'rgba(43,58,47,0.8)'; ctx.fillText(String(hole.par), cx(i), rows[1].y);
            if (res) {
                strokes += res.strokes; par += hole.par;
                ctx.fillStyle = hole.id === this.highlight ? '#b3202c' : INK; ctx.font = font(58); ctx.fillText(String(res.strokes), cx(i), rows[2].y);
                this.#mark(ctx, cx(i), rows[2].y, res.strokes - hole.par, res.strokes === 1);
            }
        });
        ctx.fillStyle = INK; ctx.font = font(48); ctx.fillText('TOTAL', totalX, rows[0].y);
        ctx.fillStyle = 'rgba(43,58,47,0.8)'; ctx.fillText(String(COURSE.reduce((n, h) => n + h.par, 0)), totalX, rows[1].y);
        ctx.fillStyle = INK; ctx.font = font(60); ctx.fillText(String(strokes), totalX, rows[2].y);

        // the verdict on the hole just played, or the course result on the final card
        const last = results.get(this.highlight);
        const diff = strokes - par;
        ctx.fillStyle = this.final ? GREEN : '#b3202c'; ctx.font = font(68);
        const verdict = this.final
            ? `${strokes} strokes · ${diff === 0 ? 'even par' : `${Math.abs(diff)} ${diff < 0 ? 'under' : 'over'} par`}`
            : last ? this.#verdict(last.strokes, COURSE.find(h => h.id === this.highlight)?.par ?? last.par ?? 0) : '';
        ctx.fillText(verdict, 0, top + 540);

        // the continue button
        const b = this.#button();
        ctx.fillStyle = this.hover && this.canContinue ? '#3fa35e' : GREEN; this.#round(ctx, b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, 24); ctx.fill();
        ctx.fillStyle = '#fff6d5'; ctx.font = font(52);
        ctx.fillText(this.final ? 'Main Menu' : (current === COURSE.length - 1 ? 'Finish' : 'Next Hole  ▶'), b.x, b.y + 2);
    }

    #verdict(strokes, par) {
        const d = strokes - par;
        if (strokes === 1) return 'Hole in one!';
        return d <= -2 ? 'Eagle!' : d === -1 ? 'Birdie!' : d === 0 ? 'Par' : d === 1 ? 'Bogey' : d === 2 ? 'Double bogey' : `+${d}`;
    }

    /** Pencil marks like a real card: circle = under par (two = eagle or better), square = over par (two = double bogey or worse). */
    #mark(ctx, x, y, diff, ace) {
        if (diff === 0) return;
        ctx.strokeStyle = diff < 0 ? '#2e7d45' : '#b3202c'; ctx.lineWidth = 4;
        const layers = Math.min(2, Math.abs(diff)), r = 38;
        for (let n = 0; n < layers; n++) {
            const k = r + n * 9;
            if (diff < 0) { ctx.beginPath(); ctx.arc(x, y, k, 0, Math.PI * 2); ctx.stroke(); } else ctx.strokeRect(x - k, y - k, k * 2, k * 2);
        }
    }

    #round(ctx, x, y, w, h, r) {
        const c = typeof r === 'number' ? { tl: r, tr: r, br: r, bl: r } : { tl: 0, tr: 0, br: 0, bl: 0, ...r };
        ctx.beginPath();
        ctx.moveTo(x + c.tl, y); ctx.lineTo(x + w - c.tr, y); ctx.quadraticCurveTo(x + w, y, x + w, y + c.tr);
        ctx.lineTo(x + w, y + h - c.br); ctx.quadraticCurveTo(x + w, y + h, x + w - c.br, y + h);
        ctx.lineTo(x + c.bl, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - c.bl);
        ctx.lineTo(x, y + c.tl); ctx.quadraticCurveTo(x, y, x + c.tl, y); ctx.closePath();
    }
}

EntityRegistry.register('Scorecard', Scorecard, 'Golf');
