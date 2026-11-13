import SwiftUI
import WebKit

// MARK: Pages

struct DocPage: Identifiable, Hashable {
    let slug: String
    let title: String
    let markdown: String
    let isReference: Bool
    var id: String { slug }
}

/// The guides (Markdown files shipped with Piston) plus reference pages generated live from the runtime's registries,
/// so the component and entity reference always matches the engine and your own scripts.
enum DocsLibrary {
    private static func folder() -> URL {
        if let res = Bundle.main.resourceURL?.appendingPathComponent("EditorDocs"), FileManager.default.fileExists(atPath: res.path) { return res }
        return URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("EditorDocs")
    }

    static let guides: [DocPage] = {
        let files = ((try? FileManager.default.contentsOfDirectory(at: folder(), includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.pathExtension == "md" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
        return files.compactMap { url in
            guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
            let slug = url.deletingPathExtension().lastPathComponent
            let title = text.split(separator: "\n").first { $0.hasPrefix("# ") }.map { String($0.dropFirst(2)) } ?? slug
            return DocPage(slug: slug, title: title, markdown: text, isReference: false)
        }
    }()

    @MainActor
    static func pages(for model: EditorModel) -> [DocPage] {
        guides + [
            DocPage(slug: "ref-components", title: "Component reference", markdown: componentReference(model), isReference: true),
            DocPage(slug: "ref-entities", title: "Entity reference", markdown: entityReference(model), isReference: true),
        ]
    }

    private static func typeLabel(_ f: SchemaField) -> String {
        if f.accept != nil { return "file (\(f.accept!))" }
        if f.type == "select" { return "one of: " + f.options.joined(separator: ", ") }
        return f.type
    }

    private static func fieldTable(_ fields: [SchemaField]) -> String {
        guard !fields.isEmpty else { return "_No Inspector fields._\n\n" }
        var s = "| Field | Label | Type |\n|---|---|---|\n"
        for f in fields { s += "| `\(f.key)` | \(f.label) | \(typeLabel(f)) |\n" }
        return s + "\n"
    }

    @MainActor
    static func componentReference(_ m: EditorModel) -> String {
        var s = "# Component reference\n\nGenerated from the running engine and your scripts, so it is always current. Add a component from **Add Component** in the Inspector, or in code with `entity.addComponent(new Type())`. See [Entities and components](doc:04-entities-and-components) for how to write your own.\n\n"
        let all = m.componentDocs.sorted { $0.name < $1.name }
        for (title, items) in [("Built in", all.filter { $0.group == "engine" }), ("From your project", all.filter { $0.group != "engine" })] where !items.isEmpty {
            s += "## \(title)\n\n"
            for c in items {
                s += "### \(c.name)\n\n\(c.description.isEmpty ? "_No description yet._" : c.description)\n\n"
                s += fieldTable(m.componentSchemas[c.name] ?? [])
            }
        }
        return s
    }

    @MainActor
    static func entityReference(_ m: EditorModel) -> String {
        var s = "# Entity reference\n\nEntity types you can add from the **+** menu. Each entity has a transform (position, rotation, size) plus the fields below.\n\n"
        let groups = Dictionary(grouping: m.entityDocs, by: \.group)
        for g in groups.keys.sorted() {
            s += "## \(g == "engine" ? "Engine" : g)\n\n"
            for e in (groups[g] ?? []).sorted(by: { $0.name < $1.name }) {
                s += "### \(e.name)\n\n\(e.description.isEmpty ? "_No description yet._" : e.description)\n\n"
                s += fieldTable(m.entitySchemas[e.name] ?? [])
            }
        }
        return s
    }
}

struct DocEntry: Hashable { let name: String; let group: String; let description: String }

// MARK: Markdown -> HTML (small, dependency-free: headings, lists, tables, code, quotes, links)

enum MarkdownHTML {
    static func page(_ markdown: String) -> String {
        """
        <!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><style>
        :root { --fg:#1d1d1f; --muted:#6e6e73; --bg:#fff; --code:#f2f2f4; --line:#d8d8dc; --accent:#0a6cff; }
        @media (prefers-color-scheme: dark) { :root { --fg:#e8e8ea; --muted:#9a9aa0; --bg:#1e1e1e; --code:#2b2b2e; --line:#3a3a3e; --accent:#4da3ff; } }
        body { font: 14px/1.6 -apple-system, BlinkMacSystemFont, sans-serif; color: var(--fg); background: var(--bg); margin: 0; padding: 22px 30px 60px; }
        main { max-width: 780px; }
        h1 { font-size: 26px; margin: 0 0 14px; } h2 { font-size: 19px; margin: 30px 0 8px; border-bottom: 1px solid var(--line); padding-bottom: 4px; }
        h3 { font-size: 15px; margin: 22px 0 6px; }
        a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
        code { font: 12.5px ui-monospace, Menlo, monospace; background: var(--code); padding: 1px 5px; border-radius: 4px; }
        pre { background: var(--code); padding: 12px 14px; border-radius: 8px; overflow-x: auto; } pre code { background: none; padding: 0; }
        table { border-collapse: collapse; margin: 10px 0 16px; font-size: 13px; } th, td { border: 1px solid var(--line); padding: 5px 10px; text-align: left; vertical-align: top; }
        th { background: var(--code); } blockquote { margin: 10px 0; padding: 2px 14px; border-left: 3px solid var(--line); color: var(--muted); }
        li { margin: 3px 0; } hr { border: 0; border-top: 1px solid var(--line); } em { color: var(--muted); }
        mark { background: #ffd60a66; color: inherit; }
        </style></head><body><main>\(render(markdown))</main></body></html>
        """
    }

    static func escape(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
    }

    private static func inline(_ raw: String) -> String {
        var codes: [String] = []
        var s = raw
        // Code spans first, so nothing inside them gets formatted.
        if let re = try? NSRegularExpression(pattern: "`([^`]+)`") {
            let ns = s as NSString
            var out = "", last = 0
            for m in re.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
                out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
                codes.append("<code>\(escape(ns.substring(with: m.range(at: 1))))</code>")
                out += "\u{1}\(codes.count - 1)\u{2}"
                last = m.range.location + m.range.length
            }
            s = out + ns.substring(from: last)
        }
        s = escape(s)
        func sub(_ pattern: String, _ template: String) {
            if let re = try? NSRegularExpression(pattern: pattern) {
                s = re.stringByReplacingMatches(in: s, range: NSRange(location: 0, length: (s as NSString).length), withTemplate: template)
            }
        }
        sub("\\[([^\\]]+)\\]\\(([^)]+)\\)", "<a href=\"$2\">$1</a>")
        sub("\\*\\*([^*]+)\\*\\*", "<strong>$1</strong>")
        sub("(?<![\\w*])_([^_]+)_(?![\\w*])", "<em>$1</em>")
        sub("(?<![\\w*])\\*([^*\\s][^*]*)\\*(?![\\w*])", "<em>$1</em>")
        for (i, c) in codes.enumerated() { s = s.replacingOccurrences(of: "\u{1}\(i)\u{2}", with: c) }
        return s
    }

    static func render(_ md: String) -> String {
        let lines = md.components(separatedBy: "\n")
        var out = "", para: [String] = [], i = 0
        func flush() { if !para.isEmpty { out += "<p>\(inline(para.joined(separator: " ")))</p>\n"; para = [] } }
        func cells(_ l: String) -> [String] {
            var t = l.trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("|") { t.removeFirst() }
            if t.hasSuffix("|") { t.removeLast() }
            return t.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
        }
        func isSeparator(_ l: String) -> Bool { l.contains("|") && l.contains("-") && l.allSatisfy { "|-: ".contains($0) } }
        while i < lines.count {
            let line = lines[i]
            let t = line.trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("```") {
                flush(); i += 1
                var code: [String] = []
                while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("```") { code.append(lines[i]); i += 1 }
                out += "<pre><code>\(escape(code.joined(separator: "\n")))</code></pre>\n"; i += 1; continue
            }
            if t.isEmpty { flush(); i += 1; continue }
            if let h = ["### ": 3, "## ": 2, "# ": 1].first(where: { t.hasPrefix($0.key) }) {
                flush(); out += "<h\(h.value)>\(inline(String(t.dropFirst(h.key.count))))</h\(h.value)>\n"; i += 1; continue
            }
            if t == "---" { flush(); out += "<hr>\n"; i += 1; continue }
            if t.hasPrefix("|"), i + 1 < lines.count, isSeparator(lines[i + 1].trimmingCharacters(in: .whitespaces)) {
                flush()
                out += "<table><thead><tr>" + cells(t).map { "<th>\(inline($0))</th>" }.joined() + "</tr></thead><tbody>\n"
                i += 2
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("|") {
                    out += "<tr>" + cells(lines[i]).map { "<td>\(inline($0))</td>" }.joined() + "</tr>\n"; i += 1
                }
                out += "</tbody></table>\n"; continue
            }
            if t.hasPrefix("> ") {
                flush(); var q: [String] = []
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("> ") { q.append(String(lines[i].trimmingCharacters(in: .whitespaces).dropFirst(2))); i += 1 }
                out += "<blockquote>\(inline(q.joined(separator: " ")))</blockquote>\n"; continue
            }
            let ordered = t.range(of: "^\\d+\\. ", options: .regularExpression) != nil
            if t.hasPrefix("- ") || t.hasPrefix("* ") || ordered {
                flush()
                let tag = ordered ? "ol" : "ul"
                out += "<\(tag)>\n"
                while i < lines.count {
                    let l = lines[i].trimmingCharacters(in: .whitespaces)
                    if let r = l.range(of: ordered ? "^\\d+\\. " : "^[-*] ", options: .regularExpression) {
                        var item = String(l[r.upperBound...]); i += 1
                        while i < lines.count, lines[i].hasPrefix("   "), !lines[i].trimmingCharacters(in: .whitespaces).isEmpty,
                              lines[i].trimmingCharacters(in: .whitespaces).range(of: "^([-*]|\\d+\\.) ", options: .regularExpression) == nil {
                            item += " " + lines[i].trimmingCharacters(in: .whitespaces); i += 1
                        }
                        out += "<li>\(inline(item))</li>\n"
                    } else { break }
                }
                out += "</\(tag)>\n"; continue
            }
            para.append(t); i += 1
        }
        flush()
        return out
    }
}

// MARK: Viewer

struct DocWebView: NSViewRepresentable {
    let html: String
    let highlight: String
    let onLink: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onLink: onLink) }

    func makeNSView(context: Context) -> WKWebView {
        let web = MenuFriendlyWebView(frame: .zero)
        web.navigationDelegate = context.coordinator
        web.setValue(false, forKey: "drawsBackground")
        return web
    }

    func updateNSView(_ web: WKWebView, context: Context) {
        context.coordinator.onLink = onLink
        context.coordinator.highlight = highlight
        if context.coordinator.html != html {
            context.coordinator.html = html
            web.loadHTMLString(html, baseURL: URL(string: "about:blank"))
        } else {
            context.coordinator.applyHighlight(web)
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var onLink: (String) -> Void
        var html = ""
        var highlight = ""
        init(onLink: @escaping (String) -> Void) { self.onLink = onLink }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { applyHighlight(webView) }

        func applyHighlight(_ web: WKWebView) {
            let q = highlight.trimmingCharacters(in: .whitespaces)
            let js = "window.getSelection().removeAllRanges();" + (q.isEmpty ? "" : "window.find(\(Self.jsString(q)), false, false, true);")
            web.evaluateJavaScript(js)
        }

        static func jsString(_ s: String) -> String {
            (try? JSONSerialization.data(withJSONObject: [s])).flatMap { String(data: $0, encoding: .utf8) }.map { String($0.dropFirst().dropLast()) } ?? "\"\""
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard action.navigationType == .linkActivated, let url = action.request.url else { decisionHandler(.allow); return }
            if url.scheme == "doc" { onLink(url.absoluteString.replacingOccurrences(of: "doc:", with: "")) }
            else if url.scheme == "http" || url.scheme == "https" { NSWorkspace.shared.open(url) }
            decisionHandler(.cancel)
        }
    }
}

struct DocsView: View {
    @ObservedObject var model: EditorModel
    var showPopOut = true
    @Environment(\.openWindow) private var openWindow
    @State private var query = ""

    private var pages: [DocPage] { DocsLibrary.pages(for: model) }
    private var visible: [DocPage] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? pages : pages.filter { $0.title.lowercased().contains(q) || $0.markdown.lowercased().contains(q) }
    }
    private var current: DocPage? { pages.first { $0.slug == model.docsPage } ?? pages.first }

    var body: some View {
        HSplitView {
            VStack(spacing: 0) {
                TextField("Search docs", text: $query).textFieldStyle(.roundedBorder).padding(8)
                List(selection: Binding(get: { current?.slug }, set: { if let s = $0 { model.docsPage = s } })) {
                    Section("Guides") { ForEach(visible.filter { !$0.isReference }) { Text($0.title).tag($0.slug) } }
                    Section("Reference") { ForEach(visible.filter { $0.isReference }) { Text($0.title).tag($0.slug) } }
                }
                .listStyle(.sidebar)
            }
            .frame(minWidth: 170, idealWidth: 200, maxWidth: 320)
            VStack(spacing: 0) {
                if showPopOut {
                    HStack {
                        Spacer()
                        Button { openWindow(value: PopoutItem.docs(current?.slug)) } label: { Label("Open in New Window", systemImage: "arrow.up.forward.square") }
                            .buttonStyle(.borderless).controlSize(.small)
                    }
                    .padding(.horizontal, 10).frame(height: 26)
                    Divider()
                }
                if let page = current {
                    DocWebView(html: MarkdownHTML.page(page.markdown), highlight: query) { model.docsPage = $0 }
                } else {
                    Text("No documentation found").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
    }
}

// MARK: Pop-out windows (docs and any file)

enum PopoutItem: Codable, Hashable {
    case docs(String?)
    case file(String)   // path
}

struct PopoutView: View {
    @ObservedObject var model: EditorModel
    let item: PopoutItem

    var body: some View {
        switch item {
        case .docs(let slug):
            DocsView(model: model, showPopOut: false)
                .onAppear { if let slug { model.docsPage = slug } }
                .frame(minWidth: 700, minHeight: 480)
        case .file(let path):
            let url = URL(fileURLWithPath: path)
            FileTabView(model: model, url: url)
                .background(Color(nsColor: .textBackgroundColor))
                .frame(minWidth: 480, minHeight: 360)
                .navigationTitle(url.lastPathComponent + ((model.textDocs[url]?.isDirty ?? false) ? " •" : ""))
                .onDisappear { model.dockFile(url) } // closing the window puts the file back in the main tab bar
        }
    }
}
