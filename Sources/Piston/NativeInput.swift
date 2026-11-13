import AppKit
import WebKit

/// Synthesizes REAL native mouse events into a web view (through the window's normal event path), so tests
/// can prove that a user's click/drag reaches the page, not just that the page's own code works.
@MainActor
enum NativeInput {
    private static func event(_ type: NSEvent.EventType, _ viewPoint: CGPoint, in webView: WKWebView) -> NSEvent? {
        guard let window = webView.window else { return nil }
        let windowPoint = webView.convert(viewPoint, to: nil)
        return NSEvent.mouseEvent(with: type, location: windowPoint, modifierFlags: [],
                                  timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                                  context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseUp ? 0 : 1)
    }

    private static func pause(_ ms: UInt64 = 40) async { try? await Task.sleep(nanoseconds: ms * 1_000_000) }

    /// Press at `from`, drag to `to` in a few steps, release. Points are in the web view's own top-left space.
    @discardableResult
    static func drag(in webView: WKWebView, from: CGPoint, to: CGPoint, steps: Int = 8) async -> Bool {
        guard let window = webView.window else { return false }
        // Synthetic events only reach a web view in the key, frontmost window.
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(webView)
        await pause(250)
        let wasAccepting = window.acceptsMouseMovedEvents
        window.acceptsMouseMovedEvents = true
        defer { window.acceptsMouseMovedEvents = wasAccepting }

        // Move first: the engine only learns the pointer position from mousemove.
        if let e = event(.mouseMoved, from, in: webView) { window.sendEvent(e) }
        await pause(120)
        guard let down = event(.leftMouseDown, from, in: webView) else { return false }
        window.sendEvent(down)
        await pause(80)
        for i in 1...steps {
            let t = CGFloat(i) / CGFloat(steps)
            let p = CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t)
            if let e = event(.leftMouseDragged, p, in: webView) { window.sendEvent(e) }
            await pause(40)
        }
        await pause(120)
        if let up = event(.leftMouseUp, to, in: webView) { window.sendEvent(up) }
        await pause(150)
        return true
    }
}
