import SwiftUI

struct PrefabInfo: Hashable, Identifiable { let id: String; let name: String }

/// Prefabs are saved entity blobs in the project's prefabs/ folder (same format the engine reads),
/// plus a manifest. Copy/paste uses an in-app clipboard that survives scene switches.
extension EditorModel {
    private var prefabsDir: URL? { projectURL?.appendingPathComponent("prefabs", isDirectory: true) }

    func loadPrefabList() -> [PrefabInfo] {
        guard let dir = prefabsDir, let data = try? Data(contentsOf: dir.appendingPathComponent("index.json")),
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return list.compactMap { e in (e["id"] as? String).map { PrefabInfo(id: $0, name: e["name"] as? String ?? $0) } }
    }

    func saveSelectionAsPrefab(named name: String) {
        guard let key = selection, let e = entityDoc(key), let dir = prefabsDir else { return }
        let id = Self.identifier(from: name).lowercased()
        guard !id.isEmpty else { status = "Give the prefab a name"; return }
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            var blob = e
            blob["parentKey"] = NSNull()
            try JSONSerialization.data(withJSONObject: blob, options: [.prettyPrinted, .sortedKeys]).write(to: dir.appendingPathComponent("\(id).json"))
            var list = loadPrefabList().filter { $0.id != id }.map { ["id": $0.id, "name": $0.name] }
            list.append(["id": id, "name": name])
            try JSONSerialization.data(withJSONObject: list, options: [.prettyPrinted]).write(to: dir.appendingPathComponent("index.json"))
            refreshFileTree()
            status = "Saved prefab \(name)"
        } catch { status = "Couldn't save prefab: \(error.localizedDescription)" }
    }

    func addPrefab(_ id: String, at world: CGPoint? = nil) async {
        guard let dir = prefabsDir, let data = try? Data(contentsOf: dir.appendingPathComponent("\(id).json")),
              var e = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { status = "Prefab \(id) is missing"; return }
        var t = e["transform"] as? [String: Any] ?? [:]
        t["position"] = ["x": (world.map { Double($0.x) } ?? camera.x).rounded(), "y": (world.map { Double($0.y) } ?? camera.y).rounded()]
        e["transform"] = t
        await insert([e], offset: 0)
    }

    /// The prefab id if `url` is a prefab file inside this project (prefabs/<id>.json), else nil.
    func prefabID(for url: URL) -> String? {
        guard let dir = prefabsDir?.resolvingSymlinksInPath().path, url.pathExtension == "json" else { return nil }
        let u = url.resolvingSymlinksInPath()
        guard u.deletingLastPathComponent().path == dir else { return nil }
        let id = u.deletingPathExtension().lastPathComponent
        return id == "index" ? nil : id
    }

    /// Viewport point -> world position (snapped when snapping is on).
    func worldPoint(forScreen s: CGPoint) -> CGPoint {
        var x = (s.x - viewportSize.width / 2) / camera.zoom + camera.x
        var y = (s.y - viewportSize.height / 2) / camera.zoom + camera.y
        if snapEnabled { x = (x / gridSize).rounded() * gridSize; y = (y / gridSize).rounded() * gridSize }
        return CGPoint(x: x, y: y)
    }

    func copySelection() {
        clipboard = withDescendants(selectedKeys).compactMap { entityDoc($0) }
        status = "Copied \(clipboard.count) \(clipboard.count == 1 ? "entity" : "entities")"
    }

    func pasteClipboard() async { await insert(clipboard, offset: 24) }

    func duplicateSelection() async {
        copySelectionSilently()
        await insert(clipboard, offset: 24)
    }

    private func copySelectionSilently() { clipboard = withDescendants(selectedKeys).compactMap { entityDoc($0) } }

    /// Adds saved entities to the document with fresh keys, then hot-reloads the runtime from the document.
    private func insert(_ list: [[String: Any]], offset: Double) async {
        guard !list.isEmpty, let id = currentScene else { return }
        var added: [String] = []
        var entitiesDoc = doc["entities"] as? [[String: Any]] ?? []
        // Groups stay groups: a copied parent's children are re-pointed at the new parent's key.
        var remap: [String: String] = [:]
        for e in list { if let old = e["sceneKey"] as? String { remap[old] = "added:\(UUID().uuidString.prefix(12).lowercased())" } }
        for var e in list {
            let newKey = remap[e["sceneKey"] as? String ?? ""] ?? "added:\(UUID().uuidString.prefix(12).lowercased())"
            e["sceneKey"] = newKey
            if let pk = e["parentKey"] as? String, let mapped = remap[pk] { e["parentKey"] = mapped } else { e["parentKey"] = NSNull() }
            var t = e["transform"] as? [String: Any] ?? [:]
            var p = t["position"] as? [String: Any] ?? [:]
            p["x"] = ((p["x"] as? NSNumber)?.doubleValue ?? 0) + offset
            p["y"] = ((p["y"] as? NSNumber)?.doubleValue ?? 0) + offset
            t["position"] = p
            e["transform"] = t
            entitiesDoc.append(e)
            added.append(newKey)
        }
        doc["entities"] = entitiesDoc
        dirty = true
        try? await sendScene(reloadFromDisk: false, id: id)
        let roots = list.indices.filter { i in (entitiesDoc.last(where: { ($0["sceneKey"] as? String) == added[i] })?["parentKey"] as? String) == nil }
        select(roots.first.map { added[$0] } ?? added.first)
        extraSelection = Set(roots.dropFirst().map { added[$0] })
        status = "Added \(added.count) \(added.count == 1 ? "entity" : "entities")"
    }
}
