// Piston code editor: CodeMirror 6, bundled to one offline file (EditorWeb/editor.js) by `npm run build`.
// Swift talks to it through window.PistonEditor and receives {type:'ready'|'change'|'focus'|'save'|'diagnostics'} on
// webkit.messageHandlers.editor.
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, foldGutter, foldKeymap, syntaxTree } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { linter, lintGutter, lintKeymap, forEachDiagnostic } from '@codemirror/lint';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';

const post = (m) => window.webkit?.messageHandlers?.editor?.postMessage(m);

const highlight = HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword], color: 'var(--c-keyword)' },
    { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--c-string)' },
    { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--c-number)' },
    { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--c-comment)', fontStyle: 'italic' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: 'var(--c-function)' },
    { tag: [t.className, t.typeName, t.definition(t.className)], color: 'var(--c-type)' },
    { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--c-property)' },
    { tag: [t.self], color: 'var(--c-keyword)' },
    { tag: [t.operator, t.punctuation], color: 'var(--c-punct)' },
    { tag: t.invalid, color: 'var(--c-error)' },
]);

const theme = EditorView.theme({
    '&': { height: '100%', color: 'var(--fg)', backgroundColor: 'var(--bg)' },
    '.cm-scroller': { fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: '12px', lineHeight: '1.55' },
    '.cm-content': { caretColor: 'var(--fg)', padding: '8px 0' },
    '.cm-cursor': { borderLeftColor: 'var(--fg)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--gutter)', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--active-line)', color: 'var(--fg)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection) !important' },
    '.cm-matchingBracket': { backgroundColor: 'var(--selection)', outline: 'none' },
    '.cm-tooltip': { backgroundColor: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--fg)' },
    '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--fg)' },
    '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--c-error)', textDecorationSkipInk: 'none' },
});

// Syntax errors straight from the parser's error nodes: no execution, so it is safe on any file.
const syntaxLint = linter((view) => {
    const diagnostics = [];
    syntaxTree(view.state).iterate({
        enter(node) {
            if (!node.type.isError) return;
            const doc = view.state.doc;
            const from = Math.min(node.from, doc.length);
            const to = Math.max(Math.min(node.to, doc.length), Math.min(from + 1, doc.length));
            const line = doc.lineAt(from);
            diagnostics.push({ from, to: Math.max(to, from), severity: 'error', message: `Syntax error (line ${line.number})` });
        },
    });
    return diagnostics.slice(0, 50);
}, { delay: 250 });

const language = new Compartment();
const languageFor = (name) => name === 'json' ? json() : name === 'js' ? javascript() : [];
const lintFor = (name) => (name === 'json' || name === 'js') ? [syntaxLint, lintGutter()] : [];
const lintComp = new Compartment();

let applying = false;
let view;
let timer;

function reportDiagnostics() {
    let errors = 0, first = null;
    forEachDiagnostic(view.state, (d, from) => {
        if (d.severity !== 'error') return;
        errors++;
        if (!first) first = { line: view.state.doc.lineAt(from).number, message: d.message };
    });
    post({ type: 'diagnostics', errors, first });
}

function create() {
    view = new EditorView({
        parent: document.getElementById('editor'),
        state: EditorState.create({
            doc: '',
            extensions: [
                lineNumbers(), foldGutter(), highlightActiveLine(), highlightActiveLineGutter(), drawSelection(), dropCursor(),
                rectangularSelection(), history(), indentOnInput(), bracketMatching(), closeBrackets(), autocompletion(),
                highlightSelectionMatches(), syntaxHighlighting(highlight), theme,
                language.of([]), lintComp.of([]),
                keymap.of([
                    { key: 'Mod-s', run: () => { post({ type: 'save' }); return true; } },
                    ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap,
                    indentWithTab,
                ]),
                EditorView.updateListener.of((u) => {
                    if (u.docChanged && !applying) post({ type: 'change', text: u.state.doc.toString() });
                    if (u.docChanged || u.transactions.some(tr => tr.effects.length)) {
                        clearTimeout(timer);
                        timer = setTimeout(reportDiagnostics, 400);
                    }
                    if (u.focusChanged && u.view.hasFocus) post({ type: 'focus' });
                }),
            ],
        }),
    });
}

window.PistonEditor = {
    // Replaces the document without touching undo history only when it really differs (file reloaded on disk).
    setText(text, lang) {
        if (!view) create();
        view.dispatch({ effects: [language.reconfigure(languageFor(lang)), lintComp.reconfigure(lintFor(lang))] });
        if (view.state.doc.toString() === text) return;
        applying = true;
        const caret = Math.min(view.state.selection.main.head, text.length);
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: caret } });
        applying = false;
    },
    undo() { undo(view); },
    redo() { redo(view); },
    focus() { view?.focus(); },
    goTo(line) {
        const l = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
        view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
        view.focus();
    },
};

create();
post({ type: 'ready' });
