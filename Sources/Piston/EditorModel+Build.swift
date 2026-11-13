import SwiftUI
import AppKit

extension EditorModel {
    /// Saves your work, validates the project, and writes `dist/web` (see docs/BUILD.md). Messages go to the Console.
    func build(_ mode: BuildMode) async {
        guard let projectURL, !isBuilding else { return }
        saveAll()
        isBuilding = true
        status = "Building (\(mode.rawValue))…"
        let engine = Self.engineRoot(), templates = Self.templatesRoot()
        let hooks = plugins.buildHooks
        let report = await Task.detached(priority: .userInitiated) {
            var system = BuildSystem(project: projectURL, engineRoot: engine, templatesRoot: templates)
            system.afterBundleHooks = hooks
            return system.build(mode: mode)
        }.value
        lastBuild = report
        for m in report.messages {
            logs.append(LogLine(level: m.level == .error ? "error" : (m.level == .warning ? "warn" : "log"), text: m.text, source: "build"))
        }
        if report.ok {
            let warn = report.warnings.isEmpty ? "" : ", \(report.warnings.count) warning\(report.warnings.count == 1 ? "" : "s")"
            status = "Built \(mode.rawValue): \(report.fileCount) files, \(BuildSystem.sizeString(report.bytes))\(warn)"
        } else {
            status = "Build failed: \(report.errors.count) error\(report.errors.count == 1 ? "" : "s") (see Console)"
        }
        isBuilding = false
    }

    /// Serves the last build from a local server and opens it in your browser.
    func runBuildInBrowser() async {
        guard let out = lastBuild?.outputURL, lastBuild?.ok == true else { status = "Build first (⌘B)"; return }
        do {
            let server = previewServer ?? HTTPServer(projectRoot: out, bridgeRoot: out, engineRoot: out)
            if previewServer == nil {
                _ = try await server.start()
                previewServer = server
            } else {
                server.projectRoot = out
            }
            if let url = URL(string: "http://127.0.0.1:\(server.port)/") { NSWorkspace.shared.open(url) }
        } catch {
            status = "Couldn't start the preview server: \(error.localizedDescription)"
        }
    }

    func revealBuild() {
        if let out = lastBuild?.outputURL { reveal(out) }
    }
}
