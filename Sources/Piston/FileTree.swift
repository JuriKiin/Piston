import Foundation

/// One entry in the project's file explorer.
struct FileNode: Identifiable, Hashable {
    let url: URL
    let isDir: Bool
    /// nil for files (what `OutlineGroup` needs to show no disclosure triangle).
    var children: [FileNode]?
    var id: URL { url }
    var name: String { url.lastPathComponent }

    static func == (a: FileNode, b: FileNode) -> Bool { a.url == b.url && a.isDir == b.isDir }
    func hash(into hasher: inout Hasher) { hasher.combine(url) }

    private static let hiddenNames: Set<String> = [".git", ".DS_Store", ".piston", ".build", "node_modules", "dist"]

    /// Scans `dir` into a sorted tree: folders first, then files, each alphabetically. Capped so a huge
    /// folder can't stall the UI.
    static func scan(_ dir: URL) -> [FileNode] {
        var remaining = 5000
        return scan(dir, depth: 0, remaining: &remaining)
    }

    private static func scan(_ dir: URL, depth: Int, remaining: inout Int) -> [FileNode] {
        guard depth < 10, remaining > 0 else { return [] }
        let fm = FileManager.default
        let items = (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.isDirectoryKey],
                                                  options: [.skipsHiddenFiles])) ?? []
        var folders: [FileNode] = []
        var files: [FileNode] = []
        for url in items where !hiddenNames.contains(url.lastPathComponent) {
            remaining -= 1
            let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            if isDir {
                folders.append(FileNode(url: url, isDir: true, children: scan(url, depth: depth + 1, remaining: &remaining)))
            } else {
                files.append(FileNode(url: url, isDir: false, children: nil))
            }
        }
        let byName: (FileNode, FileNode) -> Bool = { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        return folders.sorted(by: byName) + files.sorted(by: byName)
    }

    /// SF Symbol for the row.
    var icon: String {
        if isDir { return "folder" }
        switch url.pathExtension.lowercased() {
        case "js", "mjs": return "curlybraces"
        case "json": return "doc.text"
        case "html", "htm": return "chevron.left.forwardslash.chevron.right"
        case "png", "jpg", "jpeg", "gif", "webp", "svg": return "photo"
        case "mp3", "wav", "ogg": return "waveform"
        case "md", "txt": return "doc.plaintext"
        default: return "doc"
        }
    }
}

enum EditorTab: Hashable {
    case scene
    case game
    case docs
    case file(URL)
}

struct TextDoc {
    var text: String
    var saved: String
    var isImage = false
    var isDirty: Bool { !isImage && text != saved }
}

enum BottomTab: String, CaseIterable { case console = "Console", animation = "Animation" }

enum PlayState { case stopped, playing, paused }

struct PlayInfo {
    var playState: String
    var frames: Int
    var entityCount: Int
    var scene: String?
    var mouseDowns = 0
}
