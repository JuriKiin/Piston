import SwiftUI
import AppKit
import WebKit

/// The code editor: CodeMirror 6 inside a WKWebView (bundled offline, see Tools/codeeditor). It gives
/// highlighting, bracket matching, autocomplete, search and live syntax-error checking for JS and JSON, and never
/// "smart" substitutes quotes or dashes. Swift owns the text; the page reports edits and the Swift side pushes
/// external changes (file reloaded from disk).
struct CodeEditor: NSViewRepresentable {
    @Binding var text: String
    var fileExtension: String = "js"
    var onSave: () -> Void = {}

    func makeCoordinator() -> CodeEditorHost { CodeEditorHost(self) }

    func makeNSView(context: Context) -> WKWebView {
        let host = context.coordinator
        host.webView.unregisterDraggedTypes()
        return host.webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.push(text)
    }

    static func dismantleNSView(_ nsView: WKWebView, coordinator: CodeEditorHost) {
        if CodeEditorHost.active === coordinator { CodeEditorHost.active = nil }
    }

    static func language(for ext: String) -> String {
        switch ext.lowercased() {
        case "js", "mjs", "cjs", "jsx": return "js"
        case "json": return "json"
        default: return "text"
        }
    }

    /// The page's source. Inlined so the editor works from a plain `loadHTMLString` with no file access rules.
    static let html: String = {
        let dir: URL = {
            if let res = Bundle.main.resourceURL?.appendingPathComponent("EditorWeb"), FileManager.default.fileExists(atPath: res.path) { return res }
            return URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
                .appendingPathComponent("EditorWeb")
        }()
        let js = (try? String(contentsOf: dir.appendingPathComponent("editor.js"), encoding: .utf8)) ?? "document.body.textContent='Code editor bundle missing'"
        return """
        <!doctype html><html><head><meta charset="utf-8"><style>
        :root { --bg:#ffffff; --fg:#1f2328; --gutter:#8c959f; --active-line:rgba(128,128,128,.10); --selection:rgba(10,102,255,.22);
          --panel:#f3f4f6; --border:#d0d7de; --c-keyword:#cf222e; --c-string:#0a3069; --c-number:#0550ae; --c-comment:#6e7781;
          --c-function:#8250df; --c-type:#953800; --c-property:#116329; --c-punct:#57606a; --c-error:#d1242f; }
        @media (prefers-color-scheme: dark) { :root { --bg:#1e1e20; --fg:#e6e6e6; --gutter:#6b7078; --active-line:rgba(255,255,255,.05);
          --selection:rgba(80,140,255,.35); --panel:#2a2a2d; --border:#3a3a3e; --c-keyword:#ff7b72; --c-string:#a5d6ff; --c-number:#79c0ff;
          --c-comment:#8b949e; --c-function:#d2a8ff; --c-type:#ffa657; --c-property:#7ee787; --c-punct:#9aa0a6; --c-error:#ff6b6b; } }
        html, body, #editor { margin:0; height:100%; background:var(--bg); }
        </style></head><body><div id="editor"></div><script>\(js)</script></body></html>
        """
    }()
}

/// One editor page. The most recently focused one receives menu Undo/Redo.
@MainActor
final class CodeEditorHost: NSObject, WKScriptMessageHandler {
    static weak var active: CodeEditorHost?

    var parent: CodeEditor
    let webView: WKWebView
    /// Latest diagnostics from the page (error count and the first message), for the status bar.
    private(set) var errors = 0
    private var ready = false
    private var known: String?   // what the page currently holds, as far as we know

    init(_ parent: CodeEditor) {
        self.parent = parent
        let config = WKWebViewConfiguration()
        let controller = WKUserContentController()
        config.userContentController = controller
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        controller.add(EditorHandler(self), name: "editor")
        webView.setValue(false, forKey: "drawsBackground")
        webView.isInspectable = true
        webView.loadHTMLString(CodeEditor.html, baseURL: nil)
    }

    /// Sends text to the page only when it differs from what the page already has.
    func push(_ text: String) {
        guard ready, known != text else { return }
        known = text
        send(text)
    }

    private func send(_ text: String) {
        let lang = CodeEditor.language(for: parent.fileExtension)
        // JSON-encode the string so every character survives the trip into JS.
        guard let data = try? JSONSerialization.data(withJSONObject: [text], options: []),
              var arr = String(data: data, encoding: .utf8) else { return }
        arr.removeFirst(); arr.removeLast()
        webView.evaluateJavaScript("PistonEditor.setText(\(arr), '\(lang)')", completionHandler: nil)
    }

    func run(_ call: String) { webView.evaluateJavaScript("PistonEditor.\(call)", completionHandler: nil) }

    nonisolated func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        Task { @MainActor in self.handle(type, body) }
    }

    private func handle(_ type: String, _ body: [String: Any]) {
        switch type {
        case "ready":
            ready = true
            known = parent.text
            send(parent.text)
        case "change":
            if let text = body["text"] as? String { known = text; parent.text = text }
            Self.active = self
        case "focus": Self.active = self
        case "save": parent.onSave()
        case "diagnostics": errors = body["errors"] as? Int ?? 0
        default: break
        }
    }
}

private final class EditorHandler: NSObject, WKScriptMessageHandler {
    weak var target: CodeEditorHost?
    init(_ target: CodeEditorHost) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(c, didReceive: message)
    }
}
