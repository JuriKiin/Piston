import SwiftUI
import AppKit

struct RecentProject: Codable, Identifiable, Hashable {
    var path: String
    var name: String
    var platform: String
    var opened: Date
    var id: String { path }
}

extension EditorModel {
    // MARK: Locations

    /// Where New Project puts things by default: ~/Documents/Piston Projects.
    static var defaultProjectsDirectory: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory())
        return docs.appendingPathComponent("Piston Projects", isDirectory: true)
    }

    var engineVersion: String {
        let raw = (try? String(contentsOf: Self.engineRoot().appendingPathComponent("VERSION"), encoding: .utf8)) ?? "?"
        return raw.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: Recent projects

    func loadRecents() {
        guard let data = UserDefaults.standard.data(forKey: "recentProjects"),
              let list = try? JSONDecoder().decode([RecentProject].self, from: data) else { return }
        recents = list
    }

    private func saveRecents() {
        guard persistRecents else { return }
        if let data = try? JSONEncoder().encode(recents) { UserDefaults.standard.set(data, forKey: "recentProjects") }
    }

    func noteOpened(_ url: URL) {
        let entry = RecentProject(path: url.path, name: projectName, platform: platform, opened: Date())
        recents = Array(([entry] + recents.filter { $0.path != url.path }).prefix(12))
        saveRecents()
    }

    func removeRecent(_ r: RecentProject) {
        recents.removeAll { $0.path == r.path }
        saveRecents()
    }

    func clearRecents() {
        recents = []
        saveRecents()
    }

    // MARK: Opening and closing

    func chooseAndOpenProject() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.message = "Choose a Piston project folder (contains project.piston.json)"
        panel.directoryURL = Self.defaultProjectsDirectory
        if panel.runModal() == .OK, let url = panel.url {
            Task { await openProject(url) }
        }
    }

    func open(_ recent: RecentProject) {
        let url = URL(fileURLWithPath: recent.path)
        guard FileManager.default.fileExists(atPath: url.path) else {
            status = "\(recent.name) is missing"
            return
        }
        Task { await openProject(url) }
    }

    /// Back to the Hub. Unsaved work is the caller's concern (see `hasUnsaved`).
    func closeProject() {
        stopGame()
        watcher?.stop()
        watcher = nil
        host.webView.load(URLRequest(url: URL(string: "about:blank")!))
        projectURL = nil
        projectName = "-"
        sceneIDs = []
        currentScene = nil
        doc = [:]
        dirty = false
        entities = []
        selection = nil
        selectionBounds = nil
        entitySchemas = [:]
        tabs = [.scene, .game]
        activeTab = .scene
        textDocs = [:]
        fileTree = []
        logs = []
        runtimeReady = false
        status = "Ready"
    }

    // MARK: Creating

    /// New project from the blank template (web). The engine is NOT copied in: it ships with Piston.
    @discardableResult
    func createProject(name: String, in parent: URL) async throws -> URL {
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, !clean.contains("/"), !clean.contains(":"), !clean.hasPrefix(".") else { throw FileOpError.invalidName }
        let fm = FileManager.default
        try fm.createDirectory(at: parent, withIntermediateDirectories: true)

        var dest = parent.appendingPathComponent(clean, isDirectory: true)
        var n = 2
        while fm.fileExists(atPath: dest.path) { dest = parent.appendingPathComponent("\(clean) \(n)", isDirectory: true); n += 1 }

        try fm.copyItem(at: Self.templatesRoot().appendingPathComponent("blank"), to: dest)
        let descriptor = dest.appendingPathComponent("project.piston.json")
        let text = try String(contentsOf: descriptor, encoding: .utf8)
        let escaped = clean.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        try text.replacingOccurrences(of: "__NAME__", with: escaped).write(to: descriptor, atomically: true, encoding: .utf8)

        await openProject(dest)
        return dest
    }

    /// Copies a bundled sample into the user's projects folder (once) and opens it.
    func openSample(_ name: String) async {
        let fm = FileManager.default
        let source = Self.samplesRoot().appendingPathComponent(name)
        guard fm.fileExists(atPath: source.path) else { status = "Sample \(name) not found"; return }
        var title = name
        if let data = try? Data(contentsOf: source.appendingPathComponent("project.piston.json")),
           let cfg = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let n = cfg["name"] as? String { title = n }
        var dest = Self.defaultProjectsDirectory.appendingPathComponent(title, isDirectory: true)
        func revision(_ url: URL) -> Int {
            guard let data = try? Data(contentsOf: url.appendingPathComponent("project.piston.json")),
                  let cfg = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return 1 }
            return (cfg["sampleRevision"] as? NSNumber)?.intValue ?? 1
        }
        do {
            if !fm.fileExists(atPath: dest.path) {
                try fm.createDirectory(at: Self.defaultProjectsDirectory, withIntermediateDirectories: true)
                try fm.copyItem(at: source, to: dest)
            } else if revision(source) > revision(dest) {
                // The sample shipped with this version of Piston is newer than the copy in your projects folder. Never overwrite your copy:
                // offer the new one alongside it.
                let alert = NSAlert()
                alert.messageText = "A newer \(title) sample is available"
                alert.informativeText = "Your copy in \(Self.defaultProjectsDirectory.lastPathComponent) is from an older version of Piston. Open the new sample as a separate project, or keep working in your copy."
                alert.addButton(withTitle: "Open New Sample")
                alert.addButton(withTitle: "Open My Copy")
                if alert.runModal() == .alertFirstButtonReturn {
                    var n = 2
                    var fresh = Self.defaultProjectsDirectory.appendingPathComponent("\(title) \(n)", isDirectory: true)
                    while fm.fileExists(atPath: fresh.path) { n += 1; fresh = Self.defaultProjectsDirectory.appendingPathComponent("\(title) \(n)", isDirectory: true) }
                    try fm.copyItem(at: source, to: fresh)
                    dest = fresh
                }
            }
            await openProject(dest)
        } catch {
            status = "Couldn't open sample: \(error.localizedDescription)"
        }
    }
}
