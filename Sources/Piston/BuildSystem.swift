import Foundation
import CryptoKit
import JavaScriptCore

enum BuildMode: String, Sendable {
    case development
    case release
}

struct BuildMessage: Identifiable, Sendable {
    enum Level: Sendable { case info, warning, error }
    let id = UUID()
    var level: Level
    var text: String
}

struct BuildReport: Sendable {
    var mode: BuildMode
    var messages: [BuildMessage] = []
    var outputURL: URL?
    var fileCount = 0
    var bytes = 0
    var seconds = 0.0

    var errors: [BuildMessage] { messages.filter { $0.level == .error } }
    var warnings: [BuildMessage] { messages.filter { $0.level == .warning } }
    var ok: Bool { errors.isEmpty && outputURL != nil }
}

/// Turns a Piston project into a static web build (see docs/BUILD.md).
///  - Development: readable ES modules + import map; instant, debuggable.
///  - Release: one bundled, minified (optionally obfuscated) file with scenes inlined. Needs the JS toolchain.
final class BuildSystem: @unchecked Sendable {
    let project: URL
    let engineRoot: URL
    let templatesRoot: URL
    /// Test hooks (also let a developer point at their own tools).
    var esbuildOverride: URL?
    var obfuscatorOverride: URL?
    /// Overrides the project's configured obfuscation level ("off", "light", "medium", "heavy").
    var obfuscationOverride: String?
    /// Editor plugins that export `afterBundle(code, ctx)`: they get the finished release bundle before it is obfuscated.
    var afterBundleHooks: [(name: String, source: String)] = []

    private let fm = FileManager.default
    private var name = "Game"
    private var entry = "/scripts/GameContent.js"
    private var scenesDir = "scenes"
    private var startScene: String?
    private var configuredOrder: [String] = []
    private var outDir = "dist/web"
    private var obfuscation = "medium"
    private var title = "Game"
    /// The design resolution (project.piston.json "resolution"): exported games render at this size and letterbox to fit the window,
    /// exactly like the editor's Game view.
    private var resolution = (width: 800, height: 600)

    init(project: URL, engineRoot: URL, templatesRoot: URL) {
        self.project = project
        self.engineRoot = engineRoot
        self.templatesRoot = templatesRoot
        if let data = try? Data(contentsOf: project.appendingPathComponent("project.piston.json")),
           let cfg = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            name = cfg["name"] as? String ?? project.lastPathComponent
            entry = cfg["entry"] as? String ?? entry
            scenesDir = cfg["scenesDir"] as? String ?? scenesDir
            startScene = cfg["startScene"] as? String
            configuredOrder = cfg["sceneOrder"] as? [String] ?? []
            if let r = cfg["resolution"] as? [String: Any], let w = (r["width"] as? NSNumber)?.intValue, let h = (r["height"] as? NSNumber)?.intValue, w >= 16, h >= 16 { resolution = (w, h) }
            title = name
            if let web = (cfg["build"] as? [String: Any])?["web"] as? [String: Any] {
                outDir = web["outDir"] as? String ?? outDir
                obfuscation = web["obfuscation"] as? String ?? obfuscation
                title = web["title"] as? String ?? title
            }
        } else {
            name = project.lastPathComponent
            title = name
        }
    }

    static func toolchainURL(_ name: String) -> URL? {
        let candidates: [URL?] = [
            Bundle.main.resourceURL?.appendingPathComponent("Toolchain/\(name)"),
            URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
                .appendingPathComponent("Toolchain/\(name)"),
        ]
        return candidates.compactMap { $0 }.first { FileManager.default.fileExists(atPath: $0.path) }
    }

    // MARK: Entry point

    func build(mode: BuildMode) -> BuildReport {
        let started = Date()
        var report = BuildReport(mode: mode)
        func note(_ level: BuildMessage.Level, _ text: String) { report.messages.append(BuildMessage(level: level, text: text)) }

        note(.info, "Building \(name) for web (\(mode.rawValue))")
        guard let validated = validate(&report) else {
            report.seconds = Date().timeIntervalSince(started)
            return report
        }
        let out = project.appendingPathComponent(outDir, isDirectory: true)
        do {
            try? fm.removeItem(at: out)
            try fm.createDirectory(at: out, withIntermediateDirectories: true)
            switch mode {
            case .development: try buildDevelopment(into: out, validated: validated, report: &report)
            case .release: try buildRelease(into: out, validated: validated, report: &report)
            }
        } catch {
            note(.error, "Build failed: \(error.localizedDescription)")
        }
        if report.errors.isEmpty {
            report.outputURL = out
            (report.fileCount, report.bytes) = measure(out)
            note(.info, "Wrote \(report.fileCount) files (\(Self.sizeString(report.bytes))) to \((out.path as NSString).abbreviatingWithTildeInPath)")
        }
        report.seconds = Date().timeIntervalSince(started)
        return report
    }

    static func sizeString(_ bytes: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }

    private func measure(_ dir: URL) -> (Int, Int) {
        var files = 0, bytes = 0
        if let walker = fm.enumerator(at: dir, includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey]) {
            for case let url as URL in walker {
                let v = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
                if v?.isRegularFile == true { files += 1; bytes += v?.fileSize ?? 0 }
            }
        }
        return (files, bytes)
    }

    // MARK: Validate

    struct Validated {
        var scenes: [String: [String: Any]]
        var sceneOrder: [String]
        var start: String
        var entryURL: URL
        var manifestURL: URL?
    }

    private static let importRegex = try! NSRegularExpression(
        pattern: #"(?:^|\n)[ \t]*(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]"#)
    private static let registerRegex = try! NSRegularExpression(
        pattern: #"(?:EntityRegistry|ComponentRegistry)\.register\(\s*['"]([^'"]+)['"]"#)

    private func jsFiles(under dir: URL, skipping skip: Set<String> = ["dist", ".git", ".piston", "node_modules", "plugins"]) -> [URL] {
        var out: [URL] = []
        guard let items = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.isDirectoryKey]) else { return [] }
        for url in items where !skip.contains(url.lastPathComponent) && !url.lastPathComponent.hasPrefix(".") {
            let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            if isDir { out += jsFiles(under: url, skipping: skip) } else if url.pathExtension == "js" { out.append(url) }
        }
        return out
    }

    private func rel(_ url: URL) -> String {
        let p = url.standardizedFileURL.path, base = project.standardizedFileURL.path + "/"
        return p.hasPrefix(base) ? String(p.dropFirst(base.count)) : p
    }

    private func imports(of file: URL) -> [String] {
        guard let text = try? String(contentsOf: file, encoding: .utf8) else { return [] }
        let range = NSRange(text.startIndex..., in: text)
        return Self.importRegex.matches(in: text, range: range).compactMap {
            Range($0.range(at: 1), in: text).map { String(text[$0]) }
        }
    }

    private func registeredNames(in files: [URL]) -> Set<String> {
        var names = Set<String>()
        for f in files {
            guard let text = try? String(contentsOf: f, encoding: .utf8) else { continue }
            for m in Self.registerRegex.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
                if let r = Range(m.range(at: 1), in: text) { names.insert(String(text[r])) }
            }
        }
        return names
    }

    private func validate(_ report: inout BuildReport) -> Validated? {
        func note(_ level: BuildMessage.Level, _ text: String) { report.messages.append(BuildMessage(level: level, text: text)) }
        let startErrors = report.errors.count

        // Descriptor, entry, scenes
        guard fm.fileExists(atPath: project.appendingPathComponent("project.piston.json").path) else {
            note(.error, "project.piston.json not found. Is this a Piston project folder?")
            return nil
        }
        let entryURL = project.appendingPathComponent(String(entry.drop(while: { $0 == "/" })))
        if !fm.fileExists(atPath: entryURL.path) { note(.error, "Entry module \(entry) doesn't exist. Create it, or fix \"entry\" in project.piston.json.") }

        let scenesURL = project.appendingPathComponent(scenesDir)
        let sceneFiles = ((try? fm.contentsOfDirectory(atPath: scenesURL.path)) ?? []).filter { $0.hasSuffix(".json") }.sorted()
        var scenes: [String: [String: Any]] = [:]
        for file in sceneFiles {
            let id = String(file.dropLast(5))
            let url = scenesURL.appendingPathComponent(file)
            guard let data = try? Data(contentsOf: url), let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                note(.error, "\(scenesDir)/\(file) isn't valid JSON.")
                continue
            }
            if obj["entities"] as? [Any] == nil { note(.error, "\(scenesDir)/\(file) has no \"entities\" list.") }
            scenes[id] = obj
        }
        if scenes.isEmpty { note(.error, "The project has no scenes in \(scenesDir)/. Create one first.") }
        var start = startScene ?? ""
        if scenes[start] == nil {
            if let s = startScene { note(.warning, "Start scene \"\(s)\" doesn't exist; using \"\(sceneFiles.first.map { String($0.dropLast(5)) } ?? "")\".") }
            start = sceneFiles.first.map { String($0.dropLast(5)) } ?? ""
        }

        // Import graph from the entry module (project files only; engine files just have to exist)
        var visited = Set<String>()
        var queue = fm.fileExists(atPath: entryURL.path) ? [entryURL] : []
        let manifest = scenesURL.appendingPathComponent("index.js")
        let hasManifest = fm.fileExists(atPath: manifest.path)
        if hasManifest { queue.append(manifest) }
        while let file = queue.popLast() {
            let key = file.standardizedFileURL.path
            guard visited.insert(key).inserted else { continue }
            for spec in imports(of: file) {
                if spec.hasPrefix("@piston/") {
                    let target = engineRoot.appendingPathComponent(String(spec.dropFirst("@piston/".count)))
                    if !fm.fileExists(atPath: target.path) { note(.error, "\(rel(file)): can't find the engine module \"\(spec)\".") }
                } else if spec.hasPrefix(".") || spec.hasPrefix("/") {
                    let target = (spec.hasPrefix("/") ? project.appendingPathComponent(String(spec.dropFirst()))
                                                      : file.deletingLastPathComponent().appendingPathComponent(spec)).standardizedFileURL
                    if fm.fileExists(atPath: target.path) { queue.append(target) }
                    else { note(.error, "\(rel(file)): can't find \"\(spec)\" (imported here).") }
                } else if !spec.hasPrefix("http") {
                    note(.warning, "\(rel(file)): \"\(spec)\" is a bare package import; Piston projects can't use npm packages yet.")
                }
            }
        }
        let projectFiles = jsFiles(under: project)
        for f in projectFiles where !visited.contains(f.standardizedFileURL.path) {
            note(.warning, "\(rel(f)) isn't imported by the entry module, so it won't be part of the game.")
        }
        if hasManifest && !visited.contains(manifest.standardizedFileURL.path) { /* queued above, so always visited */ }

        // Types and assets used by scenes
        var known = registeredNames(in: projectFiles)
        if let engineFiles = fm.enumerator(at: engineRoot, includingPropertiesForKeys: nil) {
            known.formUnion(registeredNames(in: engineFiles.compactMap { ($0 as? URL).flatMap { $0.pathExtension == "js" ? $0 : nil } }))
        }
        for id in scenes.keys.sorted() {
            guard let entities = scenes[id]?["entities"] as? [[String: Any]] else { continue }
            var unknown = Set<String>()
            for e in entities {
                if let t = e["type"] as? String, !known.contains(t) { unknown.insert(t) }
                for c in (e["components"] as? [[String: Any]] ?? []) { if let t = c["type"] as? String, !known.contains(t) { unknown.insert(t) } }
            }
            for t in unknown.sorted() {
                note(.warning, "Scene \"\(id)\" uses \"\(t)\", which no script registers. It will be skipped when the game loads.")
            }
            for path in referencedAssets(in: scenes[id] ?? [:]) where !fm.fileExists(atPath: project.appendingPathComponent(path).path) {
                note(.warning, "Scene \"\(id)\" refers to \(path), which doesn't exist.")
            }
        }

        guard report.errors.count == startErrors, fm.fileExists(atPath: entryURL.path) else { return nil }
        return Validated(scenes: scenes, sceneOrder: ProjectScenes.ordered(sceneFiles.map { String($0.dropLast(5)) }, configured: configuredOrder), start: start, entryURL: entryURL,
                         manifestURL: hasManifest ? manifest : nil)
    }

    /// Strings in scene data that look like project-relative file paths ("./assets/x.png").
    private func referencedAssets(in value: Any) -> Set<String> {
        var found = Set<String>()
        func walk(_ v: Any) {
            if let s = v as? String, s.hasPrefix("./"), s.contains("."), !s.contains(" ") { found.insert(String(s.dropFirst(2))) }
            else if let d = v as? [String: Any] { d.values.forEach(walk) }
            else if let a = v as? [Any] { a.forEach(walk) }
        }
        walk(value)
        return found
    }

    // MARK: Development build

    private func template(_ replacements: [String: String]) throws -> String {
        var html = try String(contentsOf: templatesRoot.appendingPathComponent("export/web/index.html"), encoding: .utf8)
        for (k, v) in replacements { html = html.replacingOccurrences(of: "{{\(k)}}", with: v) }
        return html
    }

    private func jsArray(_ items: [String]) -> String { "[" + items.map { jsString($0) }.joined(separator: ", ") + "]" }

    private func jsString(_ s: String) -> String {
        // A JSON string is a valid JS string literal; keep slashes readable ("./scripts/x.js", not ".\/scripts\/x.js").
        guard let data = try? JSONSerialization.data(withJSONObject: [s], options: [.withoutEscapingSlashes]),
              let text = String(data: data, encoding: .utf8) else { return "\"\(s)\"" }
        return String(text.dropFirst().dropLast())
    }

    private func copyProjectContent(into out: URL, only: Set<String>? = nil) throws {
        let skip: Set<String> = [".git", ".piston", ".DS_Store", ".gitignore", "project.piston.json", "dist", "node_modules", "plugins"]
        for item in try fm.contentsOfDirectory(at: project, includingPropertiesForKeys: nil) where !skip.contains(item.lastPathComponent) {
            if let only, !only.contains(item.lastPathComponent) { continue }
            try fm.copyItem(at: item, to: out.appendingPathComponent(item.lastPathComponent))
        }
        // The painter's layer sidecars are editor data, not game content.
        if let walker = fm.enumerator(at: out, includingPropertiesForKeys: nil) {
            for case let file as URL in walker where file.lastPathComponent.hasSuffix(".layers.json") { try? fm.removeItem(at: file) }
        }
    }

    private func buildDevelopment(into out: URL, validated v: Validated, report: inout BuildReport) throws {
        try fm.copyItem(at: engineRoot, to: out.appendingPathComponent("engine"))
        try copyProjectContent(into: out)

        let entryRel = "./" + String(entry.drop(while: { $0 == "/" }))
        var main = "import { startGame } from '@piston/Player.js';\n// Your game's scripts register their entities, components and scenes when imported.\n"
        main += "import \(jsString(entryRel));\n"
        if v.manifestURL != nil { main += "import \(jsString("./" + scenesDir + "/index.js"));\n" }
        main += "\nglobalThis.__PISTON_PROJECT__ = { scenes: \(jsString("./" + scenesDir)), prefabs: './prefabs', sceneIds: \(jsArray(v.sceneOrder)), resolution: [\(resolution.width), \(resolution.height)] };\n"
        main += "startGame({ canvas: document.getElementById('game'), startScene: \(jsString(v.start)) });\n"
        try main.write(to: out.appendingPathComponent("main.js"), atomically: true, encoding: .utf8)

        let head = "<script type=\"importmap\">{\"imports\": {\"@piston/\": \"./engine/\"}}</script>"
        try template(["TITLE": title, "HEAD": head, "ENTRY": "./main.js"])
            .write(to: out.appendingPathComponent("index.html"), atomically: true, encoding: .utf8)
        try writeManifest(into: out, mode: .development, start: v.start)
    }

    private func writeManifest(into out: URL, mode: BuildMode, start: String) throws {
        let engineVersion = (try? String(contentsOf: engineRoot.appendingPathComponent("VERSION"), encoding: .utf8))?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? "?"
        let manifest: [String: Any] = ["project": name, "platform": "web", "mode": mode.rawValue, "engine": engineVersion,
                                       "startScene": start, "built": ISO8601DateFormatter().string(from: Date())]
        try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
            .write(to: out.appendingPathComponent("piston-build.json"))
    }

    // MARK: Release build

    private func buildRelease(into out: URL, validated v: Validated, report: inout BuildReport) throws {
        func note(_ level: BuildMessage.Level, _ text: String) { report.messages.append(BuildMessage(level: level, text: text)) }
        guard let esbuild = esbuildOverride ?? Self.toolchainURL("esbuild") else {
            note(.error, "Release builds need Piston's JS toolchain (esbuild), which isn't installed yet. Use a Development build, or see docs/BUILD.md.")
            return
        }

        // Compile scenes and prefabs into one data module.
        var prefabs: [String: Any] = [:]
        let prefabDir = project.appendingPathComponent("prefabs")
        for f in ((try? fm.contentsOfDirectory(atPath: prefabDir.path)) ?? []).sorted() where f.hasSuffix(".json") {
            if let d = try? Data(contentsOf: prefabDir.appendingPathComponent(f)), let obj = try? JSONSerialization.jsonObject(with: d) {
                prefabs[String(f.dropLast(5))] = obj
            }
        }
        let dataObject: [String: Any] = ["scenes": v.scenes, "prefabs": prefabs]
        let dataJSON = try JSONSerialization.data(withJSONObject: dataObject, options: [.sortedKeys])

        // esbuild only ever touches a private temp folder. Piston (which has access to your project) copies the inputs in:
        // a child process reading ~/Documents, Desktop or iCloud can be stopped by a macOS privacy prompt that nobody sees.
        let scratch = fm.temporaryDirectory.appendingPathComponent("piston-release-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: scratch, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: scratch) }
        let engineCopy = scratch.appendingPathComponent("engine")
        let projectCopy = scratch.appendingPathComponent("project")
        try fm.copyItem(at: engineRoot, to: engineCopy)
        try fm.createDirectory(at: projectCopy, withIntermediateDirectories: true)
        let skip: Set<String> = [".git", ".piston", ".DS_Store", "dist", "node_modules", "assets", "plugins"]
        for item in try fm.contentsOfDirectory(at: project, includingPropertiesForKeys: nil) where !skip.contains(item.lastPathComponent) {
            try fm.copyItem(at: item, to: projectCopy.appendingPathComponent(item.lastPathComponent))
        }
        let work = scratch.appendingPathComponent("work", isDirectory: true)
        try fm.createDirectory(at: work, withIntermediateDirectories: true)
        try ("export default " + String(decoding: dataJSON, as: UTF8.self) + ";\n").write(to: work.appendingPathComponent("data.js"), atomically: true, encoding: .utf8)

        func copied(_ url: URL) -> String { projectCopy.appendingPathComponent(rel(url)).path }
        var main = "import { startGame } from '@piston/Player.js';\nimport data from './data.js';\n"
        main += "import \(jsString(copied(v.entryURL)));\n"
        if let m = v.manifestURL { main += "import \(jsString(copied(m)));\n" }
        main += "globalThis.__PISTON_PROJECT__ = { scenes: \(jsString("./" + scenesDir)), prefabs: './prefabs', sceneIds: \(jsArray(v.sceneOrder)), resolution: [\(resolution.width), \(resolution.height)] };\n"
        main += "startGame({ canvas: document.getElementById('game'), startScene: \(jsString(v.start)), data });\n"
        try main.write(to: work.appendingPathComponent("main.js"), atomically: true, encoding: .utf8)

        // Bundle + tree-shake + minify (esbuild). No source maps, no legal comments.
        let bundlePath = scratch.appendingPathComponent("bundle.js")
        let process = Process()
        process.executableURL = esbuild
        process.arguments = [work.appendingPathComponent("main.js").path, "--bundle", "--minify", "--format=iife", "--target=es2020",
                             "--alias:@piston=\(engineCopy.path)", "--outfile=\(bundlePath.path)", "--legal-comments=none", "--log-level=warning"]
        // Never inherit the app's stdin, and never read pipes while the child runs (that can deadlock): stdin/stdout go
        // to /dev/null and stderr to a temp file that is read once the process has exited.
        let errFile = scratch.appendingPathComponent("esbuild.err.txt")
        fm.createFile(atPath: errFile.path, contents: nil)
        let errHandle = try FileHandle(forWritingTo: errFile)
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = errHandle
        try process.run()
        process.waitUntilExit()
        try? errHandle.close()
        let errText = ((try? String(contentsOf: errFile, encoding: .utf8)) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard process.terminationStatus == 0, fm.fileExists(atPath: bundlePath.path) else {
            note(.error, "esbuild failed: \(errText.isEmpty ? "exit status \(process.terminationStatus)" : errText)")
            return
        }
        var code = try String(contentsOf: bundlePath, encoding: .utf8)
        note(.info, "Bundled and minified (\(Self.sizeString(code.utf8.count)))")

        if !afterBundleHooks.isEmpty {
            code = PluginHost.runAfterBundle(afterBundleHooks, code: code, mode: "release") { level, text in note(level == "warning" ? .warning : .info, text) }
        }
        code = obfuscate(code, level: obfuscationOverride ?? obfuscation, report: &report)

        let hash = SHA256.hash(data: Data(code.utf8)).prefix(5).map { String(format: "%02x", $0) }.joined()
        let bundleName = "game.\(hash).js"
        try code.write(to: out.appendingPathComponent(bundleName), atomically: true, encoding: .utf8)
        try copyProjectContent(into: out, only: ["assets"])
        try template(["TITLE": title, "HEAD": "", "ENTRY": "./\(bundleName)"])
            .write(to: out.appendingPathComponent("index.html"), atomically: true, encoding: .utf8)
        try writeManifest(into: out, mode: .release, start: v.start)
    }

    /// Runs javascript-obfuscator inside JavaScriptCore (no Node needed). Never renames object PROPERTIES: scene files
    /// store fields by name, so mangling them would break loading.
    private func obfuscate(_ code: String, level: String, report: inout BuildReport) -> String {
        func note(_ level: BuildMessage.Level, _ text: String) { report.messages.append(BuildMessage(level: level, text: text)) }
        guard level != "off" else { note(.info, "Obfuscation: off"); return code }
        guard let lib = obfuscatorOverride ?? Self.toolchainURL("obfuscator.js"), let source = try? String(contentsOf: lib, encoding: .utf8) else {
            note(.warning, "Obfuscation (\(level)) skipped: the obfuscator isn't installed yet. The bundle is minified but not obfuscated.")
            return code
        }
        guard let context = JSContext() else { return code }
        var failure: String?
        context.exceptionHandler = { _, e in failure = e?.toString() }
        // The obfuscator ships as a browser bundle: give it the globals a browser would.
        context.evaluateScript("var window = this, self = this, global = this; if (typeof console === 'undefined') { var console = { log: function(){}, warn: function(){}, error: function(){}, info: function(){} }; }")
        context.evaluateScript(source)
        guard let lib = context.objectForKeyedSubscript("JavaScriptObfuscator"), !lib.isUndefined else {
            note(.warning, "Obfuscation skipped: the obfuscator script didn't define JavaScriptObfuscator.")
            return code
        }
        var options: [String: Any] = ["compact": true, "identifierNamesGenerator": "hexadecimal", "renameGlobals": false,
                                      "renameProperties": false, "transformObjectKeys": false, "stringArray": true,
                                      "stringArrayThreshold": 0.75, "selfDefending": false, "debugProtection": false]
        if level == "medium" || level == "heavy" {
            options["stringArrayEncoding"] = ["base64"]
            options["splitStrings"] = true
            options["deadCodeInjection"] = true
            options["deadCodeInjectionThreshold"] = 0.2
        }
        if level == "heavy" {
            options["controlFlowFlattening"] = true
            options["controlFlowFlatteningThreshold"] = 0.5
            options["stringArrayEncoding"] = ["rc4"]
        }
        let result = lib.invokeMethod("obfuscate", withArguments: [code, options])
        guard failure == nil, let text = result?.invokeMethod("getObfuscatedCode", withArguments: [])?.toString(), failure == nil, text != "undefined" else {
            note(.warning, "Obfuscation failed (\(failure ?? "no result")); using the minified bundle instead.")
            return code
        }
        note(.info, "Obfuscated (\(level)): \(Self.sizeString(text.utf8.count))")
        return text
    }
}

/// Scene order: scenes listed in project.piston.json "sceneOrder" first, then the rest in natural order (hole2 before hole10).
enum ProjectScenes {
    static func ordered(_ ids: [String], configured: [String]) -> [String] {
        let known = Set(ids)
        let first = configured.filter { known.contains($0) }
        let rest = ids.filter { !first.contains($0) }.sorted { $0.localizedStandardCompare($1) == .orderedAscending }
        return first + rest
    }
}
