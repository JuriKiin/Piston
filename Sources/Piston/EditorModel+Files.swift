import SwiftUI
import AppKit

enum FileOpError: LocalizedError {
    case noProject
    case invalidName
    var errorDescription: String? {
        switch self {
        case .noProject: return "No project is open"
        case .invalidName: return "That name isn't valid"
        }
    }
}

extension EditorModel {
    // MARK: Tree

    func refreshFileTree() {
        guard let projectURL else { fileTree = []; return }
        fileTree = FileNode.scan(projectURL)
        fileTreeVersion += 1
    }

    static let textExtensions: Set<String> = ["js", "mjs", "json", "md", "txt", "html", "htm", "css", "csv", "yml", "yaml", "toml", "svg", "glsl"]
    static let imageExtensions: Set<String> = ["png", "jpg", "jpeg", "gif", "webp"]

    func isSceneFile(_ url: URL) -> Bool {
        guard let projectURL else { return false }
        let dir = projectURL.appendingPathComponent(scenesDir).resolvingSymlinksInPath().path
        let u = url.resolvingSymlinksInPath()
        return u.pathExtension.lowercased() == "json" && u.deletingLastPathComponent().path == dir
    }

    // MARK: Opening

    /// Scenes open in the Scene view; text files in an editor tab; images in a preview tab; anything else
    /// in its default app.
    func openFile(_ url: URL) {
        let ext = url.pathExtension.lowercased()
        if isSceneFile(url) {
            activeTab = .scene
            Task { try? await loadScene(url.deletingPathExtension().lastPathComponent) }
            return
        }
        if Self.imageExtensions.contains(ext) {
            textDocs[url] = TextDoc(text: "", saved: "", isImage: true)
            showTab(url)
            return
        }
        if Self.textExtensions.contains(ext) || ext.isEmpty, let text = try? String(contentsOf: url, encoding: .utf8) {
            if textDocs[url] == nil { textDocs[url] = TextDoc(text: text, saved: text) }
            showTab(url)
            return
        }
        NSWorkspace.shared.open(url)
    }

    private func showTab(_ url: URL) {
        let tab = EditorTab.file(url)
        if !tabs.contains(tab) { tabs.append(tab) }
        activeTab = tab
    }

    func setText(_ url: URL, _ text: String) {
        textDocs[url]?.text = text
    }

    // MARK: Saving

    var activeIsImage: Bool { if case .file(let u) = activeTab { return textDocs[u]?.isImage == true && u.pathExtension.lowercased() == "png" } else { return false } }

    var activeIsDirty: Bool {
        switch activeTab {
        case .scene: return dirty
        case .game, .docs: return false
        case .file(let url): return textDocs[url]?.isDirty ?? false
        }
    }

    var hasUnsaved: Bool { dirty || textDocs.values.contains { $0.isDirty } }

    /// ⌘S: saves whatever the active tab is editing.
    func saveActive() {
        switch activeTab {
        case .scene: saveScene()
        case .game, .docs: break
        case .file(let url): saveFile(url)
        }
    }

    func saveAll() {
        if dirty { saveScene() }
        for (url, doc) in textDocs where doc.isDirty { saveFile(url) }
    }

    func saveFile(_ url: URL) {
        if textDocs[url]?.isImage == true {
            if let painter = PixelDoc.open[url], painter.dirty, painter.save() { reloadRuntime(); status = "Saved \(url.lastPathComponent)" }
            return
        }
        guard let doc = textDocs[url], !doc.isImage else { return }
        do {
            try doc.text.write(to: url, atomically: true, encoding: .utf8)
            textDocs[url]?.saved = doc.text
            status = "Saved \(url.lastPathComponent)"
        } catch {
            status = "Save failed: \(error.localizedDescription)"
        }
    }

    /// Re-reads an open file that changed on disk (git checkout, another editor), unless it has unsaved edits.
    func reloadOpenDocIfClean(at resolvedPath: String) {
        for (url, doc) in textDocs where !doc.isImage && !doc.isDirty && url.resolvingSymlinksInPath().path == resolvedPath {
            if let text = try? String(contentsOf: url, encoding: .utf8), text != doc.text {
                textDocs[url] = TextDoc(text: text, saved: text)
            }
        }
    }

    // MARK: Tabs

    func openDocs(_ slug: String? = nil) {
        if let slug { docsPage = slug }
        if !tabs.contains(.docs) { tabs.append(.docs) }
        activeTab = .docs
    }

    /// Moves a file tab into its own window: the tab leaves the tab bar, the document stays loaded.
    func popOut(_ tab: EditorTab) {
        guard case .file = tab else { if tab == .docs { tabs.removeAll { $0 == .docs }; if activeTab == .docs { activeTab = .scene } }; return }
        tabs.removeAll { $0 == tab }
        if activeTab == tab { activeTab = .scene }
    }

    /// A popped-out file's window was closed: dock it back into the tab bar (if it's still loaded).
    func dockFile(_ url: URL) {
        guard textDocs[url] != nil, !tabs.contains(.file(url)) else { return }
        tabs.append(.file(url))
    }

    func closeTab(_ tab: EditorTab) {
        if tab == .docs { tabs.removeAll { $0 == .docs }; if activeTab == .docs { activeTab = .scene }; return }
        guard case .file(let url) = tab else { return }
        if textDocs[url]?.isDirty == true { pendingClose = tab; return }
        forceCloseTab(tab)
    }

    func forceCloseTab(_ tab: EditorTab) {
        guard case .file(let url) = tab else { return }
        tabs.removeAll { $0 == tab }
        textDocs[url] = nil
        pendingClose = nil
        if activeTab == tab { activeTab = .scene }
    }

    // MARK: Creating

    private func uniqueURL(_ url: URL) -> URL {
        let fm = FileManager.default
        guard fm.fileExists(atPath: url.path) else { return url }
        let base = url.deletingPathExtension().lastPathComponent
        let ext = url.pathExtension
        var n = 2
        while true {
            let name = ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)"
            let candidate = url.deletingLastPathComponent().appendingPathComponent(name)
            if !fm.fileExists(atPath: candidate.path) { return candidate }
            n += 1
        }
    }

    private func validFileName(_ name: String) throws -> String {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty, !n.contains("/"), !n.contains(":"), !n.hasPrefix(".") else { throw FileOpError.invalidName }
        return n
    }

    @discardableResult
    func createFile(in dir: URL, name: String, contents: String = "") throws -> URL {
        let url = uniqueURL(dir.appendingPathComponent(try validFileName(name)))
        try contents.write(to: url, atomically: true, encoding: .utf8)
        refreshFileTree()
        return url
    }

    @discardableResult
    func createFolder(in dir: URL, name: String) throws -> URL {
        let url = uniqueURL(dir.appendingPathComponent(try validFileName(name)))
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        refreshFileTree()
        return url
    }

    /// A PascalCase identifier safe to use as a JS class name.
    static func identifier(from name: String) -> String {
        var parts = name.components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }
        parts = parts.map { $0.prefix(1).uppercased() + $0.dropFirst() }
        var id = parts.joined()
        if id.isEmpty { id = "Thing" }
        if id.first!.isNumber { id = "X" + id }
        return id
    }

    private func relativePath(from dir: URL, to target: URL) -> String {
        let a = dir.standardizedFileURL.resolvingSymlinksInPath().pathComponents
        let b = target.standardizedFileURL.resolvingSymlinksInPath().pathComponents
        var i = 0
        while i < a.count, i < b.count, a[i] == b[i] { i += 1 }
        let path = (Array(repeating: "..", count: a.count - i) + b[i...]).joined(separator: "/")
        return path.hasPrefix(".") ? path : "./" + path
    }

    /// Creates a script from a template (like Unity's Create > C# Script) and makes the runtime load it: an import in the
    /// project's entry module. Forgetting that import is the engine's #1 "why isn't my type showing up" gotcha.
    @discardableResult
    func createScript(template: ScriptTemplate, name: String, in dir: URL) throws -> URL {
        guard let projectURL else { throw FileOpError.noProject }
        let base = Self.identifier(from: name)
        var cls = base
        var n = 2
        while FileManager.default.fileExists(atPath: dir.appendingPathComponent("\(cls).js").path) { cls = "\(base)\(n)"; n += 1 }
        let url = try createFile(in: dir, name: "\(cls).js", contents: template.render(className: cls))

        let entryFile = projectURL.appendingPathComponent(String(entryModule.drop(while: { $0 == "/" })))
        if var entrySource = try? String(contentsOf: entryFile, encoding: .utf8) {
            let rel = relativePath(from: entryFile.deletingLastPathComponent(), to: url)
            let line = "import '\(rel)';"
            if !entrySource.contains(line) {
                if !entrySource.hasSuffix("\n") { entrySource += "\n" }
                entrySource += line + "\n"
                try? entrySource.write(to: entryFile, atomically: true, encoding: .utf8)
            }
        }
        return url
    }

    @discardableResult
    func createScript(kind: ScriptKind, name: String, in dir: URL) throws -> URL {
        try createScript(template: ScriptTemplates.defaultTemplate(for: kind), name: name, in: dir)
    }

    /// New scene file in the project's scenes folder, registered in the scenes manifest (index.js) so game code can
    /// switch to it by id. Returns the new scene's id.
    func createScene(name: String) throws -> String {
        guard let projectURL else { throw FileOpError.noProject }
        let display = try validFileName(name)
        let dir = projectURL.appendingPathComponent(scenesDir)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        var base = display.lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }.joined(separator: "_")
        if base.isEmpty { base = "scene" }
        if base.first!.isNumber { base = "s" + base }
        var id = base
        var n = 2
        while FileManager.default.fileExists(atPath: dir.appendingPathComponent("\(id).json").path) { id = "\(base)_\(n)"; n += 1 }

        let sceneDoc: [String: Any] = [
            "version": 3, "sceneName": display, "backgroundColor": "#0d0d0d",
            "deletedKeys": [String](), "entities": [[String: Any]](),
        ]
        let data = try JSONSerialization.data(withJSONObject: sceneDoc, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: dir.appendingPathComponent("\(id).json"), options: .atomic)

        let manifest = dir.appendingPathComponent("index.js")
        if var text = try? String(contentsOf: manifest, encoding: .utf8), text.contains("SceneRegistry") {
            let escaped = display.replacingOccurrences(of: "'", with: "\\'")
            if !text.hasSuffix("\n") { text += "\n" }
            text += "\nexport const Scene_\(id) = new Scene({ id: '\(id)', name: '\(escaped)', backgroundColor: '#0d0d0d' });\nSceneRegistry.register(Scene_\(id));\n"
            try? text.write(to: manifest, atomically: true, encoding: .utf8)
        }
        scanScenes()
        refreshFileTree()
        return id
    }

    // MARK: Renaming, deleting, revealing

    func rename(_ url: URL, to newName: String) throws {
        let name = try validFileName(newName)
        let dest = url.deletingLastPathComponent().appendingPathComponent(name)
        guard dest != url else { return }
        try FileManager.default.moveItem(at: url, to: dest)
        if let doc = textDocs.removeValue(forKey: url) {
            textDocs[dest] = doc
            tabs = tabs.map { $0 == .file(url) ? .file(dest) : $0 }
            if activeTab == .file(url) { activeTab = .file(dest) }
        }
        scanScenes()
        refreshFileTree()
    }

    /// Moves to the Trash (recoverable) rather than deleting outright.
    func trash(_ url: URL) throws {
        try FileManager.default.trashItem(at: url, resultingItemURL: nil)
        let gone = url.resolvingSymlinksInPath().path
        for tab in tabs {
            if case .file(let u) = tab, u.resolvingSymlinksInPath().path.hasPrefix(gone) { forceCloseTab(tab) }
        }
        scanScenes()
        refreshFileTree()
    }

    /// Where new scripts go: the project's scripts folder (or a folder inside it), wherever the explorer selection is.
    func scriptsDirectory(near dir: URL) -> URL {
        guard let projectURL else { return dir }
        let scripts = projectURL.appendingPathComponent("scripts")
        if dir.resolvingSymlinksInPath().path.hasPrefix(scripts.resolvingSymlinksInPath().path) { return dir }
        try? FileManager.default.createDirectory(at: scripts, withIntermediateDirectories: true)
        return scripts
    }

    func reveal(_ url: URL) { NSWorkspace.shared.activateFileViewerSelecting([url]) }
}


extension EditorModel {
    /// "New Plugin…": asks for a name, scaffolds plugins/<name>/ in the project and opens its code.
    func promptNewPlugin() {
        let alert = NSAlert()
        alert.messageText = "New Plugin"
        alert.informativeText = "Creates plugins/<name> in this project with a working example command. Edit and save it: the Plugins menu updates without restarting Piston."
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        field.placeholderString = "My Plugin"
        alert.accessoryView = field
        alert.addButton(withTitle: "Create")
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = field
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        do {
            let entry = try plugins.createPlugin(named: field.stringValue)
            openFile(entry)
            status = "Created \(entry.deletingLastPathComponent().lastPathComponent). Run it from the Plugins menu."
        } catch { status = "Couldn't create the plugin: \(error.localizedDescription)" }
    }
}
