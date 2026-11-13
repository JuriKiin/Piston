import SwiftUI
import WebKit

enum BridgeError: LocalizedError {
    case timeout(String)
    case runtime(String)
    var errorDescription: String? {
        switch self {
        case .timeout(let t): return "Bridge request '\(t)' timed out"
        case .runtime(let m): return m
        }
    }
}

/// Owns the Edit-view `WKWebView` and the editor ⟷ runtime message bridge.
///  - runtime → editor: `window.webkit.messageHandlers.piston.postMessage(…)`
///  - editor → runtime: `window.__pistonReceive({id, type, …})`, answered with `{replyTo: id, ok, result|error}`
@MainActor
final class WebHost: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let webView: WKWebView
    /// Unsolicited runtime messages: ready, log, error, …
    var onEvent: (([String: Any]) -> Void)?

    private var pending: [Int: CheckedContinuation<Any?, Error>] = [:]
    private var nextID = 1

    override init() {
        let config = WKWebViewConfiguration()
        let controller = WKUserContentController()
        config.userContentController = controller
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        controller.add(WeakHandler(self), name: "piston")
        webView.navigationDelegate = self
        webView.isInspectable = true // Safari ▸ Develop ▸ Piston, for debugging the runtime
        webView.setValue(false, forKey: "drawsBackground")
    }

    func load(_ url: URL) { webView.load(URLRequest(url: url)) }
    func reload() { webView.reloadFromOrigin() }

    /// Sends a request and awaits the runtime's answer.
    @discardableResult
    func request(_ type: String, _ payload: [String: Any] = [:], timeout: Double = 8) async throws -> Any? {
        let id = nextID
        nextID += 1
        var message = payload
        message["id"] = id
        message["type"] = type
        let data = try JSONSerialization.data(withJSONObject: message)
        let js = "window.__pistonReceive(\(String(decoding: data, as: UTF8.self)))"

        return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Any?, Error>) in
            pending[id] = cont
            webView.evaluateJavaScript(js) { [weak self] _, error in
                // A JS exception (bridge not loaded yet, say) fails immediately instead of timing out.
                if let error, let c = self?.pending.removeValue(forKey: id) { c.resume(throwing: error) }
            }
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                if let c = self?.pending.removeValue(forKey: id) { c.resume(throwing: BridgeError.timeout(type)) }
            }
        }
    }

    // MARK: WKScriptMessageHandler

    nonisolated func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let body = message.body
        Task { @MainActor in self.receive(body) }
    }

    private func receive(_ body: Any) {
        guard let dict = body as? [String: Any] else { return }
        if let id = dict["replyTo"] as? Int, let cont = pending.removeValue(forKey: id) {
            if (dict["ok"] as? Bool) == true {
                cont.resume(returning: dict["result"])
            } else {
                cont.resume(throwing: BridgeError.runtime(dict["error"] as? String ?? "unknown error"))
            }
        } else {
            onEvent?(dict)
        }
    }

    // WKWebView navigations happen on reload: fail every in-flight request so callers don't hang.
    nonisolated func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        Task { @MainActor in
            let waiting = self.pending
            self.pending.removeAll()
            for (_, c) in waiting { c.resume(throwing: BridgeError.runtime("page reloaded")) }
        }
    }
}

/// WKUserContentController retains its handlers strongly; this breaks the retain cycle.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

struct WebViewRepresentable: NSViewRepresentable {
    let webView: WKWebView
    // The web view must not claim drags itself (it would swallow file drops meant for the editor, e.g. a prefab
    // dragged into the Scene view): unregistering lets SwiftUI's drop targets above it receive them.
    func makeNSView(context: Context) -> WKWebView { webView.unregisterDraggedTypes(); return webView }
    func updateNSView(_ nsView: WKWebView, context: Context) { nsView.unregisterDraggedTypes() }
}
