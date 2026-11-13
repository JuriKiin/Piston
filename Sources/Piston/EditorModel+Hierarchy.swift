import SwiftUI

struct HierarchyRow: Identifiable {
    let key: String
    let depth: Int
    let hasChildren: Bool
    var id: String { key }
}

/// Parenting. The engine treats a parent as a world-space group: moving a parent moves its children (rotation and
/// scale don't cascade). The editor stores it as `parentKey` on each saved entity.
extension EditorModel {
    private func parentOf(_ key: String) -> String? { entityDoc(key)?["parentKey"] as? String }

    func children(of key: String) -> [String] {
        (doc["entities"] as? [[String: Any]] ?? []).filter { ($0["parentKey"] as? String) == key }.compactMap { $0["sceneKey"] as? String }
    }

    func descendants(of key: String) -> [String] {
        var out: [String] = [], stack = children(of: key)
        while let k = stack.popLast() { out.append(k); stack += children(of: k) }
        return out
    }

    func withDescendants(_ keys: Set<String>) -> [String] {
        var seen = Set<String>(), ordered: [String] = []
        for k in (doc["entities"] as? [[String: Any]] ?? []).compactMap({ $0["sceneKey"] as? String }) where keys.contains(k) || !keys.isDisjoint(with: ancestors(of: k)) {
            if seen.insert(k).inserted { ordered.append(k) }
        }
        return ordered
    }

    func ancestors(of key: String) -> [String] {
        var out: [String] = [], cur = parentOf(key)
        while let p = cur, !out.contains(p) { out.append(p); cur = parentOf(p) }
        return out
    }

    /// The hierarchy as an indented, collapsible tree in document order.
    func hierarchyRows() -> [HierarchyRow] {
        let all = (doc["entities"] as? [[String: Any]] ?? []).compactMap { $0["sceneKey"] as? String }
        let known = Set(all)
        var rows: [HierarchyRow] = []
        func visit(_ key: String, _ depth: Int) {
            let kids = children(of: key)
            rows.append(HierarchyRow(key: key, depth: depth, hasChildren: !kids.isEmpty))
            if !collapsed.contains(key) { kids.forEach { visit($0, depth + 1) } }
        }
        for k in all {
            if let p = parentOf(k), known.contains(p) { continue }
            visit(k, 0)
        }
        return rows
    }

    func canParent(_ child: String, under parent: String?) -> Bool {
        guard let parent else { return true }
        return child != parent && !ancestors(of: parent).contains(child)
    }

    /// Drag an entity onto another to parent it; `nil` unparents. Position doesn't change (world-space grouping).
    func setParent(_ child: String, to parent: String?) async { await setParents([child], to: parent) }

    /// The same for a whole selection at once: every entity that can legally move under `parent` does, in one change (one undo step).
    func setParents(_ children: [String], to parent: String?) async {
        guard let id = currentScene, var list = doc["entities"] as? [[String: Any]] else { return }
        var moved = 0
        for child in children where canParent(child, under: parent) {
            guard let i = list.firstIndex(where: { ($0["sceneKey"] as? String) == child }), (list[i]["parentKey"] as? String) != parent else { continue }
            list[i]["parentKey"] = parent as Any? ?? NSNull()
            moved += 1
        }
        guard moved > 0 else { return }
        doc["entities"] = list
        dirty = true
        if let parent { collapsed.remove(parent) }
        let keep = selection, extra = extraSelection
        try? await sendScene(reloadFromDisk: false, id: id) // the runtime rebuilds the group from the document
        if let keep { select(keep); extraSelection = extra }
        status = parent == nil ? "Unparented \(moved)" : "Parented \(moved) to \(parent.flatMap { p in entities.first { $0.key == p }.map { $0.name.isEmpty ? $0.tag : $0.name } } ?? "parent")"
    }
}
