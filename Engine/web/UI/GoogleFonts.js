/**
 * Lazily injects a Google Fonts stylesheet <link> the first time a given family name is asked for,
 * so a Text component can just be given a family like "Poppins" or "Press Start 2P" and have it
 * show up with no separate setup step. Canvas text doesn't block on web font loading the way DOM
 * text does - if a frame draws before the font finishes downloading, ctx.font silently falls back
 * to the generic family Text.draw() also puts in its font string, and since the game redraws every
 * frame, the very next one just picks up the real font once it's ready. No FontFace/`document.fonts`
 * polling needed for that reason.
 */
class GoogleFontsImpl {
    constructor() {
        this.requested = new Set();
        this._local = null;
    }

    /** True for a path to a font file (./assets/fonts/Chewy.ttf): the Text font field accepts either a family name or a file. */
    isFile(name) { return typeof name === 'string' && /\.(ttf|otf|woff2?)$/i.test(name); }

    /** The CSS family to draw with for a font field value: the name itself, or a name derived from the file (Chewy-Regular.ttf → "Chewy-Regular"). */
    familyFor(name) { return this.isFile(name) ? name.split('/').pop().replace(/\.[^.]+$/, '') : name; }

    /** The project's own fonts: assets/fonts/fonts.json, written by the Google Fonts plugin (family → { files: [{ file, weight, style }] }).
     * Fetched once; a project without it just gets {}. */
    localFonts() {
        this._local ??= fetch('./assets/fonts/fonts.json')
            .then((r) => (r.ok ? r.json() : {}))
            .catch(() => ({}))
            .then((m) => Object.fromEntries(Object.entries(m).map(([family, entry]) => [family.toLowerCase(), { family, ...entry }])));
        return this._local;
    }

    /** No-op for a generic CSS keyword (already a real font, and not a Google Fonts name) or a
     * family already requested - safe to call on every Text.fontFamily write. A font that was downloaded
     * into the project loads from there (no network at play time); anything else falls back to Google's CDN. */
    ensure(family) {
        if (!family || this.requested.has(family) || GoogleFontsImpl.GENERIC.has(family.toLowerCase())) return;
        this.requested.add(family);
        if (this.isFile(family)) { this.loadFile(family); return; }
        this.localFonts().then((local) => {
            const entry = local[family.toLowerCase()];
            if (entry) this.loadLocal(entry); else this.loadRemote(family);
        });
    }

    /** Loads one font file straight from the project. */
    loadFile(path) {
        const face = new FontFace(this.familyFor(path), `url("${path}")`);
        document.fonts.add(face);
        face.load().catch((e) => console.error(`Couldn't load font file ${path}: ${e?.message ?? e}`));
    }

    loadLocal({ family, files = [] }) {
        for (const f of files) {
            const face = new FontFace(family, `url("${f.file}")`, { weight: String(f.weight ?? 400), style: f.style ?? 'normal' });
            document.fonts.add(face);
            face.load().catch((e) => console.error(`Couldn't load font file ${f.file} for "${family}": ${e?.message ?? e}`));
        }
    }

    loadRemote(family) {
        // Google's API is case-sensitive on the family name ("chewy" 400s; "Chewy" works) - almost
        // every real Google Fonts name capitalizes each word, so this fixes the overwhelmingly
        // common case (someone just typed it in lowercase) without touching a name that's already
        // cased correctly, including ones that don't follow word-capitalization at all (VT323).
        const normalized = family.replace(/\b\p{Ll}/gu, (ch) => ch.toUpperCase());
        const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(normalized).replace(/%20/g, '+')}:wght@400;700&display=swap`;

        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;

        // A family Google Fonts doesn't recognize doesn't fail loudly anywhere else - the <link>
        // itself, canvas's ctx.font fallback, all of it stays silent, so "I typed a font and
        // nothing changed" has no diagnostic trail. This is that trail - document.fonts.load() asks
        // the browser's own font system whether it actually has this family, which sidesteps
        // fetch()ing fonts.googleapis.com directly (that endpoint has no CORS header for stylesheet
        // requests, so a fetch() to it - as this used to do - fails with a CORS error on every
        // request, successful ones included, before the real check even runs). It only works once
        // the stylesheet has actually loaded though - document.fonts.load() can only match a family
        // against an @font-face rule that already exists in the document, and that rule doesn't
        // exist until the <link> finishes - so this has to wait for `load` first, not run alongside it.
        const reportIfMissing = () => {
            document.fonts.load(`16px "${normalized}"`).then((matches) => {
                if (matches.length === 0) {
                    console.error(`Google Fonts has no family "${family}"${normalized !== family ? ` (tried as "${normalized}")` : ''} - check the exact name at fonts.google.com. Falling back to the generic font.`);
                }
            }).catch(() => { /* not worth a second error on top of the font just not showing up */ });
        };
        link.addEventListener('load', reportIfMissing);
        link.addEventListener('error', reportIfMissing);
        document.head.appendChild(link);
    }
}

GoogleFontsImpl.GENERIC = new Set([
    'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
    'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded',
]);

export const GoogleFonts = new GoogleFontsImpl();
