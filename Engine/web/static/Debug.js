// Shared debug-visualization toggles, readable/writable from the Inspector popup.
class DebugManager {
    constructor() {
        // Off by default so exported games never draw collider outlines. The editor turns it on where it wants it (the Game view, the legacy dev toolbar).
        this.showColliders = false;
        this._logListeners = [];
    }

    /**
     * Game code's way to surface a message in the Inspector's Console panel regardless of whether
     * the browser's own devtools console is open - unlike console.log (which the Inspector doesn't
     * capture, only console.error), a call here always shows up while the Inspector is open. Also
     * echoed to the real console so it's not lost when the Inspector isn't.
     */
    Log(message) {
        const text = message instanceof Error ? (message.stack ?? message.message) : String(message);
        console.log(text);
        for (const listener of this._logListeners) listener(text);
    }

    /** Inspector registers here to receive every Log() call as it happens. */
    onLog(listener) {
        this._logListeners.push(listener);
    }
}

const debug = new DebugManager();
export default debug;
