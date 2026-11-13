import Foundation
import Network

/// A tiny static file server bound to loopback. It serves two roots:
///  - `/__piston__/engine/…`   the Piston web engine, shipped inside the app (never copied into a project)
///  - `/__piston__/…`          the editor's bridge scripts (never part of a game build)
///  - `/__piston_edit.html` and `/__piston_play.html`  the runtime pages, served at the ROOT so relative
///    URLs in game code (assets, scenes) resolve against the project, exactly like an exported build
///  - everything else          the open project's folder
/// so the web runtime loads over plain HTTP (ES modules, fetch, no custom-scheme quirks).
final class HTTPServer: @unchecked Sendable {
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "piston.http")
    private let lock = NSLock()
    private var _projectRoot: URL
    let bridgeRoot: URL
    let engineRoot: URL
    private(set) var port: UInt16 = 0

    init(projectRoot: URL, bridgeRoot: URL, engineRoot: URL) {
        _projectRoot = projectRoot
        self.bridgeRoot = bridgeRoot
        self.engineRoot = engineRoot
    }

    var projectRoot: URL {
        get { lock.lock(); defer { lock.unlock() }; return _projectRoot }
        set { lock.lock(); _projectRoot = newValue; lock.unlock() }
    }

    func start() async throws -> UInt16 {
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: .any)
        let l = try NWListener(using: params)
        listener = l
        let assigned: UInt16 = try await withCheckedThrowingContinuation { cont in
            var resumed = false
            l.stateUpdateHandler = { state in
                guard !resumed else { return }
                switch state {
                case .ready:
                    resumed = true
                    cont.resume(returning: l.port?.rawValue ?? 0)
                case .failed(let error):
                    resumed = true
                    cont.resume(throwing: error)
                default:
                    break
                }
            }
            l.newConnectionHandler = { [weak self] connection in self?.handle(connection) }
            l.start(queue: queue)
        }
        port = assigned
        return assigned
    }

    func stop() { listener?.cancel() }

    // MARK: Connections

    private func handle(_ c: NWConnection) {
        c.start(queue: queue)
        c.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, _, _ in
            guard let self, let data, let text = String(data: data, encoding: .utf8) else { c.cancel(); return }
            let first = text.split(separator: "\r\n", maxSplits: 1).first.map(String.init) ?? ""
            let parts = first.split(separator: " ")
            guard parts.count >= 2 else { self.send(c, 400, "Bad Request", "text/plain", Data("bad request".utf8)); return }
            let method = String(parts[0])
            guard method == "GET" || method == "HEAD" else {
                self.send(c, 405, "Method Not Allowed", "text/plain", Data("GET only".utf8)); return
            }
            self.serve(path: String(parts[1]), head: method == "HEAD", on: c)
        }
    }

    private func serve(path rawPath: String, head: Bool, on c: NWConnection) {
        let pathOnly = rawPath.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? rawPath
        guard let decoded = pathOnly.removingPercentEncoding else {
            send(c, 400, "Bad Request", "text/plain", Data("bad path".utf8), head: head); return
        }
        let base: URL
        var rel: String
        if decoded == "/__piston_edit.html" || decoded == "/__piston_play.html" {
            base = bridgeRoot
            rel = decoded == "/__piston_edit.html" ? "edit.html" : "play.html"
        } else if decoded.hasPrefix("/__piston__/engine/") {
            base = engineRoot
            rel = String(decoded.dropFirst("/__piston__/engine/".count))
        } else if decoded.hasPrefix("/__piston__/") {
            base = bridgeRoot
            rel = String(decoded.dropFirst("/__piston__/".count))
        } else {
            base = projectRoot
            rel = String(decoded.dropFirst())
        }
        if rel.isEmpty { rel = "index.html" }

        let root = base.standardizedFileURL
        let file = root.appendingPathComponent(rel).standardizedFileURL
        // Never serve anything outside the chosen root ("../" tricks, absolute paths).
        guard file.path == root.path || file.path.hasPrefix(root.path + "/") else {
            send(c, 403, "Forbidden", "text/plain", Data("forbidden".utf8), head: head); return
        }
        guard let body = try? Data(contentsOf: file) else {
            send(c, 404, "Not Found", "text/plain", Data("not found: \(decoded)".utf8), head: head); return
        }
        send(c, 200, "OK", Self.mime(for: file.pathExtension), body, head: head)
    }

    private func send(_ c: NWConnection, _ status: Int, _ reason: String, _ mime: String, _ body: Data, head: Bool = false) {
        let header = "HTTP/1.1 \(status) \(reason)\r\nContent-Type: \(mime)\r\nContent-Length: \(body.count)\r\n"
            + "Cache-Control: no-store, max-age=0\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\n\r\n"
        var out = Data(header.utf8)
        if !head { out.append(body) }
        c.send(content: out, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in c.cancel() })
    }

    static func mime(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "mp3": return "audio/mpeg"
        case "wav": return "audio/wav"
        case "ogg": return "audio/ogg"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        case "wasm": return "application/wasm"
        default: return "application/octet-stream"
        }
    }
}
