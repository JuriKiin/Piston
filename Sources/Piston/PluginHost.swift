import SwiftUI
import AppKit
import JavaScriptCore
import CoreText

/// Editor plugins (v1). A plugin is a folder with `piston-plugin.json` and a JS/TS entry, in the project's `plugins/` or
/// in ~/Library/Application Support/Piston/Plugins. Each runs in its own JavaScriptCore context with NO file, network or
/// process access of its own: it only gets the `piston` object below. Scene changes go through `scene.edit`, which is one
/// undo step. Project plugins need a one-time trust confirmation because they are code.
struct PluginInfo: Identifiable {
    enum State: Equatable { case needsTrust, enabled, failed(String) }
    var id: String
    var name: String
    var version: String
    var directory: URL
    var main: String
    var isGlobal: Bool
    var menus: [(title: String, command: String)]
    var hasBuildHook: Bool = false
    var network: [String] = []       // hosts the plugin may fetch from (https only)
    var write: [String] = []         // project folders the plugin may write into
    var isBuiltIn = false
    var state: State

    var permissionSummary: String {
        var lines: [String] = []
        if !network.isEmpty { lines.append("• Download from: \(network.joined(separator: ", "))") }
        if !write.isEmpty { lines.append("• Write files into: \(write.joined(separator: ", "))") }
        return lines.joined(separator: "\n")
    }
}

/// Wraps a JS callback so a URLSession completion can carry it back to the main thread.
final class JSBox: @unchecked Sendable {
    let value: JSValue
    init(_ value: JSValue) { self.value = value }
}

struct PluginMenuItem: Identifiable {
    var id: String { "\(pluginID)/\(command)" }
    let pluginID: String
    let title: String
    let command: String
}

@MainActor
final class PluginHost: ObservableObject {
    unowned let model: EditorModel
    @Published private(set) var plugins: [PluginInfo] = [] { didSet { onChange?() } }
    /// The app's menus are built from the editor model, which doesn't observe this object: tell it when plugins change.
    var onChange: (() -> Void)?
    var defaults: UserDefaults = .standard   // the self-test swaps in a scratch store so it never touches the user's approvals
    private var contexts: [String: JSContext] = [:]
    /// Bundled JS of plugins that export `afterBundle`, handed to release builds.
    private(set) var buildHooks: [(name: String, source: String)] = []
    private static let trustKey = "pistonTrustedPlugins"

    init(model: EditorModel) { self.model = model }

    static var globalDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Piston/Plugins")
    }

    var menuItems: [PluginMenuItem] {
        plugins.filter { $0.state == .enabled }.flatMap { p in p.menus.map { PluginMenuItem(pluginID: p.id, title: $0.title, command: $0.command) } }
    }

    // MARK: Discovery

    /// Plugins shipped inside Piston (Resources/Plugins, or the repo's Plugins folder when running from source).
    static var builtInDirectory: URL {
        if let res = Bundle.main.resourceURL?.appendingPathComponent("Plugins"), FileManager.default.fileExists(atPath: res.path) { return res }
        return URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Plugins")
    }

    /// Re-reads every plugin folder and re-activates the approved ones. Plugins are plain JS, so this never needs a Piston restart.
    func reload(announce: Bool = false) {
        discover()
        if announce {
            let active = plugins.filter { $0.state == .enabled }.count
            let failed = plugins.filter { if case .failed = $0.state { return true } else { return false } }.count
            model.status = failed > 0 ? "Plugins reloaded: \(failed) failed (see Console)" : "Plugins reloaded (\(active) active)"
        }
    }

    private var globalWatcher: FileWatcher?
    private var reloadTask: Task<Void, Never>?

    /// Watches the global plugins folder so a plugin you are writing there reloads as you save it.
    private func watchGlobalFolder() {
        guard globalWatcher == nil else { return }
        try? FileManager.default.createDirectory(at: Self.globalDirectory, withIntermediateDirectories: true)
        globalWatcher = FileWatcher(path: Self.globalDirectory.path) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.reloadTask?.cancel()
                self.reloadTask = Task { try? await Task.sleep(nanoseconds: 400_000_000); if !Task.isCancelled { self.reload(announce: true) } }
            }
        }
    }

    // MARK: Creating a plugin

    /// Scaffolds `plugins/<name>/` in the open project with a working example command, approves it (you just wrote it), and returns the entry file.
    @discardableResult
    func createPlugin(named name: String) throws -> URL {
        guard let project = model.projectURL else { throw NSError(domain: "Piston", code: 10, userInfo: [NSLocalizedDescriptionKey: "Open a project first"]) }
        let title = name.trimmingCharacters(in: .whitespaces)
        let slug = title.lowercased().map { $0.isLetter || $0.isNumber ? String($0) : "-" }.joined().split(separator: "-").joined(separator: "-")
        guard !slug.isEmpty else { throw NSError(domain: "Piston", code: 11, userInfo: [NSLocalizedDescriptionKey: "Give the plugin a name"]) }
        let dir = project.appendingPathComponent("plugins/\(slug)")
        guard !FileManager.default.fileExists(atPath: dir.path) else { throw NSError(domain: "Piston", code: 12, userInfo: [NSLocalizedDescriptionKey: "plugins/\(slug) already exists"]) }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let id = "local.\(slug)"
        let manifest = """
        {
          "name": "\(title.replacingOccurrences(of: "\"", with: ""))",
          "id": "\(id)",
          "version": "0.1.0",
          "main": "index.js",
          "contributes": {
            "menus": [
              { "title": "\(title.replacingOccurrences(of: "\"", with: "")): Say Hello", "command": "hello" }
            ]
          }
        }

        """
        let entry = """
        // \(title): a Piston plugin. Save this file and the Plugins menu updates; no restart needed.
        // Docs: Help > Guides > Plugins. Use console.log(...) to print to the Console (source "plugin").
        export default {
          activate(piston) {
            piston.commands.register('hello', (ctx) => {
              const names = piston.scene.entities().map((e) => e.name || e.tag);
              console.log(`Scene has ${names.length} entities: ${names.join(', ')}`);
              piston.notify(`Hello! ${ctx.selection.length} selected`);

              // To change the scene, edit a copy inside piston.scene.edit (one undo step):
              // piston.scene.edit('Nudge selection', (scene) => {
              //   for (const e of scene.entities) if (ctx.selection.includes(e.sceneKey)) e.transform.position.x += 10;
              // });
            });
          },
        };

        """
        try manifest.write(to: dir.appendingPathComponent("piston-plugin.json"), atomically: true, encoding: .utf8)
        try entry.write(to: dir.appendingPathComponent("index.js"), atomically: true, encoding: .utf8)
        model.refreshFileTree()
        discover()
        trust(id)   // you wrote it, so no approval prompt
        return dir.appendingPathComponent("index.js")
    }

    func discover() {
        watchGlobalFolder()
        model.pluginDialog = nil   // a dialog belongs to the plugin instance that is about to be replaced
        contexts = [:]; buildHooks = []
        var found: [PluginInfo] = []
        var roots: [(URL, Bool, Bool)] = [(Self.builtInDirectory, true, true), (Self.globalDirectory, true, false)]   // (folder, isGlobal, isBuiltIn)
        if let project = model.projectURL { roots.insert((project.appendingPathComponent("plugins"), false, false), at: 0) }
        for (root, isGlobal, builtIn) in roots {
            let dirs = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])) ?? []
            for dir in dirs.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
                guard let data = try? Data(contentsOf: dir.appendingPathComponent("piston-plugin.json")),
                      let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { continue }
                let name = json["name"] as? String ?? dir.lastPathComponent
                let id = json["id"] as? String ?? dir.lastPathComponent
                if found.contains(where: { $0.id == id }) { continue }   // a project plugin overrides a global one with the same id
                let menus = ((json["contributes"] as? [String: Any])?["menus"] as? [[String: Any]] ?? []).compactMap { m -> (String, String)? in
                    guard let t = m["title"] as? String, let c = m["command"] as? String else { return nil }
                    return (t, c)
                }
                let perms = json["permissions"] as? [String: Any]
                var info = PluginInfo(id: id, name: name, version: json["version"] as? String ?? "0", directory: dir,
                                      main: json["main"] as? String ?? "index.js", isGlobal: isGlobal, menus: menus.map { (title: $0.0, command: $0.1) }, state: .needsTrust)
                info.network = perms?["network"] as? [String] ?? []
                info.write = (perms?["write"] as? [String] ?? []).map { $0.hasPrefix("./") ? String($0.dropFirst(2)) : $0 }
                info.isBuiltIn = builtIn
                // Project plugins and anything that can reach the network or write files must be approved once.
                let needsApproval = !isGlobal || !info.network.isEmpty || !info.write.isEmpty
                info.state = !needsApproval || isTrusted(id, global: isGlobal) ? .enabled : .needsTrust
                found.append(info)
            }
        }
        plugins = found
        for i in plugins.indices where plugins[i].state == .enabled { activate(i) }
    }

    /// Project plugins are trusted per project; global and built-in ones once for every project.
    private func trustToken(_ id: String, global: Bool) -> String { "\(global ? "global" : (model.projectURL?.path ?? ""))::\(id)" }
    private func isTrusted(_ id: String, global: Bool) -> Bool { (defaults.stringArray(forKey: Self.trustKey) ?? []).contains(trustToken(id, global: global)) }

    func trust(_ id: String) {
        let global = plugins.first { $0.id == id }?.isGlobal ?? false
        var list = defaults.stringArray(forKey: Self.trustKey) ?? []
        if !list.contains(trustToken(id, global: global)) { list.append(trustToken(id, global: global)); defaults.set(list, forKey: Self.trustKey) }
        if let i = plugins.firstIndex(where: { $0.id == id }) {
            plugins[i].state = .enabled; activate(i)
            if case .enabled = plugins[i].state, let first = plugins[i].menus.first {
                model.status = "Enabled \(plugins[i].name). Open it from Plugins ▸ \(first.title)"
            }
        }
    }

    /// Asks once before running a project's plugin, then remembers the answer for that project.
    func confirmTrust(_ id: String) {
        guard let p = plugins.first(where: { $0.id == id }) else { return }
        let alert = NSAlert()
        alert.messageText = "Enable the plugin \"\(p.name)\"?"
        let perms = p.permissionSummary
        alert.informativeText = "Plugins are code. This one can read and change the open scene and run during builds."
            + (perms.isEmpty ? " It can't touch files, the network or other programs." : "\n\nIt asks for permission to:\n\(perms)\n\nIt can do nothing else with files or the network.")
        alert.addButton(withTitle: "Enable")
        alert.addButton(withTitle: "Cancel")
        if alert.runModal() == .alertFirstButtonReturn { trust(id) }
    }

    // MARK: Loading

    private func log(_ level: String, _ text: String, plugin: String) {
        model.logs.append(LogLine(level: level, text: "[\(plugin)] \(text)", source: "plugin"))
    }

    private func activate(_ index: Int) {
        let info = plugins[index]
        do {
            let code = try Self.bundle(info)
            let ctx = JSContext()!
            ctx.exceptionHandler = { [weak self] _, e in Task { @MainActor in self?.log("error", e?.toString() ?? "script error", plugin: info.name) } }
            install(into: ctx, plugin: info)
            ctx.evaluateScript(Self.prelude)
            ctx.evaluateScript(code)
            ctx.evaluateScript("var __mod = (typeof __piston_plugin !== 'undefined' && (__piston_plugin.default || __piston_plugin)) || {}; if (__mod.activate) __mod.activate(piston);")
            if let e = ctx.exception { throw NSError(domain: "Piston", code: 1, userInfo: [NSLocalizedDescriptionKey: e.toString() ?? "activation failed"]) }
            contexts[info.id] = ctx
            if ctx.evaluateScript("typeof __mod.afterBundle === 'function'").toBool() { buildHooks.append((info.name, code)); plugins[index].hasBuildHook = true }
        } catch {
            plugins[index].state = .failed(error.localizedDescription)
            log("error", "couldn't load: \(error.localizedDescription)", plugin: info.name)
        }
    }

    /// Compiles the plugin (TypeScript, imports and all) into one self-contained script with the bundled esbuild.
    nonisolated static func bundle(_ info: PluginInfo) throws -> String {
        let entry = info.directory.appendingPathComponent(info.main)
        guard FileManager.default.fileExists(atPath: entry.path) else {
            throw NSError(domain: "Piston", code: 2, userInfo: [NSLocalizedDescriptionKey: "\(info.main) not found"])
        }
        guard let esbuild = BuildSystem.toolchainURL("esbuild") else {
            throw NSError(domain: "Piston", code: 3, userInfo: [NSLocalizedDescriptionKey: "Piston's JS toolchain (esbuild) isn't installed"])
        }
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("piston-plugin-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }
        let outFile = tmp.appendingPathComponent("plugin.js"), errFile = tmp.appendingPathComponent("err.txt")
        FileManager.default.createFile(atPath: errFile.path, contents: nil)
        let process = Process()
        process.executableURL = esbuild
        process.arguments = [entry.path, "--bundle", "--format=iife", "--global-name=__piston_plugin", "--target=es2020", "--platform=neutral",
                             "--outfile=\(outFile.path)", "--log-level=error"]
        let err = try FileHandle(forWritingTo: errFile)
        process.standardInput = FileHandle.nullDevice; process.standardOutput = FileHandle.nullDevice; process.standardError = err
        try process.run(); process.waitUntilExit(); try? err.close()
        guard process.terminationStatus == 0, let code = try? String(contentsOf: outFile, encoding: .utf8) else {
            let text = ((try? String(contentsOf: errFile, encoding: .utf8)) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            throw NSError(domain: "Piston", code: 4, userInfo: [NSLocalizedDescriptionKey: text.isEmpty ? "build failed" : text])
        }
        return code
    }

    // MARK: Native API

    private func install(into ctx: JSContext, plugin: PluginInfo) {
        let name = plugin.name
        let native = JSValue(newObjectIn: ctx)!
        let logBlock: @convention(block) (String, String) -> Void = { [weak self] level, text in
            MainActor.assumeIsolated { self?.log(level, text, plugin: name) }
        }
        let sceneBlock: @convention(block) () -> String = { [weak self] in
            MainActor.assumeIsolated {
                guard let self, let data = try? JSONSerialization.data(withJSONObject: self.model.doc), let s = String(data: data, encoding: .utf8) else { return "{}" }
                return s
            }
        }
        let selectionBlock: @convention(block) () -> String = { [weak self] in
            MainActor.assumeIsolated {
                let keys = self.map { Array($0.model.selectedKeys).sorted() } ?? []
                return (try? String(data: JSONSerialization.data(withJSONObject: keys), encoding: .utf8)) ?? "[]"
            }
        }
        let setSceneBlock: @convention(block) (String, String) -> Void = { [weak self] _, json in
            MainActor.assumeIsolated { self?.applyScene(json, plugin: name) }
        }
        let selectBlock: @convention(block) (String) -> Void = { [weak self] json in
            MainActor.assumeIsolated {
                guard let self, let keys = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String] else { return }
                self.model.select(keys.first)
                self.model.extraSelection = Set(keys.dropFirst())
            }
        }
        let notifyBlock: @convention(block) (String) -> Void = { [weak self] text in MainActor.assumeIsolated { self?.model.status = text } }
        let readBlock: @convention(block) (String) -> String = { [weak self] rel in
            MainActor.assumeIsolated {
                guard let root = self?.model.projectURL?.resolvingSymlinksInPath() else { return "" }
                let file = root.appendingPathComponent(rel).resolvingSymlinksInPath()
                guard file.path.hasPrefix(root.path + "/"), let text = try? String(contentsOf: file, encoding: .utf8) else { return "" } // inside the project only
                return text
            }
        }
        // ---- Network and file writes: only the hosts and folders the manifest declared (and the user approved).
        let hosts = Set(plugin.network), writeDirs = plugin.write
        let fetchBlock: @convention(block) (String, JSValue) -> Void = { urlString, cb in
            let box = JSBox(cb)
            func fail(_ message: String) { DispatchQueue.main.async { _ = box.value.call(withArguments: [message, NSNull()]) } }
            guard let url = URL(string: urlString), url.scheme == "https", let host = url.host, hosts.contains(host) else {
                fail("Network access to \(URL(string: urlString)?.host ?? urlString) is not allowed. Declare it under permissions.network in piston-plugin.json."); return
            }
            URLSession.shared.dataTask(with: url) { data, response, error in
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                if let error { fail(error.localizedDescription) }
                else if status / 100 != 2 { fail("HTTP \(status) for \(urlString)") }
                else { let text = String(decoding: data ?? Data(), as: UTF8.self); DispatchQueue.main.async { _ = box.value.call(withArguments: [NSNull(), text]) } }
            }.resume()
        }
        let downloadBlock: @convention(block) (String, String, JSValue) -> Void = { [weak self] urlString, relPath, cb in
            let box = JSBox(cb)
            func fail(_ message: String) { DispatchQueue.main.async { _ = box.value.call(withArguments: [message]) } }
            guard let url = URL(string: urlString), url.scheme == "https", let host = url.host, hosts.contains(host) else {
                fail("Network access to \(URL(string: urlString)?.host ?? urlString) is not allowed."); return
            }
            let dest: URL? = MainActor.assumeIsolated { self?.writableURL(relPath, dirs: writeDirs) }
            guard let dest else { fail("Writing to \(relPath) is not allowed. Declare its folder under permissions.write."); return }
            URLSession.shared.downloadTask(with: url) { tmp, response, error in
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                guard let tmp, error == nil, status / 100 == 2 else { fail(error?.localizedDescription ?? "HTTP \(status) for \(urlString)"); return }
                let size = (try? FileManager.default.attributesOfItem(atPath: tmp.path)[.size] as? Int) ?? 0
                guard size <= 40_000_000 else { fail("File is larger than 40 MB"); return }
                do {
                    try FileManager.default.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try? FileManager.default.removeItem(at: dest)
                    try FileManager.default.moveItem(at: tmp, to: dest)
                    DispatchQueue.main.async { _ = box.value.call(withArguments: [NSNull()]) }
                } catch { fail(error.localizedDescription) }
            }.resume()
        }
        let writeBlock: @convention(block) (String, String) -> Bool = { [weak self] relPath, text in
            MainActor.assumeIsolated {
                guard let dest = self?.writableURL(relPath, dirs: writeDirs) else { return false }
                do {
                    try FileManager.default.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try text.write(to: dest, atomically: true, encoding: .utf8)
                    return true
                } catch { return false }
            }
        }
        let existsBlock: @convention(block) (String) -> Bool = { [weak self] rel in
            MainActor.assumeIsolated {
                guard let root = self?.model.projectURL?.resolvingSymlinksInPath() else { return false }
                let file = root.appendingPathComponent(rel).resolvingSymlinksInPath()
                return file.path.hasPrefix(root.path + "/") && FileManager.default.fileExists(atPath: file.path)
            }
        }
        // ---- Dialog (a native search list with a detail pane and action buttons).
        let pid = plugin.id
        let dialogOpen: @convention(block) (String, String, String, String) -> Void = { [weak self] id, title, placeholder, hint in
            MainActor.assumeIsolated {
                guard let self else { return }
                let d = PluginDialog(id: id, pluginID: pid, pluginName: name, title: title, placeholder: placeholder, hint: hint, host: self)
                d.allowedHosts = hosts
                self.model.pluginDialog = d
            }
        }
        let dialogItems: @convention(block) (String, String) -> Void = { [weak self] id, payload in
            MainActor.assumeIsolated {
                guard let d = self?.model.pluginDialog, d.id == id, let arr = (try? JSONSerialization.jsonObject(with: Data(payload.utf8))) as? [[String: Any]] else { return }
                d.items = arr.compactMap { i -> PluginDialog.Item? in
                    guard let id = i["id"] as? String else { return nil }
                    return PluginDialog.Item(id: id, title: i["title"] as? String ?? id, subtitle: i["subtitle"] as? String ?? "", raw: jsonString(of: i))
                }
            }
        }
        let dialogDetail: @convention(block) (String, String) -> Void = { [weak self] id, payload in
            MainActor.assumeIsolated {
                guard let d = self?.model.pluginDialog, d.id == id, let obj = (try? JSONSerialization.jsonObject(with: Data(payload.utf8))) as? [String: Any] else { return }
                d.detail = obj["text"] as? String ?? ""
                if let preview = obj["fontPreview"] as? [String: Any] {
                    if let sample = preview["sample"] as? String, d.previewText.isEmpty { d.previewText = sample }
                    d.loadPreview((preview["files"] as? [[String: Any]] ?? []).compactMap { f in
                        guard let url = f["url"] as? String else { return nil }
                        return (url, f["label"] as? String ?? "")
                    })
                }
                d.actions = (obj["actions"] as? [[String: Any]] ?? []).compactMap { a -> PluginDialog.Action? in
                    guard let id = a["id"] as? String else { return nil }
                    return PluginDialog.Action(id: id, title: a["title"] as? String ?? id)
                }
            }
        }
        let dialogMessage: @convention(block) (String, String, Bool) -> Void = { [weak self] id, text, isError in
            MainActor.assumeIsolated { if let d = self?.model.pluginDialog, d.id == id { d.message = text; d.isError = isError } }
        }
        let dialogBusy: @convention(block) (String, Bool) -> Void = { [weak self] id, busy in
            MainActor.assumeIsolated { if let d = self?.model.pluginDialog, d.id == id { d.busy = busy } }
        }
        native.setValue(fetchBlock, forProperty: "fetch")
        native.setValue(downloadBlock, forProperty: "download")
        native.setValue(writeBlock, forProperty: "writeText")
        native.setValue(existsBlock, forProperty: "exists")
        native.setValue(dialogOpen, forProperty: "dialogOpen")
        native.setValue(dialogItems, forProperty: "dialogItems")
        native.setValue(dialogDetail, forProperty: "dialogDetail")
        native.setValue(dialogMessage, forProperty: "dialogMessage")
        native.setValue(dialogBusy, forProperty: "dialogBusy")
        native.setValue(logBlock, forProperty: "log")
        native.setValue(sceneBlock, forProperty: "scene")
        native.setValue(selectionBlock, forProperty: "selection")
        native.setValue(setSceneBlock, forProperty: "setScene")
        native.setValue(selectBlock, forProperty: "select")
        native.setValue(notifyBlock, forProperty: "notify")
        native.setValue(readBlock, forProperty: "readText")
        ctx.setObject(native, forKeyedSubscript: "__native" as NSString)
    }

    /// A project path a plugin may write: inside one of its declared folders, no `..`.
    fileprivate func writableURL(_ rel: String, dirs: [String]) -> URL? {
        guard let root = model.projectURL else { return nil }
        let clean = rel.hasPrefix("./") ? String(rel.dropFirst(2)) : rel
        guard !clean.isEmpty, !clean.contains(".."), !clean.hasPrefix("/"), dirs.contains(where: { clean == $0 || clean.hasPrefix($0 + "/") }) else { return nil }
        return root.appendingPathComponent(clean)
    }

    /// Calls `__ui.<method>(...)` inside a plugin (dialog search / select / action).
    func callUI(_ pluginID: String, _ method: String, _ args: [Any]) {
        guard let ctx = contexts[pluginID] else { return }
        ctx.exception = nil
        _ = ctx.objectForKeyedSubscript("__ui").invokeMethod(method, withArguments: args)
        if let e = ctx.exception { log("error", "\(method): \(e.toString() ?? "failed")", plugin: plugins.first { $0.id == pluginID }?.name ?? pluginID); ctx.exception = nil }
    }

    /// Replaces the scene document with the plugin's edited copy (one undo step) and refreshes the Scene view.
    private func applyScene(_ json: String, plugin: String) {
        guard let obj = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any], obj["entities"] != nil, let id = model.currentScene else {
            log("error", "scene.edit returned something that isn't a scene (it needs an `entities` array)", plugin: plugin); return
        }
        model.doc = obj
        model.dirty = true
        Task { try? await model.sendScene(reloadFromDisk: false, id: id) }
    }

    // MARK: Running

    func run(_ item: PluginMenuItem) { run(plugin: item.pluginID, command: item.command) }

    func run(plugin id: String, command: String) {
        guard let ctx = contexts[id], let info = plugins.first(where: { $0.id == id }) else { return }
        let keys = Array(model.selectedKeys).sorted()
        let ctxArg = ["selection": keys, "scene": model.currentScene ?? ""] as [String: Any]
        ctx.exception = nil
        _ = ctx.objectForKeyedSubscript("__run").call(withArguments: [command, ctxArg])
        if let e = ctx.exception { log("error", "\(command): \(e.toString() ?? "failed")", plugin: info.name); ctx.exception = nil }
    }

    // MARK: Build hooks (run on the build's own thread, in fresh contexts)

    nonisolated static func runAfterBundle(_ hooks: [(name: String, source: String)], code: String, mode: String, report: (String, String) -> Void) -> String {
        var current = code
        for hook in hooks {
            let ctx = JSContext()!
            var failure: String?
            ctx.exceptionHandler = { _, e in failure = e?.toString() }
            ctx.evaluateScript(prelude)
            ctx.evaluateScript(hook.source)
            ctx.evaluateScript("var __mod = (typeof __piston_plugin !== 'undefined' && (__piston_plugin.default || __piston_plugin)) || {};")
            let result = ctx.evaluateScript("__mod.afterBundle")?.call(withArguments: [current, ["platform": "web", "mode": mode]])
            if let failure { report("warning", "plugin \"\(hook.name)\" afterBundle failed: \(failure)"); continue }
            if let s = result, s.isString, let text = s.toString(), !text.isEmpty { current = text; report("info", "plugin \"\(hook.name)\" processed the bundle") }
        }
        return current
    }

    nonisolated static let prelude = """
    var __commands = {};
    var console = { log: function() { __log('log', [].slice.call(arguments).map(String).join(' ')); },
                    warn: function() { __log('warn', [].slice.call(arguments).map(String).join(' ')); },
                    error: function() { __log('error', [].slice.call(arguments).map(String).join(' ')); } };
    function __log(level, text) { if (typeof __native !== 'undefined') __native.log(level, text); }
    var piston = {
      platform: 'editor',
      commands: { register: function(id, fn) { __commands[id] = fn; } },
      log: console.log,
      notify: function(text) { if (typeof __native !== 'undefined') __native.notify(String(text)); },
      scene: {
        entities: function() { return (JSON.parse(__native.scene()).entities) || []; },
        selection: function() { return JSON.parse(__native.selection()); },
        select: function(keys) { __native.select(JSON.stringify(keys || [])); },
        get: function(key) { return this.entities().filter(function(e) { return e.sceneKey === key; })[0] || null; },
        newKey: function() { return 'plugin:' + Math.random().toString(36).slice(2, 10); },
        edit: function(name, fn) { var s = JSON.parse(__native.scene()); var r = fn(s); __native.setScene(String(name), JSON.stringify(r === undefined ? s : r)); }
      },
      project: {
        readText: function(path) { return __native.readText(String(path)); },
        exists: function(path) { return __native.exists(String(path)); },
        writeText: function(path, text) { if (!__native.writeText(String(path), String(text))) throw new Error('Not allowed to write ' + path + ' (declare its folder under permissions.write)'); }
      },
      net: {
        fetchText: function(url) { return new Promise(function(resolve, reject) { __native.fetch(String(url), function(err, text) { if (err) reject(new Error(err)); else resolve(text); }); }); },
        fetchJSON: function(url) { return piston.net.fetchText(url).then(function(t) { return JSON.parse(t); }); },
        download: function(url, path) { return new Promise(function(resolve, reject) { __native.download(String(url), String(path), function(err) { if (err) reject(new Error(err)); else resolve(); }); }); }
      },
      ui: {
        // A search dialog: spec = { title, placeholder, hint, search(query) -> items, select(item) -> { text, actions }, run(actionId, item, report) }
        pick: function(spec) { var id = 'd' + (++__dialogSeq); __dialogs[id] = spec; __native.dialogOpen(id, String(spec.title || ''), String(spec.placeholder || 'Search'), String(spec.hint || '')); return id; }
      }
    };
    var __dialogs = {}, __dialogSeq = 0;
    function __settle(id, work) {
      __native.dialogBusy(id, true);
      Promise.resolve().then(work).catch(function(e) { __native.dialogMessage(id, String(e && e.message || e), true); }).then(function() { __native.dialogBusy(id, false); });
    }
    var __ui = {
      search: function(id, query) { __settle(id, function() { return Promise.resolve(__dialogs[id].search(String(query))).then(function(items) { __native.dialogItems(id, JSON.stringify(items || [])); }); }); },
      select: function(id, itemJSON) { __settle(id, function() { var s = __dialogs[id]; return s.select ? Promise.resolve(s.select(JSON.parse(itemJSON))).then(function(d) { __native.dialogDetail(id, JSON.stringify(d || {})); }) : null; }); },
      run: function(id, actionId, itemJSON) {
        __settle(id, function() {
          var report = function(text) { __native.dialogMessage(id, String(text), false); };
          return Promise.resolve(__dialogs[id].run(String(actionId), JSON.parse(itemJSON), report)).then(function(msg) { __native.dialogMessage(id, String(msg || 'Done'), false); });
        });
      }
    };
    function __run(id, ctx) { var f = __commands[id]; if (!f) throw new Error('No command registered as "' + id + '"'); return f(ctx); }
    """
}


func jsonString(of object: [String: Any]) -> String {
    (try? String(data: JSONSerialization.data(withJSONObject: object), encoding: .utf8)) ?? "{}"
}

/// The state of a plugin's search dialog (`piston.ui.pick`). The plugin's JS supplies the data; this only displays it.
@MainActor
final class PluginDialog: ObservableObject, Identifiable {
    struct Item: Identifiable, Hashable { let id: String; let title: String; let subtitle: String; let raw: String }
    struct Action: Identifiable, Hashable { let id: String; let title: String }

    let id: String
    let pluginID: String
    let pluginName: String
    let title: String
    let placeholder: String
    let hint: String
    @Published var query = ""
    @Published var items: [Item] = []
    @Published var selectedID: String?
    @Published var detail = ""
    @Published var actions: [Action] = []
    @Published var busy = false
    @Published var message = ""
    @Published var isError = false
    @Published var previewText = ""
    @Published var previewFonts: [PreviewFont] = []
    @Published var previewStatus = ""
    var allowedHosts: Set<String> = []
    private var previewToken = UUID()
    private unowned let host: PluginHost

    init(id: String, pluginID: String, pluginName: String, title: String, placeholder: String, hint: String, host: PluginHost) {
        self.id = id; self.pluginID = pluginID; self.pluginName = pluginName; self.title = title; self.placeholder = placeholder; self.hint = hint; self.host = host
    }

    var selected: Item? { items.first { $0.id == selectedID } }

    func search() { message = ""; host.callUI(pluginID, "search", [id, query]) }
    func select(_ item: Item?) {
        detail = ""; actions = []; message = ""; previewFonts = []; previewStatus = ""; previewToken = UUID()
        guard let item else { return }
        host.callUI(pluginID, "select", [id, item.raw])
    }
    /// Downloads the font files the plugin asked to preview (from its declared hosts only), registers them for this process, and shows them.
    func loadPreview(_ files: [(url: String, label: String)]) {
        let token = UUID()
        previewToken = token
        previewFonts = []
        guard !files.isEmpty else { previewStatus = ""; return }
        previewStatus = "Loading preview…"
        let hosts = allowedHosts
        Task {
            var out: [PreviewFont] = []
            for f in files {
                if let name = await Self.fetchAndRegister(f.url, hosts: hosts) { out.append(PreviewFont(label: f.label, name: name)) }
            }
            guard previewToken == token else { return }   // another family was selected meanwhile
            previewFonts = out
            previewStatus = out.isEmpty ? "Preview unavailable" : ""
        }
    }

    /// Returns the font's PostScript name once it is cached on disk and registered with CoreText, or nil.
    nonisolated static func fetchAndRegister(_ urlString: String, hosts: Set<String>) async -> String? {
        guard let url = URL(string: urlString), url.scheme == "https", let host = url.host, hosts.contains(host) else { return nil }
        let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("Piston/font-previews", isDirectory: true)
        try? FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
        let key = PixelDoc.hash(Array(urlString.utf8))
        let file = cache.appendingPathComponent("\(key).ttf")
        if !FileManager.default.fileExists(atPath: file.path) {
            guard let (tmp, response) = try? await URLSession.shared.download(from: url), (response as? HTTPURLResponse)?.statusCode == 200,
                  ((try? FileManager.default.attributesOfItem(atPath: tmp.path)[.size] as? Int) ?? Int.max) <= 25_000_000 else { return nil }
            try? FileManager.default.moveItem(at: tmp, to: file)
        }
        var error: Unmanaged<CFError>?
        _ = CTFontManagerRegisterFontsForURL(file as CFURL, .process, &error)   // "already registered" is fine
        guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(file as CFURL) as? [CTFontDescriptor], let first = descriptors.first,
              let name = CTFontDescriptorCopyAttribute(first, kCTFontNameAttribute) as? String else { return nil }
        return name
    }

    func run(_ action: Action) {
        guard let item = selected else { return }
        message = ""; isError = false
        host.callUI(pluginID, "run", [id, action.id, item.raw])
    }
}

struct PreviewFont: Identifiable { let id = UUID(); let label: String; let name: String }

struct PluginDialogView: View {
    @ObservedObject var dialog: PluginDialog
    var onClose: () -> Void
    @State private var pending: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(dialog.title).font(.headline)
                Spacer()
                if dialog.busy { ProgressView().controlSize(.small) }
                Text(dialog.pluginName).font(.caption).foregroundStyle(.secondary)
            }.padding(12)
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField(dialog.placeholder, text: $dialog.query).textFieldStyle(.plain).onSubmit { dialog.search() }
            }
            .padding(8).background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8)).padding(.horizontal, 12)
            if !dialog.hint.isEmpty { Text(dialog.hint).font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 14).padding(.top, 6) }
            HStack(spacing: 0) {
                List(dialog.items, selection: $dialog.selectedID) { item in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(item.title).lineLimit(1)
                        if !item.subtitle.isEmpty { Text(item.subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                    }.tag(item.id)
                }
                .listStyle(.plain).frame(minWidth: 240, maxWidth: 280)
                Divider()
                VStack(alignment: .leading, spacing: 10) {
                    if dialog.selected == nil {
                        Text(dialog.items.isEmpty ? (dialog.busy ? "Loading…" : "No results") : "Select an item").foregroundStyle(.secondary)
                    } else {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 10) {
                                preview
                                Text(dialog.detail).font(.callout).frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
                            }
                        }
                        HStack { ForEach(dialog.actions) { a in Button(a.title) { dialog.run(a) }.buttonStyle(.borderedProminent).disabled(dialog.busy) } }
                    }
                    Spacer(minLength: 0)
                }.padding(12).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
            Divider()
            HStack {
                Text(dialog.message).font(.caption).foregroundStyle(dialog.isError ? Color.red : .secondary).lineLimit(2)
                Spacer()
                Button("Close") { onClose() }.keyboardShortcut(.cancelAction)
            }.padding(10)
        }
        .frame(width: 720, height: 480)
        .onAppear { dialog.search() }
        .onChange(of: dialog.query) { _, _ in
            pending?.cancel()
            pending = Task { try? await Task.sleep(nanoseconds: 350_000_000); if !Task.isCancelled { dialog.search() } }
        }
        .onChange(of: dialog.selectedID) { _, _ in dialog.select(dialog.selected) }
    }

    /// The selected font, drawn with the real font file at a few sizes. The sample text is editable.
    @ViewBuilder
    private var preview: some View {
        if !dialog.previewFonts.isEmpty || !dialog.previewStatus.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                TextField("Preview text", text: $dialog.previewText).textFieldStyle(.roundedBorder).font(.caption)
                if dialog.previewFonts.isEmpty {
                    Text(dialog.previewStatus).font(.caption).foregroundStyle(.secondary)
                }
                ForEach(dialog.previewFonts) { f in
                    VStack(alignment: .leading, spacing: 4) {
                        if !f.label.isEmpty { Text(f.label).font(.caption2).foregroundStyle(.secondary) }
                        ForEach([40.0, 24.0, 14.0], id: \.self) { size in
                            Text(dialog.previewText.isEmpty ? "The quick brown fox" : dialog.previewText)
                                .font(.custom(f.name, size: size)).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
            }
            .padding(10).background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
        }
    }
}
