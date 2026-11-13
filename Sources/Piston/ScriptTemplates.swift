import Foundation

/// A starting point for a new script, like Unity's "Create > C# Script" templates. Templates are plain `.js` files with a
/// small header (`// @template: Name`, `// @kind: entity|component`, `// @summary: …`) and `{{Class}}` placeholders.
/// Piston ships some; any `.js` file you drop into ~/Library/Application Support/Piston/Templates/Scripts/ shows up too.
struct ScriptTemplate: Identifiable, Hashable {
    let id: String
    let name: String
    let kind: ScriptKind
    let summary: String
    let body: String
    let isUser: Bool

    func render(className: String) -> String {
        body.replacingOccurrences(of: "{{Class}}", with: className)
            .replacingOccurrences(of: "{{Tag}}", with: className)
    }
}

enum ScriptKind { case entity, component }

enum ScriptTemplates {
    static var userFolder: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("Piston/Templates/Scripts", isDirectory: true)
    }

    private static func bundledFolder() -> URL {
        if let res = Bundle.main.resourceURL?.appendingPathComponent("Templates/scripts"),
           FileManager.default.fileExists(atPath: res.path) { return res }
        return URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Templates/scripts")
    }

    static func all() -> [ScriptTemplate] {
        load(from: bundledFolder(), isUser: false) + load(from: userFolder, isUser: true)
    }

    static func templates(for kind: ScriptKind) -> [ScriptTemplate] { all().filter { $0.kind == kind } }

    static func defaultTemplate(for kind: ScriptKind) -> ScriptTemplate {
        let wanted = kind == .entity ? "entity-shape" : "component-blank"
        return all().first { $0.id == wanted } ?? all().first { $0.kind == kind }
            ?? ScriptTemplate(id: "fallback", name: "Empty", kind: kind, summary: "", body: "// {{Class}}\n", isUser: false)
    }

    private static func load(from folder: URL, isUser: Bool) -> [ScriptTemplate] {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        return files.filter { $0.pathExtension == "js" }.sorted { $0.lastPathComponent < $1.lastPathComponent }.compactMap { url in
            guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
            var meta: [String: String] = [:]
            var bodyLines: [Substring] = []
            var inHeader = true
            for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
                if inHeader, line.hasPrefix("// @"), let colon = line.firstIndex(of: ":") {
                    let key = line[line.index(line.startIndex, offsetBy: 4)..<colon].trimmingCharacters(in: .whitespaces)
                    meta[key] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
                } else {
                    inHeader = false
                    bodyLines.append(line)
                }
            }
            let id = url.deletingPathExtension().lastPathComponent
            let kind: ScriptKind = (meta["kind"] ?? (id.hasPrefix("component") ? "component" : "entity")) == "component" ? .component : .entity
            return ScriptTemplate(id: (isUser ? "user:" : "") + id, name: meta["template"] ?? id, kind: kind,
                                  summary: meta["summary"] ?? "", body: bodyLines.joined(separator: "\n"), isUser: isUser)
        }
    }
}
