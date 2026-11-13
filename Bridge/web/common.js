// Shared by the editor's two runtime pages (Scene view = edit.html/bridge.js, Game view = play.html/play.js).
// Served by the editor itself at /__piston__/ and never copied into a game build.

export const BRIDGE_VERSION = 1;

// Tell the engine where this project keeps its scenes/prefabs (the engine itself is mounted by the editor).
{
    const q = new URLSearchParams(location.search);
    globalThis.__PISTON_PROJECT__ = { scenes: q.get('scenes') ?? './scenes', prefabs: q.get('prefabs') ?? './prefabs',
        sceneIds: (q.get('sceneIds') ?? '').split(',').filter(Boolean) };
}

export const post = (message) => window.webkit?.messageHandlers?.piston?.postMessage(message);

function fmt(value) {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
}

/** Mirrors console.* and uncaught errors into the editor's Console panel, tagged with `from`. */
export function setupConsoleCapture(from) {
    for (const level of ['log', 'info', 'warn', 'error']) {
        const original = console[level].bind(console);
        console[level] = (...args) => {
            post({ type: 'log', from, level, text: args.map(fmt).join(' ') });
            original(...args);
        };
    }
    window.addEventListener('error', (e) => post({ type: 'error', from, message: e.message, source: e.filename, line: e.lineno }));
    window.addEventListener('unhandledrejection', (e) => post({ type: 'error', from, message: String(e.reason?.stack ?? e.reason) }));
}

/** Imports the pieces of the project's engine the bridge needs. */
export async function loadEngine(params) {
    const base = '/__piston__/engine'; // the engine ships inside the Piston app, never inside a project
    const imp = (name) => import(`${base}/${name}`);
    const [gl, sc, er, cr, sio, mc, cam, vec, dbg, sreg, trk, val] = await Promise.all([
        imp('GameLoop.js'), imp('Scene.js'), imp('EntityRegistry.js'), imp('ComponentRegistry.js'),
        imp('SceneIO.js'), imp('MainCamera.js'), imp('Camera.js'), imp('Physics/Vector2.js'), imp('static/Debug.js'), imp('SceneRegistry.js'), imp('Animation/Tracks.js'), imp('SceneValidator.js'),
    ]);
    return {
        GameLoop: gl.default, Scene: sc.Scene, EntityRegistry: er.EntityRegistry, ComponentRegistry: cr.ComponentRegistry,
        SceneIO: sio, MainCamera: mc.MainCamera, Camera: cam.Camera, Vector2: vec.Vector2, Debug: dbg.default, SceneRegistry: sreg.SceneRegistry, Tracks: trk, validateScene: val.validateScene,
    };
}

/** Wires `window.__pistonReceive` to a table of request handlers, replying over postMessage. */
export function setupReceiver(handlers) {
    window.__pistonReceive = (message) => {
        const { id, type, ...payload } = message;
        Promise.resolve()
            .then(() => {
                const fn = handlers[type];
                if (!fn) throw new Error(`Unknown bridge request: ${type}`);
                return fn(payload);
            })
            .then((result) => post({ replyTo: id, ok: true, result }))
            .catch((error) => post({ replyTo: id, ok: false, error: String(error?.message ?? error) }));
        // Deliberately returns nothing: WKWebView.evaluateJavaScript can't return a Promise.
    };
}
