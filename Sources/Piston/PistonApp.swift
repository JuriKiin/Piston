import SwiftUI
import AppKit

/// Quit protection: ⌘Q with unsaved work asks first, so closing Piston can never silently throw edits away.
final class AppDelegate: NSObject, NSApplicationDelegate {
    @MainActor static weak var model: EditorModel?

    @MainActor
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let model = Self.model, model.hasAnyUnsavedWork else { return .terminateNow }
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "You have unsaved changes"
        alert.informativeText = model.unsavedSummary + "\n\nSave them before quitting?"
        alert.addButton(withTitle: "Save and Quit")
        alert.addButton(withTitle: "Quit Without Saving")
        alert.addButton(withTitle: "Cancel")
        switch alert.runModal() {
        case .alertFirstButtonReturn: model.saveEverything(); return .terminateNow
        case .alertSecondButtonReturn: return .terminateNow
        default: return .terminateCancel
        }
    }
}

@main
struct PistonApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = EditorModel()

    var body: some Scene {
        WindowGroup("Piston") {
            RootView(model: model)
                .frame(minWidth: 900, minHeight: 600)
                .task { AppDelegate.model = model; await bootstrap() }
        }
        .defaultSize(width: 1400, height: 840)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Project…") { model.showNewProject = true }.keyboardShortcut("n")
                Button("Open Project…") { if model.confirmLeavingUnsavedWork("opening another project") { model.chooseAndOpenProject() } }.keyboardShortcut("o")
                Menu("Open Recent") {
                    ForEach(model.recents.prefix(8)) { r in
                        Button(r.name) { if model.confirmLeavingUnsavedWork("opening another project") { model.open(r) } }
                    }
                    if !model.recents.isEmpty {
                        Divider()
                        Button("Clear Menu") { model.clearRecents() }
                    }
                }
                .disabled(model.recents.isEmpty)
                Divider()
                Button("Close Project") { if model.confirmLeavingUnsavedWork("closing the project") { model.closeProject() } }
                    .keyboardShortcut("w", modifiers: [.command, .shift])
                    .disabled(model.projectURL == nil)
            }
            CommandGroup(replacing: .undoRedo) {
                // Scene tab: undo the scene document. A script tab keeps the text editor's own undo.
                Button("Undo") {
                    if model.activeTab == .scene { model.undo() } else if model.activeIsImage { PixelDoc.active?.undo() } else if let ed = CodeEditorHost.active { ed.run("undo()") } else { NSApp.sendAction(Selector(("undo:")), to: nil, from: nil) }
                }.keyboardShortcut("z")
                Button("Redo") {
                    if model.activeTab == .scene { model.redo() } else if model.activeIsImage { PixelDoc.active?.redo() } else if let ed = CodeEditorHost.active { ed.run("redo()") } else { NSApp.sendAction(Selector(("redo:")), to: nil, from: nil) }
                }.keyboardShortcut("z", modifiers: [.command, .shift])
            }
            CommandGroup(replacing: .saveItem) {
                Button("Save") { model.saveActive() }.keyboardShortcut("s")
                Button("Save All") { model.saveAll() }.keyboardShortcut("s", modifiers: [.command, .option])
            }
            CommandMenu("Build") {
                Button("Build Development") { Task { await model.build(.development) } }
                    .keyboardShortcut("b")
                    .disabled(model.projectURL == nil || model.isBuilding)
                Button("Build Release") { Task { await model.build(.release) } }
                    .keyboardShortcut("b", modifiers: [.command, .shift])
                    .disabled(model.projectURL == nil || model.isBuilding)
                Divider()
                Button("Run Build in Browser") { Task { await model.runBuildInBrowser() } }
                    .keyboardShortcut("b", modifiers: [.command, .option])
                    .disabled(model.lastBuild?.ok != true)
                Button("Validate Scene") { Task { await model.validateScene() } }.disabled(model.projectURL == nil || model.doc.isEmpty)
                Button("Reveal Build Folder") { model.revealBuild() }
                    .disabled(model.lastBuild?.outputURL == nil)
            }
            CommandGroup(replacing: .help) {
                Button("Piston Documentation") { model.openDocs() }.keyboardShortcut("/", modifiers: [.command, .shift])
                Menu("Guides") {
                    ForEach(DocsLibrary.guides) { g in Button(g.title) { model.openDocs(g.slug) } }
                    Divider()
                    Button("Component reference") { model.openDocs("ref-components") }
                    Button("Entity reference") { model.openDocs("ref-entities") }
                }
            }
            CommandMenu("Entity") {
                Button("Duplicate") { Task { await model.duplicateSelection() } }.keyboardShortcut("d")
                Button("Copy Entity") { model.copySelection() }.keyboardShortcut("c", modifiers: [.command, .shift])
                Button("Paste Entity") { Task { await model.pasteClipboard() } }.keyboardShortcut("v", modifiers: [.command, .shift])
                Divider()
                Button("Delete") { model.deleteSelection() }.keyboardShortcut(.delete, modifiers: [.command])
            }
            CommandMenu("Plugins") {
                if model.plugins.plugins.isEmpty { Text("No plugins installed") }
                ForEach(model.plugins.menuItems) { item in Button(item.title) { model.plugins.run(item) } }
                ForEach(model.plugins.plugins.filter { $0.state == .needsTrust }) { p in
                    Button("Enable “\(p.name)”…") { model.plugins.confirmTrust(p.id) }
                }
                ForEach(model.plugins.plugins) { p in
                    if case .failed(let why) = p.state { Text("\(p.name) failed: \(why)") }
                }
                Divider()
                Button("New Plugin…") { model.promptNewPlugin() }.disabled(model.projectURL == nil)
                Button("Reload Plugins") { model.plugins.reload(announce: true) }.disabled(model.projectURL == nil)
                Button("Show Plugins Folder") {
                    try? FileManager.default.createDirectory(at: PluginHost.globalDirectory, withIntermediateDirectories: true)
                    NSWorkspace.shared.open(PluginHost.globalDirectory)
                }
            }
            CommandMenu("Game") {
                Button("Play") { Task { await model.play() } }
                    .keyboardShortcut("r")
                    .disabled(model.playState == .playing || model.projectURL == nil)
                Button("Pause") { Task { await model.pause() } }
                    .keyboardShortcut("p", modifiers: [.command, .shift])
                    .disabled(model.playState != .playing)
                Button("Step Frame") { Task { await model.step() } }
                    .keyboardShortcut("'")
                    .disabled(model.playState == .playing || model.projectURL == nil)
                Button("Stop") { model.stopGame() }
                    .keyboardShortcut(".")
                    .disabled(model.playState == .stopped)
            }
        }

        // Pop-out windows: any open file, or the documentation, in its own window.
        WindowGroup("Piston", for: PopoutItem.self) { $item in
            if let item { PopoutView(model: model, item: item) }
        }
    }

    private func bootstrap() async {
        let args = ProcessInfo.processInfo.arguments
        NSApp.activate(ignoringOtherApps: true)

        // `--build <project> [--release]`: build from the command line and exit (no window work needed).
        if let i = args.firstIndex(of: "--build"), i + 1 < args.count {
            let report = BuildSystem(project: URL(fileURLWithPath: args[i + 1]), engineRoot: EditorModel.engineRoot(),
                                     templatesRoot: EditorModel.templatesRoot())
                .build(mode: args.contains("--release") ? .release : .development)
            for m in report.messages { print("[\(m.level)] \(m.text)") }
            print(report.ok ? "BUILD OK" : "BUILD FAILED")
            exit(report.ok ? 0 : 1)
        }

        // `--serve <folder>`: serve a finished build on localhost until killed (to try it in a browser).
        if let i = args.firstIndex(of: "--serve"), i + 1 < args.count {
            let dir = URL(fileURLWithPath: args[i + 1])
            let server = HTTPServer(projectRoot: dir, bridgeRoot: dir, engineRoot: dir)
            if let port = try? await server.start() {
                FileHandle.standardOutput.write(Data("SERVING http://127.0.0.1:\(port)/\n".utf8))
            }
            await withCheckedContinuation { (_: CheckedContinuation<Void, Never>) in }
        }

        if let dir = ProcessInfo.processInfo.environment["PISTON_BRAND_SHOT"] {
            await BrandShots.run(model: model, dir: dir)
            exit(0)
        }

        if args.contains("--selftest") {
            // Work on a throwaway copy of the sample so the test can edit files freely.
            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("piston-selftest-\(UUID().uuidString)")
            try? FileManager.default.copyItem(at: EditorModel.samplesRoot().appendingPathComponent("MiniGolf"), to: tmp)
            model.persistRecents = false
            await model.openProject(tmp)
            let ok = await SelfTest.run(model: model, project: tmp)
            exit(ok ? 0 : 1)
        }

        // Developer shortcuts. With none of these you land on the Hub, like a user would.
        if let i = args.firstIndex(of: "--project"), i + 1 < args.count {
            await model.openProject(URL(fileURLWithPath: args[i + 1]))
        } else if let i = args.firstIndex(of: "--sample"), i + 1 < args.count {
            await model.openSample(args[i + 1])
        } else {
            return
        }
        // `--select Ball` selects the first entity of that type once loaded (handy for screenshots).
        if let i = args.firstIndex(of: "--select"), i + 1 < args.count {
            _ = await model.waitUntilReady()
            try? await Task.sleep(nanoseconds: 800_000_000)
            if let e = model.entities.first(where: { $0.type == args[i + 1] }) { model.select(e.key) }
        }
        if args.contains("--play") {
            _ = await model.waitUntilReady()
            await model.play()
        }
        if let i = args.firstIndex(of: "--open"), i + 1 < args.count, let root = model.projectURL {
            model.openFile(root.appendingPathComponent(args[i + 1]))
        }
    }
}
