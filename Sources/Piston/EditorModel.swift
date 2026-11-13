import SwiftUI

struct EntitySummary: Identifiable, Hashable {
    let key: String
    let tag: String
    let name: String
    let type: String?
    let parentKey: String?
    var id: String { key }
}

struct LogLine: Identifiable {
    let id = UUID()
    let level: String
    let text: String
    var source = "scene"   // "scene" (Scene view runtime), "game" (running game), "editor"
}

struct SchemaField: Hashable {
    let key: String
    let label: String
    let type: String
    let options: [String]
    var accept: String? = nil   // asset hint for path fields: "image", "audio", "any"
}

struct ViewCamera: Equatable {
    var x = 400.0
    var y = 300.0
    var zoom = 1.0
}

struct ScreenBounds: Equatable {
    var cx: Double
    var cy: Double
    var w: Double
    var h: Double
    var rotation: Double
}

private func num(_ v: Any?) -> Double? { (v as? NSNumber)?.doubleValue }

/// The editor's state. Three kinds, kept apart on purpose (PISTON_SPEC §4):
///  - project data  → `doc` (the scene document) and the files on disk
///  - editor state  → selection, camera, tool toggles, console: never saved into a scene
///  - game state    → lives only inside a runtime instance, never here
@MainActor
final class EditorModel: ObservableObject {
    // Project
    @Published var projectURL: URL?
    @Published var projectName = "-"
    @Published var platform = "web"
    @Published var recents: [RecentProject] = []
    @Published var showNewProject = false
    @Published var isBuilding = false
    @Published var lastBuild: BuildReport?
    @Published var entityTypes: [EntityTypeInfo] = []
    var previewServer: HTTPServer?
    /// A class name to drop into the scene as soon as the runtime has reloaded with the new script.
    var pendingAdd: String?
    @Published var entryModule = "/scripts/GameContent.js"
    @Published var scenesDir = "scenes"
    @Published var sceneIDs: [String] = []
    @Published var currentScene: String?
    @Published var doc: [String: Any] = [:] {
        didSet {
            // Every edit lands here, so this is the one place that records undo history. Loads suspend it.
            guard !suspendUndo, !oldValue.isEmpty else { return }
            let now = Date()
            if now.timeIntervalSince(lastUndoPush) > 0.6 { // a drag or a burst of typing is one undo step
                undoStack.append(oldValue)
                if undoStack.count > 100 { undoStack.removeFirst() }
                redoStack.removeAll()
            }
            lastUndoPush = now
        }
    }
    var undoStack: [[String: Any]] = []
    var redoStack: [[String: Any]] = []
    private var lastUndoPush = Date.distantPast
    private var suspendUndo = false
    @Published var extraSelection: Set<String> = []
    @Published var collapsed: Set<String> = []
    var clipboard: [[String: Any]] = []
    @Published var dirty = false { didSet { if dirty { scheduleRecovery() } } }

    // Runtime mirror (read-only copies of what the runtime reports)
    @Published var entities: [EntitySummary] = []
    @Published var entitySchemas: [String: [SchemaField]] = [:]
    @Published var componentSchemas: [String: [SchemaField]] = [:]
    @Published var componentDocs: [DocEntry] = []
    @Published var entityDocs: [DocEntry] = []
    @Published var docsPage = "01-getting-started"
    @Published var schemaEntityCount = 0
    @Published var schemaComponentCount = 0

    // Editor-only state
    @Published var selection: String?
    /// Bottom panel under the viewport.
    @Published var bottomTab: BottomTab = .console
    /// Tests (which load scenes without a user) turn the restore prompt off.
    var suppressRecoveryPrompt = false
    lazy var anim = AnimationEditorState(model: self)
    lazy var plugins: PluginHost = {
        let host = PluginHost(model: self)
        host.onChange = { [weak self] in self?.objectWillChange.send() }
        return host
    }()
    @Published var pluginDialog: PluginDialog?
    @Published var selectionBounds: ScreenBounds?
    @Published var camera = ViewCamera()
    @Published var showColliders = false
    @Published var vertexEditing = false
    @Published var showGameFrame = false
    @Published var gameResolution = CGSize(width: 800, height: 600)
    @Published var snapEnabled = true
    @Published var gridSize = 10.0
    @Published var rotationSnap = 15.0
    @Published var viewportSize = CGSize.zero
    /// True until the user pans/zooms; while true, the view re-frames the scene when the viewport resizes.
    @Published var autoFit = true
    @Published var logs: [LogLine] = []
    @Published var status = "Starting…"

    // Diagnostics (also what the self-test asserts on)
    @Published var readyCount = 0
    @Published var reloadCount = 0
    @Published var sceneReloadCount = 0
    @Published var roundTrips = 0
    @Published var runtimeReady = false

    // Play: a SEPARATE runtime instance (spec §4.2), created on Play and discarded on Stop
    @Published var playState: PlayState = .stopped
    @Published var playReady = false
    let playHost = WebHost()

    // Tabs, open text files, project file tree
    @Published var tabs: [EditorTab] = [.scene, .game]
    @Published var activeTab: EditorTab = .scene
    @Published var textDocs: [URL: TextDoc] = [:]
    @Published var pendingClose: EditorTab?
    @Published var fileTree: [FileNode] = []
    @Published var fileTreeVersion = 0

    let host = WebHost()
    @Published private(set) var server: HTTPServer?
    var watcher: FileWatcher?
    /// False during self-tests so throwaway projects never land in the user's real Recent Projects.
    var persistRecents = true
    /// The scene a project opens on (project.piston.json `startScene`), falling back to its first scene.
    var startScene: String?
    var sceneOrder: [String] = []
    /// The file whose change last forced a runtime reload (shown in the status line).
    var lastReloadReason = ""
    /// Last seen contents of script/page files, so a "touched" file with identical contents never reloads the runtime.
    var jsContent: [String: Data] = [:]
    /// Exact bytes of our last save per file: an event for a file that still holds these bytes is our own write.
    private var lastWritten: [String: Data] = [:]
    private var readyWaiters: [CheckedContinuation<Void, Never>] = []

    init() {
        host.onEvent = { [weak self] event in self?.handleEvent(event) }
        playHost.onEvent = { [weak self] event in self?.handlePlayEvent(event) }
        loadRecents()
    }

    // MARK: Locations

    /// A folder shipped inside the app (Contents/Resources/<rel>); when running unbundled, the same path in the repo.
    static func resource(_ rel: String) -> URL {
        if let res = Bundle.main.resourceURL?.appendingPathComponent(rel), FileManager.default.fileExists(atPath: res.path) { return res }
        return URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent(rel)
    }

    static func bridgeRoot() -> URL { resource("Bridge/web") }
    static func engineRoot() -> URL { resource("Engine/web") }
    static func templatesRoot() -> URL { resource("Templates") }
    static func samplesRoot() -> URL { resource("Samples") }

    // MARK: Project lifecycle

    func openProject(_ url: URL) async {
        status = "Opening \(url.lastPathComponent)…"
        // A different project must never inherit the previous one's scene or schemas.
        currentScene = nil
        doc = [:]
        dirty = false
        entitySchemas = [:]
        startScene = nil
        jsContent = [:]
        projectURL = url
        runtimeReady = false
        selection = nil
        selectionBounds = nil
        entities = []

        // project.piston.json is the project descriptor.
        if let data = try? Data(contentsOf: url.appendingPathComponent("project.piston.json")),
           let cfg = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            projectName = cfg["name"] as? String ?? url.lastPathComponent
            platform = cfg["platform"] as? String ?? "web"
            startScene = cfg["startScene"] as? String
            entryModule = cfg["entry"] as? String ?? entryModule
            scenesDir = cfg["scenesDir"] as? String ?? scenesDir
            sceneOrder = cfg["sceneOrder"] as? [String] ?? []
            if let r = cfg["resolution"] as? [String: Any] {
                gameResolution = CGSize(width: (r["width"] as? NSNumber)?.doubleValue ?? 800, height: (r["height"] as? NSNumber)?.doubleValue ?? 600)
            } else { gameResolution = CGSize(width: 800, height: 600) }
        } else {
            projectName = url.lastPathComponent
        }
        scanScenes()
        stopGame()
        tabs = [.scene, .game]
        activeTab = .scene
        textDocs = [:]
        refreshFileTree()

        do {
            if let server { server.projectRoot = url }
            else {
                let s = HTTPServer(projectRoot: url, bridgeRoot: Self.bridgeRoot(), engineRoot: Self.engineRoot())
                _ = try await s.start()
                server = s
            }
        } catch {
            status = "Server failed: \(error.localizedDescription)"
            return
        }

        watcher?.stop()
        // Hop to a fresh main-actor turn: never touch observable state from inside the FSEvents callback itself.
        watcher = FileWatcher(path: url.path) { [weak self] paths in
            Task { @MainActor in self?.projectFilesChanged(paths) }
        }

        primeScriptBaseline(under: url)
        plugins.discover()
        noteOpened(url)
        loadPage()
    }

    /// Remember what every script/page file contains right now, so the watcher can tell a real edit from a mere "touch"
    /// (a build copying your files, a backup tool, `git status`): only changed contents reload the runtime.
    private func primeScriptBaseline(under root: URL) {
        jsContent = [:]
        let skip: Set<String> = ["dist", ".git", ".piston", "node_modules", "plugins"]
        guard let walker = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]) else { return }
        for case let url as URL in walker {
            if skip.contains(url.lastPathComponent) { walker.skipDescendants(); continue }
            guard url.pathExtension == "js" || url.pathExtension == "html", let data = try? Data(contentsOf: url) else { continue }
            jsContent[url.resolvingSymlinksInPath().path] = data
        }
    }

    private func loadPage() {
        if let url = pageURL("edit.html") { host.load(url) }
    }

    /// URL of one of the editor's runtime pages (served from the bridge folder) for the open project.
    func pageURL(_ page: String) -> URL? {
        guard let server else { return nil }
        var comps = URLComponents()
        comps.scheme = "http"
        comps.host = "127.0.0.1"
        comps.port = Int(server.port)
        comps.path = "/__piston_\(page)"   // "edit.html" → /__piston_edit.html (served at the root, see HTTPServer)
        comps.queryItems = [URLQueryItem(name: "entry", value: entryModule),
                            URLQueryItem(name: "scenes", value: "./\(scenesDir)"),
                            URLQueryItem(name: "prefabs", value: "./prefabs"),
                            URLQueryItem(name: "sceneIds", value: sceneIDs.joined(separator: ",")),
                            URLQueryItem(name: "w", value: String(Int(gameResolution.width))),
                            URLQueryItem(name: "h", value: String(Int(gameResolution.height)))]
        return comps.url
    }

    func scanScenes() {
        guard let projectURL else { return }
        let dir = projectURL.appendingPathComponent(scenesDir)
        let files = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        sceneIDs = ProjectScenes.ordered(files.filter { $0.hasSuffix(".json") }.map { String($0.dropLast(5)) }, configured: sceneOrder)
    }

    private func sceneFile(_ id: String) -> URL? {
        projectURL?.appendingPathComponent(scenesDir).appendingPathComponent("\(id).json")
    }

    // MARK: Runtime events

    private func handleEvent(_ event: [String: Any]) {
        switch event["type"] as? String {
        case "ready":
            readyCount += 1
            runtimeReady = true
            Task { await afterReady() }
        case "log":
            logs.append(LogLine(level: event["level"] as? String ?? "log", text: event["text"] as? String ?? "", source: "scene"))
        case "error":
            let src = (event["source"] as? String).map { " (\($0):\(event["line"] ?? "?"))" } ?? ""
            logs.append(LogLine(level: "error", text: (event["message"] as? String ?? "error") + src, source: "scene"))
        default:
            break
        }
        if logs.count > 500 { logs.removeFirst(logs.count - 500) }
    }

    /// Runs on first load AND after every hot reload: rebuild the runtime's view from the document.
    private func afterReady() async {
        do {
            try await refreshSchemas()
            try await host.request("setEditorCamera", ["x": camera.x, "y": camera.y, "zoom": camera.zoom])
            try await host.request("setDebugFlags", ["colliders": showColliders])
            if let id = currentScene { try await sendScene(reloadFromDisk: false, id: id) }
            else if let first = (startScene.flatMap { sceneIDs.contains($0) ? $0 : nil } ?? sceneIDs.first) { try await loadScene(first) }
            if let type = pendingAdd, entitySchemas[type] != nil {
                pendingAdd = nil
                await addEntity(type: type)
            }
            status = "Ready · \(entities.count) entities"
        } catch {
            status = "Bridge error: \(error.localizedDescription)"
        }
        let waiters = readyWaiters
        readyWaiters.removeAll()
        waiters.forEach { $0.resume() }
    }

    func waitUntilReady(timeout: Double = 15) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if runtimeReady, !entities.isEmpty || currentScene == nil { return true }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        return runtimeReady
    }

    func waitForReadyCount(_ n: Int, timeout: Double = 10) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if readyCount >= n, !entities.isEmpty { return true }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        return false
    }

    // MARK: Schemas

    func refreshSchemas() async throws {
        guard let result = try await host.request("getSchemas") as? [String: Any] else { return }
        roundTrips += 1
        let ents = result["entities"] as? [[String: Any]] ?? []
        let comps = result["components"] as? [[String: Any]] ?? []
        schemaEntityCount = ents.count
        entityTypes = ents.compactMap { e in
            (e["name"] as? String).map { EntityTypeInfo(name: $0, group: e["group"] as? String ?? "General") }
        }
        schemaComponentCount = comps.count
        func parse(_ list: [[String: Any]]) -> [String: [SchemaField]] {
            var map: [String: [SchemaField]] = [:]
            for e in list {
                guard let name = e["name"] as? String else { continue }
                map[name] = (e["fields"] as? [[String: Any]] ?? []).compactMap { f -> SchemaField? in
                    guard let key = f["key"] as? String else { return nil }
                    return SchemaField(key: key, label: f["label"] as? String ?? key,
                                       type: f["type"] as? String ?? "number", options: f["options"] as? [String] ?? [],
                                       accept: f["accept"] as? String)
                }
            }
            return map
        }
        entitySchemas = parse(ents)
        componentSchemas = parse(comps)
        entityDocs = ents.compactMap { e in (e["name"] as? String).map { DocEntry(name: $0, group: e["group"] as? String ?? "General", description: e["description"] as? String ?? "") } }
        componentDocs = comps.compactMap { c in (c["name"] as? String).map { DocEntry(name: $0, group: c["category"] as? String ?? "game", description: c["description"] as? String ?? "") } }
    }

    // MARK: Scenes

    func loadScene(_ id: String) async throws {
        currentScene = id
        try await sendScene(reloadFromDisk: true, id: id)
    }

    /// Entity ids (`sceneKey`) are the scene's stable identity: parenting, selection, plugins and saved edits all refer to them.
    /// A hand-edited or merged file can lack one or repeat one; give those entities fresh ids (and fix parent links) so identity stays unique.
    @discardableResult
    static func repairSceneKeys(_ scene: inout [String: Any]) -> Int {
        guard var list = scene["entities"] as? [[String: Any]] else { return 0 }
        var seen = Set<String>()
        var changed = 0
        var remapFirst: [String: String] = [:]
        for i in list.indices {
            let key = list[i]["sceneKey"] as? String ?? ""
            if key.isEmpty || seen.contains(key) {
                let fresh = "added:\(UUID().uuidString.prefix(12).lowercased())"
                list[i]["sceneKey"] = fresh
                seen.insert(fresh)
                changed += 1
            } else { seen.insert(key); remapFirst[key] = key }
        }
        for i in list.indices { // a parent that points nowhere becomes "no parent"
            if let p = list[i]["parentKey"] as? String, !seen.contains(p) { list[i]["parentKey"] = NSNull(); changed += 1 }
        }
        if changed > 0 { scene["entities"] = list }
        return changed
    }

    /// Runs the engine's scene validator (the same rules a port must pass) and reports problems in the Console.
    func validateScene(quietWhenClean: Bool = false) async {
        guard !doc.isEmpty, let result = try? await host.request("validateScene", ["data": doc]) as? [String: Any] else { return }
        let errors = result["errors"] as? [[String: Any]] ?? [], warnings = result["warnings"] as? [[String: Any]] ?? []
        for (level, list) in [("error", errors), ("warn", warnings)] {
            for issue in list.prefix(40) {
                let who = (issue["entity"] as? String).flatMap { k in entities.first { $0.key == k }.map { $0.name.isEmpty ? $0.tag : $0.name } } ?? (issue["entity"] as? String) ?? "scene"
                logs.append(LogLine(level: level, text: "\(who): \(issue["message"] as? String ?? "") (\(issue["path"] as? String ?? ""))", source: "validate"))
            }
        }
        if errors.isEmpty && warnings.isEmpty { if !quietWhenClean { status = "Scene is valid" } }
        else { status = "Validation: \(errors.count) error\(errors.count == 1 ? "" : "s"), \(warnings.count) warning\(warnings.count == 1 ? "" : "s") (see Console)" }
    }

    // MARK: Recovery snapshots
    // While a scene has unsaved changes, a copy is written to <project>/.piston/recovery/ a few seconds after the last edit. A crash, a forced
    // quit or a lost power cut then costs at most a few seconds of work: the next time the scene opens, Piston offers to restore it.

    private var recoveryTask: Task<Void, Never>?

    private func recoveryFile(_ id: String) -> URL? { projectURL?.appendingPathComponent(".piston/recovery/\(id).json") }

    private func scheduleRecovery() {
        recoveryTask?.cancel()
        recoveryTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            if !Task.isCancelled { self?.writeRecovery() }
        }
    }

    func writeRecovery() {
        guard dirty, let id = currentScene, let file = recoveryFile(id), !doc.isEmpty,
              let data = try? JSONSerialization.data(withJSONObject: doc, options: [.sortedKeys]) else { return }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: file, options: .atomic)
    }

    func clearRecovery(for id: String) {
        recoveryTask?.cancel()
        if let file = recoveryFile(id) { try? FileManager.default.removeItem(at: file) }
    }

    /// The unsaved copy of a scene left by an earlier session, if it is newer than the scene file and different from it.
    func recoveredScene(_ id: String) -> [String: Any]? {
        guard let rec = recoveryFile(id), let scene = sceneFile(id),
              let recDate = (try? rec.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate,
              let sceneDate = (try? scene.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate, recDate > sceneDate,
              let data = try? Data(contentsOf: rec), let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let saved = (try? Data(contentsOf: scene)).flatMap({ try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }),
              NSDictionary(dictionary: obj) != NSDictionary(dictionary: saved) else { return nil }
        return obj
    }

    func sendScene(reloadFromDisk: Bool, id: String) async throws {
        if reloadFromDisk {
            guard let file = sceneFile(id), let data = try? Data(contentsOf: file),
                  var parsed = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw BridgeError.runtime("Can't read scene \(id)")
            }
            let repaired = Self.repairSceneKeys(&parsed)
            suspendUndo = true
            doc = parsed
            suspendUndo = false
            undoStack = []; redoStack = []
            dirty = repaired > 0   // repaired ids only become permanent once the scene is saved
            if repaired > 0 { logs.append(LogLine(level: "warn", text: "Gave \(repaired) entit\(repaired == 1 ? "y" : "ies") in \"\(id)\" a new unique id (missing or duplicated). Save the scene to keep them.", source: "editor")) }
        }
        let keepSelection = reloadFromDisk ? nil : selection // a hot reload keeps editor state (selection)
        guard let result = try await host.request("loadScene", ["data": doc]) as? [String: Any] else { return }
        roundTrips += 1
        entities = (result["entities"] as? [[String: Any]] ?? []).compactMap(Self.summary)
        selection = entities.contains { $0.key == keepSelection } ? keepSelection : nil
        selectionBounds = nil
        if selection != nil { Task { await refreshSelectionBounds() } }
        status = "\(id) · \(entities.count) entities"
        if reloadFromDisk {
            fitToScene(); Task { await validateScene(quietWhenClean: true) }
            if !suppressRecoveryPrompt, let recovered = recoveredScene(id) {
                let alert = NSAlert()
                alert.messageText = "Restore unsaved changes to \(id)?"
                alert.informativeText = "Piston found changes to this scene that were never saved (it may have quit or crashed). Restore them, or keep the saved scene?"
                alert.addButton(withTitle: "Restore Changes")
                alert.addButton(withTitle: "Keep Saved Scene")
                if alert.runModal() == .alertFirstButtonReturn {
                    doc = recovered
                    dirty = true
                    try? await sendScene(reloadFromDisk: false, id: id)
                    status = "Restored unsaved changes to \(id): save to keep them"
                } else { clearRecovery(for: id) }
            }
        }
    }

    /// Frames the scene in the viewport (editor camera only: never touches scene data). Extents come
    /// from the runtime, which knows real shapes (polygon vertices), not just each entity's size box.
    func fitToScene() {
        guard viewportSize.width > 80, viewportSize.height > 80 else { return }
        let size = viewportSize
        Task {
            guard let r = try? await host.request("getSceneBounds") as? [String: Any],
                  (r["empty"] as? Bool) == false,
                  let minX = num(r["minX"]), let minY = num(r["minY"]), let maxX = num(r["maxX"]), let maxY = num(r["maxY"]) else { return }
            roundTrips += 1
            let bw = max(maxX - minX, 50), bh = max(maxY - minY, 50)
            camera.x = (minX + maxX) / 2
            camera.y = (minY + maxY) / 2
            camera.zoom = min(4, max(0.1, min(size.width / (bw * 1.2), size.height / (bh * 1.2))))
            autoFit = true
            pushCamera()
        }
    }

    func resetView() { fitToScene() }

    /// Sets the game's design resolution (the Game view keeps this aspect ratio at any size) and saves it in project.piston.json.
    func setResolution(width: Double, height: Double) {
        let w = min(8192, max(16, width.rounded())), h = min(8192, max(16, height.rounded()))
        gameResolution = CGSize(width: w, height: h)
        guard let url = projectURL?.appendingPathComponent("project.piston.json"),
              let data = try? Data(contentsOf: url),
              var cfg = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        cfg["resolution"] = ["width": Int(w), "height": Int(h)]
        if let out = try? JSONSerialization.data(withJSONObject: cfg, options: [.prettyPrinted, .sortedKeys]) { try? out.write(to: url) }
        if playState != .stopped { status = "Resolution \(Int(w))×\(Int(h)) applies next time you press Play" }
    }

    private static func summary(_ d: [String: Any]) -> EntitySummary? {
        guard let key = d["key"] as? String else { return nil }
        return EntitySummary(key: key, tag: d["tag"] as? String ?? "", name: d["name"] as? String ?? "",
                             type: d["type"] as? String, parentKey: d["parentKey"] as? String)
    }

    func saveScene() {
        guard let id = currentScene, let file = sceneFile(id) else { return }
        do {
            let data = try JSONSerialization.data(withJSONObject: doc, options: [.prettyPrinted, .sortedKeys])
            lastWritten[file.resolvingSymlinksInPath().path] = data // so our own write doesn't look like an external edit
            try data.write(to: file, options: .atomic)
            dirty = false
            clearRecovery(for: id)
            status = "Saved \(id)"
        } catch {
            status = "Save failed: \(error.localizedDescription)"
        }
    }

    // MARK: External changes (hot reload)

    private var pendingPageReload = false
    private var pendingSceneReload = false
    private var flushTask: Task<Void, Never>?
    private var pendingPaths: [String] = []

    /// FSEvents often reports one save as several events (temp file, rename, modify) across batches,
    /// so changes are collected and acted on once things go quiet. This runs inside the FSEvents
    /// callback, so it deliberately touches NO observable state: it only records paths and restarts a
    /// timer. Everything else happens in `processPendingChanges`, a fresh turn after the timer.
    private func projectFilesChanged(_ paths: [String]) {
        pendingPaths.append(contentsOf: paths)
        flushTask?.cancel()
        flushTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 400_000_000)
            if Task.isCancelled { return }
            self?.processPendingChanges()
        }
    }

    private func processPendingChanges() {
        let paths = pendingPaths
        pendingPaths = []
        // FSEvents reports resolved paths (/private/var/… for /var/…), so compare resolved paths.
        let sceneFilePath = currentScene.flatMap { sceneFile($0)?.resolvingSymlinksInPath().path }
        var pluginsChanged = false
        for raw in paths {
            let p = URL(fileURLWithPath: raw).resolvingSymlinksInPath().path
            if p.contains("/.git/") || p.contains("/.piston/") || p.contains("/dist/") || p.hasSuffix(".DS_Store") { continue }
            // Plugin code is editor code, not game code: reload the plugins, never the game runtime.
            if let root = projectURL?.resolvingSymlinksInPath().path, p.hasPrefix(root + "/plugins/") {
                reloadOpenDocIfClean(at: p)
                pluginsChanged = true
                continue
            }
            if let mine = lastWritten[p], (try? Data(contentsOf: URL(fileURLWithPath: p))) == mine { continue } // our own save
            reloadOpenDocIfClean(at: p)
            if p.hasSuffix(".js") || p.hasSuffix(".html") {
                let current = try? Data(contentsOf: URL(fileURLWithPath: p))
                if let current, jsContent[p] == current { continue }
                jsContent[p] = current
                pendingPageReload = true
                lastReloadReason = (p as NSString).lastPathComponent
            }
            else if p == sceneFilePath { pendingSceneReload = true }
        }
        scanScenes()
        refreshFileTree()
        flushChanges()
        if pluginsChanged { plugins.reload(announce: true) }
    }

    private func flushChanges() {
        if pendingPageReload {
            reloadCount += 1
            status = "\(lastReloadReason) changed, reloading runtime…"
            runtimeReady = false
            host.reload() // → ready → afterReady() restores scene and camera
        } else if pendingSceneReload, let id = currentScene {
            sceneReloadCount += 1
            Task { try? await sendScene(reloadFromDisk: true, id: id) }
        }
        pendingPageReload = false
        pendingSceneReload = false
    }

    func reloadRuntime() {
        runtimeReady = false
        host.reload()
    }

    // MARK: Selection

    var selectedKeys: Set<String> { selection.map { extraSelection.union([$0]) } ?? [] }

    /// Shift-click: add to / remove from the selection.
    func toggleSelect(_ key: String) {
        if selection == nil { select(key); return }
        if key == selection { selection = extraSelection.first; extraSelection.remove(selection ?? "") }
        else if extraSelection.contains(key) { extraSelection.remove(key) }
        else { extraSelection.insert(key) }
        Task { await refreshSelectionBounds() }
    }

    func canUndo() -> Bool { !undoStack.isEmpty }

    var undoDepth: Int { undoStack.count }
    func undo() { restoreDoc(from: &undoStack, pushingTo: &redoStack) }
    func redo() { restoreDoc(from: &redoStack, pushingTo: &undoStack) }

    private func restoreDoc(from: inout [[String: Any]], pushingTo: inout [[String: Any]]) {
        guard let previous = from.popLast(), let id = currentScene else { return }
        pushingTo.append(doc)
        suspendUndo = true
        doc = previous
        suspendUndo = false
        dirty = true
        Task { try? await sendScene(reloadFromDisk: false, id: id) }
    }

    func select(_ key: String?) {
        extraSelection = []
        selection = key
        Task { await refreshSelectionBounds() }
    }

    func refreshSelectionBounds() async {
        guard let key = selection else { selectionBounds = nil; return }
        guard let result = try? await host.request("getBounds", ["keys": [key]]) as? [String: Any],
              let b = (result["bounds"] as? [[String: Any]])?.first,
              let s = b["screen"] as? [String: Any] else { selectionBounds = nil; return }
        roundTrips += 1
        selectionBounds = ScreenBounds(cx: num(s["cx"]) ?? 0, cy: num(s["cy"]) ?? 0, w: num(s["w"]) ?? 0,
                                       h: num(s["h"]) ?? 0, rotation: num(s["rotation"]) ?? 0)
    }

    func hitKey(at p: CGPoint) async -> String? {
        guard let result = try? await host.request("hitTest", ["x": p.x, "y": p.y]) as? [String: Any] else { return nil }
        roundTrips += 1
        return result["key"] as? String
    }

    // MARK: Direct manipulation (viewport)

    enum DragMode { case idle, resolving, move(String), scale(String, sx: Double, sy: Double), rotate(String), vertex(String, comp: Int, index: Int), pan }
    private(set) var dragMode: DragMode = .idle
    private var pendingDelta = CGSize.zero
    private var dragStart = CGPoint.zero
    private var pendingClickSelect: String?
    private var pendingShiftToggle: String?
    private var pendingPatches: [String: [String: Any]] = [:]
    private var patchInFlight = false
    private var dragTotal = CGSize.zero
    private var startTransform: (x: Double, y: Double, rotation: Double, w: Double, h: Double) = (0, 0, 0, 0, 0)
    private var startAngle = 0.0
    private var dragCenter = CGPoint.zero

    /// Snapping applies when the toggle is on; holding Option flips it for one drag.
    private var snapping: Bool { snapEnabled != NSEvent.modifierFlags.contains(.option) }
    private func snap(_ v: Double, _ step: Double) -> Double { snapping && step > 0 ? (v / step).rounded() * step : v }

    /// The gizmo handles in screen space: corners (scale) and a knob above the top edge (rotate).
    private func handleHit(at p: CGPoint) -> DragMode? {
        guard let key = selection, let b = selectionBounds else { return nil }
        let r = b.rotation * .pi / 180, c = cos(r), s = sin(r)
        func screen(_ lx: Double, _ ly: Double) -> CGPoint { CGPoint(x: b.cx + lx * c - ly * s, y: b.cy + lx * s + ly * c) }
        let near: (CGPoint) -> Bool = { hypot($0.x - p.x, $0.y - p.y) <= 9 }
        if near(screen(0, -b.h / 2 - 24)) { return .rotate(key) }
        for (sx, sy) in [(-1.0, -1.0), (1.0, -1.0), (-1.0, 1.0), (1.0, 1.0)] where near(screen(sx * b.w / 2, sy * b.h / 2)) {
            return .scale(key, sx: sx, sy: sy)
        }
        return nil
    }

    func dragBegan(at p: CGPoint) {
        pendingDelta = .zero
        dragStart = p
        dragTotal = .zero
        if vertexEditing, let v = vertexHit(at: p) { dragMode = v; return }
        if let handle = handleHit(at: p), let b = selectionBounds, let key = selection {
            dragMode = handle
            startTransform = transform(key)
            dragCenter = CGPoint(x: b.cx, y: b.cy)
            startAngle = atan2(p.y - b.cy, p.x - b.cx) * 180 / .pi
            return
        }
        dragMode = .resolving
        Task {
            let key = await hitKey(at: p)
            if let key {
                pendingClickSelect = nil
                if NSEvent.modifierFlags.contains(.shift) {
                    // Shift-click toggles selection, but shift-drag on something already selected just moves it (axis-locked).
                    if selectedKeys.contains(key) { pendingShiftToggle = key } else { toggleSelect(key) }
                } else {
                    // Groups: the first click grabs the topmost parent; drag moves the whole group. Once inside a
                    // group, clicking a child without dragging selects it (so a flag on top of a hole doesn't steal the drag).
                    let root = ancestors(of: key).last ?? key
                    if let sel = selection, (ancestors(of: sel).last ?? sel) == root {
                        if key == sel || ancestors(of: key).contains(sel) { pendingClickSelect = key }  // keep dragging the selection
                        else { select(key) }
                    } else if selectedKeys.contains(key) {
                        if selection != key { selection = key; await refreshSelectionBounds() }
                    } else { select(root) }
                }
                dragMode = .move(selection ?? key); startTransform = transform(selection ?? key)
            } else { select(nil); dragMode = .pan }
            if pendingDelta != .zero { dragChanged(delta: pendingDelta); pendingDelta = .zero }
        }
    }

    func dragChanged(delta: CGSize) {
        switch dragMode {
        case .idle: break
        case .resolving: pendingDelta.width += delta.width; pendingDelta.height += delta.height
        case .pan: panCamera(screenDelta: delta)
        case .move(let key):
            dragTotal.width += delta.width; dragTotal.height += delta.height
            let t = startTransform, g = gridSize
            var nx = snap(t.x + dragTotal.width / camera.zoom, g), ny = snap(t.y + dragTotal.height / camera.zoom, g)
            if NSEvent.modifierFlags.contains(.shift) { // hold Shift to lock to the axis you're dragging along
                if abs(dragTotal.width) >= abs(dragTotal.height) { ny = t.y } else { nx = t.x }
            }
            let cur = transform(key)
            if var b = selectionBounds { b.cx += (nx - cur.x) * camera.zoom; b.cy += (ny - cur.y) * camera.zoom; selectionBounds = b } // optimistic
            for other in extraSelection where other != key { // a multi-selection moves together
                let o = transform(other)
                setTransform(other, x: o.x + (nx - cur.x), y: o.y + (ny - cur.y))
            }
            setTransform(key, x: nx, y: ny)
        case .scale(let key, let sx, let sy):
            dragTotal.width += delta.width; dragTotal.height += delta.height
            let t = startTransform
            let wdx = dragTotal.width / camera.zoom, wdy = dragTotal.height / camera.zoom
            let r = t.rotation * .pi / 180, c = cos(r), s = sin(r)
            let ldx = wdx * c + wdy * s, ldy = -wdx * s + wdy * c   // world delta in the entity's own axes
            var nw = max(1, snap(t.w + sx * ldx, gridSize)), nh = max(1, snap(t.h + sy * ldy, gridSize))
            if NSEvent.modifierFlags.contains(.shift), t.w > 0, t.h > 0 { // Shift keeps the proportions
                let f = max(nw / t.w, nh / t.h)
                nw = max(1, t.w * f); nh = max(1, t.h * f)
            }
            let shiftX = sx * (nw - t.w) / 2, shiftY = sy * (nh - t.h) / 2   // keep the opposite corner fixed
            let cur = transform(key)
            let nx = t.x + shiftX * c - shiftY * s, ny = t.y + shiftX * s + shiftY * c
            if var b = selectionBounds { b.cx += (nx - cur.x) * camera.zoom; b.cy += (ny - cur.y) * camera.zoom; b.w = nw * camera.zoom; b.h = nh * camera.zoom; selectionBounds = b }
            setTransform(key, x: nx, y: ny, w: nw, h: nh, cascade: false)
        case .vertex(let key, let comp, let index):
            dragTotal.width += delta.width; dragTotal.height += delta.height
            moveVertex(key, comp, index, to: CGPoint(x: dragStart.x + dragTotal.width, y: dragStart.y + dragTotal.height))
        case .rotate(let key):
            dragTotal.width += delta.width; dragTotal.height += delta.height
            let m = CGPoint(x: dragStart.x + dragTotal.width, y: dragStart.y + dragTotal.height)
            let angle = atan2(m.y - dragCenter.y, m.x - dragCenter.x) * 180 / .pi
            var rot = startTransform.rotation + (angle - startAngle)
            rot = NSEvent.modifierFlags.contains(.shift) ? (rot / 15).rounded() * 15 : snap(rot, rotationSnap) // Shift = 15° steps
            setTransform(key, rotation: rot)
            if var b = selectionBounds { b.rotation = rot; selectionBounds = b }
        }
    }

    func dragEnded() {
        if let k = pendingClickSelect, hypot(dragTotal.width, dragTotal.height) < 3, k != selection { select(k) }
        pendingClickSelect = nil
        if let k = pendingShiftToggle, hypot(dragTotal.width, dragTotal.height) < 3 { toggleSelect(k) }
        pendingShiftToggle = nil
        dragMode = .idle
        Task { await refreshSelectionBounds() }
    }

    func viewportResized(_ size: CGSize) {
        viewportSize = size
        if autoFit, !doc.isEmpty { fitToScene() } else { Task { await refreshSelectionBounds() } }
    }

    func panCamera(screenDelta d: CGSize) {
        autoFit = false
        camera.x -= d.width / camera.zoom
        camera.y -= d.height / camera.zoom
        pushCamera()
    }

    func setZoom(_ z: Double) {
        autoFit = false
        camera.zoom = min(8, max(0.1, z))
        pushCamera()
    }

    private func pushCamera() {
        Task {
            try? await host.request("setEditorCamera", ["x": camera.x, "y": camera.y, "zoom": camera.zoom])
            await refreshSelectionBounds()
        }
    }

    func setColliders(_ on: Bool) {
        showColliders = on
        Task { try? await host.request("setDebugFlags", ["colliders": on]) }
    }

    // MARK: Document edits (each also patches the runtime view)

    private func entityIndex(_ key: String) -> Int? {
        (doc["entities"] as? [[String: Any]])?.firstIndex { ($0["sceneKey"] as? String) == key }
    }

    private func mutate(_ key: String, _ body: (inout [String: Any]) -> Void) {
        guard var list = doc["entities"] as? [[String: Any]], let i = entityIndex(key) else { return }
        body(&list[i])
        doc["entities"] = list
        dirty = true
    }

    func entityDoc(_ key: String) -> [String: Any]? {
        guard let i = entityIndex(key) else { return nil }
        return (doc["entities"] as? [[String: Any]])?[i]
    }

    func transform(_ key: String) -> (x: Double, y: Double, rotation: Double, w: Double, h: Double) {
        let t = entityDoc(key)?["transform"] as? [String: Any]
        let p = t?["position"] as? [String: Any]
        let s = t?["size"] as? [String: Any]
        var r = (x: num(p?["x"]) ?? 0, y: num(p?["y"]) ?? 0, rotation: num(t?["rotation"]) ?? 0, w: num(s?["x"]) ?? 0, h: num(s?["y"]) ?? 0)
        if let pose = anim.poseValues(for: key) { // recording: the entity is showing the animation's pose, so edits start from it
            if let v = pose["transform.position.x"] { r.x = v }
            if let v = pose["transform.position.y"] { r.y = v }
            if let v = pose["transform.rotation"] { r.rotation = v }
            if let v = pose["transform.size.x"] { r.w = v }
            if let v = pose["transform.size.y"] { r.h = v }
        }
        return r
    }

    /// Moving an entity also moves everything parented under it (the engine's parenting is world-space grouping:
    /// translation cascades, rotation and scale do not). Children that are themselves selected move on their own.
    func setTransform(_ key: String, x: Double? = nil, y: Double? = nil, rotation: Double? = nil, w: Double? = nil, h: Double? = nil, cascade: Bool = true) {
        if anim.recordTransform(key, x: x, y: y, rotation: rotation, w: w, h: h) { return } // Record mode: becomes keys, not a base edit
        if cascade, x != nil || y != nil {
            let cur = transform(key)
            let dx = (x ?? cur.x) - cur.x, dy = (y ?? cur.y) - cur.y
            if dx != 0 || dy != 0 {
                let skip = selectedKeys.contains(key) ? selectedKeys : []
                for d in descendants(of: key) where !skip.contains(d) {
                    let o = transform(d)
                    applyTransform(d, x: o.x + dx, y: o.y + dy)
                }
            }
        }
        applyTransform(key, x: x, y: y, rotation: rotation, w: w, h: h)
    }

    private func applyTransform(_ key: String, x: Double? = nil, y: Double? = nil, rotation: Double? = nil, w: Double? = nil, h: Double? = nil) {
        mutate(key) { e in
            var t = e["transform"] as? [String: Any] ?? [:]
            var p = t["position"] as? [String: Any] ?? [:]
            var s = t["size"] as? [String: Any] ?? [:]
            if let x { p["x"] = x }
            if let y { p["y"] = y }
            if let w { s["x"] = w }
            if let h { s["y"] = h }
            if let rotation { t["rotation"] = rotation }
            t["position"] = p
            t["size"] = s
            e["transform"] = t
        }
        var op: [String: Any] = ["op": "setTransform", "key": key]
        if let x { op["x"] = x }
        if let y { op["y"] = y }
        if let rotation { op["rotation"] = rotation }
        if let w { op["w"] = w }
        if let h { op["h"] = h }
        queuePatch(op)
    }

    /// Transform patches are merged per entity (latest value wins) and sent one request at a time. A drag produces events faster
    /// than the runtime round trip, so unqueued requests piled up, finished out of order, and each one also re-fetched
    /// stale selection bounds, which is what made the gizmo and the entity jitter.
    private func queuePatch(_ op: [String: Any]) {
        guard let key = op["key"] as? String else { return }
        var merged = pendingPatches[key] ?? [:]
        for (k, v) in op { merged[k] = v }
        pendingPatches[key] = merged
        flushPatches()
    }

    private func flushPatches() {
        guard !patchInFlight, !pendingPatches.isEmpty else { return }
        let ops = Array(pendingPatches.values)
        pendingPatches = [:]
        patchInFlight = true
        Task {
            try? await host.request("applyPatch", ["ops": ops])
            roundTrips += 1
            patchInFlight = false
            if !pendingPatches.isEmpty { flushPatches() }
            else if case .idle = dragMode { await refreshSelectionBounds() } // during a drag the gizmo is moved locally
        }
    }

    func moveEntity(_ key: String, screenDelta d: CGSize) {
        let t = transform(key)
        setTransform(key, x: t.x + d.width / camera.zoom, y: t.y + d.height / camera.zoom)
        if var b = selectionBounds { b.cx += d.width; b.cy += d.height; selectionBounds = b } // optimistic
    }

    func fieldValue(_ key: String, _ field: String) -> Any? {
        (entityDoc(key)?["fields"] as? [String: Any])?[field]
    }

    func setField(_ key: String, _ field: String, _ value: Any) {
        mutate(key) { e in
            var f = e["fields"] as? [String: Any] ?? [:]
            f[field] = value
            e["fields"] = f
        }
        Task {
            try? await host.request("applyPatch", ["ops": [["op": "setField", "key": key, "field": field, "value": value]]])
            roundTrips += 1
            await refreshSelectionBounds()
        }
    }
}
