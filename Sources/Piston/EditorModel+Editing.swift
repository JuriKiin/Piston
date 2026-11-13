import SwiftUI

struct EntityTypeInfo: Hashable {
    let name: String
    let group: String
}

extension EditorModel {
    /// Places a new entity of a registered type at the centre of the Scene view. The runtime builds it (exactly like the
    /// engine's Add menu) and the editor stores the runtime's own saved form, so sizes and components are right.
    func addEntity(type: String, at world: CGPoint? = nil) async {
        guard !doc.isEmpty else { status = "Open a scene first"; return }
        // The runtime page can reload (a script changed) while we ask: wait for it to come back and try once more.
        for attempt in 0..<2 {
            do {
                guard let saved = try await host.request("createEntity", ["entityType": type, "x": (world.map { Double($0.x) } ?? camera.x).rounded(), "y": (world.map { Double($0.y) } ?? camera.y).rounded()]) as? [String: Any],
                      let key = saved["sceneKey"] as? String else {
                    status = "Couldn't add \(type): the runtime returned an unexpected reply"
                    return
                }
                roundTrips += 1
                var list = doc["entities"] as? [[String: Any]] ?? []
                list.append(saved)
                doc["entities"] = list
                dirty = true
                entities.append(EntitySummary(key: key, tag: saved["tag"] as? String ?? type, name: (saved["name"] as? String) ?? "",
                                              type: saved["type"] as? String, parentKey: nil))
                select(key)
                status = "Added \(type)"
                return
            } catch {
                let reloading = "\(error)".contains("reloaded") || "\(error)".contains("timed out")
                guard attempt == 0, reloading else {
                    status = "Couldn't add \(type): \(error.localizedDescription)"
                    return
                }
                try? await Task.sleep(nanoseconds: 800_000_000)
                for _ in 0..<100 where !runtimeReady { try? await Task.sleep(nanoseconds: 100_000_000) }
                try? await Task.sleep(nanoseconds: 600_000_000) // afterReady() re-sends the scene; let it finish
            }
        }
    }

    // MARK: Components

    func components(_ key: String) -> [[String: Any]] { entityDoc(key)?["components"] as? [[String: Any]] ?? [] }

    func componentField(_ key: String, _ index: Int, _ field: String) -> Any? {
        let list = components(key)
        guard index < list.count else { return nil }
        return (list[index]["fields"] as? [String: Any])?[field]
    }

    /// Edits go to the document first (instant UI, Save enables), then to the runtime so the viewport follows.
    func setComponentField(_ key: String, _ index: Int, _ field: String, _ value: Any) {
        if anim.recordField(key, index, field, value) { return }
        replaceComponents(key) { list in
            guard index < list.count else { return }
            var f = list[index]["fields"] as? [String: Any] ?? [:]
            f[field] = value
            list[index]["fields"] = f
        }
        Task { await sendComponentEdit(key, ["action": "setField", "index": index, "field": field, "value": value]) }
    }

    func addComponent(_ key: String, type: String) async {
        await sendComponentEdit(key, ["action": "add", "componentType": type])
    }

    func removeComponent(_ key: String, index: Int) {
        replaceComponents(key) { if index < $0.count { $0.remove(at: index) } }
        Task { await sendComponentEdit(key, ["action": "remove", "index": index]) }
    }

    private func replaceComponents(_ key: String, _ body: (inout [[String: Any]]) -> Void) {
        guard var list = doc["entities"] as? [[String: Any]],
              let i = list.firstIndex(where: { ($0["sceneKey"] as? String) == key }) else { return }
        var comps = list[i]["components"] as? [[String: Any]] ?? []
        body(&comps)
        list[i]["components"] = comps
        doc["entities"] = list
        dirty = true
    }

    private func sendComponentEdit(_ key: String, _ extra: [String: Any]) async {
        var payload = extra
        payload["key"] = key
        do {
            if let r = try await host.request("editComponent", payload) as? [String: Any],
               let comps = r["components"] as? [[String: Any]] {
                roundTrips += 1
                // For a new component the runtime's saved form wins (it knows the defaults). Field edits are not
                // overwritten: a late reply would clobber what was typed since.
                if extra["action"] as? String == "add" { replaceComponents(key) { $0 = comps } }
                await refreshSelectionBounds()
            }
        } catch {
            status = "Component edit failed: \(error.localizedDescription)"
        }
    }

    func duplicateEntity(_ key: String) async {
        if !selectedKeys.contains(key) { select(key) }
        await duplicateSelection()
    }

    func renameEntity(_ key: String, to name: String) {
        guard var list = doc["entities"] as? [[String: Any]],
              let i = list.firstIndex(where: { ($0["sceneKey"] as? String) == key }) else { return }
        list[i]["name"] = (name.isEmpty ? NSNull() : name) as Any
        doc["entities"] = list
        dirty = true
        if let j = entities.firstIndex(where: { $0.key == key }) {
            let old = entities[j]
            entities[j] = EntitySummary(key: key, tag: old.tag, name: name, type: old.type, parentKey: old.parentKey)
        }
        let value: Any = name.isEmpty ? NSNull() : name
        Task { _ = try? await host.request("applyPatch", ["ops": [["op": "setField", "key": key, "field": "name", "value": value]]]) }
    }

    func deleteSelection() {
        for k in selectedKeys { deleteEntity(k) }
    }

    func deleteEntity(_ key: String) {
        guard var list = doc["entities"] as? [[String: Any]],
              let i = list.firstIndex(where: { ($0["sceneKey"] as? String) == key }) else { return }
        list.remove(at: i)
        for j in list.indices where (list[j]["parentKey"] as? String) == key { list[j]["parentKey"] = NSNull() } // children survive, ungrouped
        doc["entities"] = list
        dirty = true
        entities.removeAll { $0.key == key }
        if selection == key { selection = nil; selectionBounds = nil }
        Task { _ = try? await host.request("applyPatch", ["ops": [["op": "removeEntity", "key": key]]]) }
    }
}
