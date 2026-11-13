import SwiftUI

/// The project's file explorer: browse, open, create (file, folder, scene, entity/component script),
/// rename, move to Trash, reveal in Finder.
struct ExplorerView: View {
    @ObservedObject var model: EditorModel
    @State private var selection: Set<URL> = []
    @State private var prompt: NamePrompt?
    @State private var promptText = ""
    @State private var trashTargets: [URL] = []
    @State private var errorText: String?
    @State private var scriptSheet: ScriptSheetRequest?
    @State private var spriteDir: URL?

    enum NamePrompt: Identifiable {
        case newFile(URL), newFolder(URL), newScene, rename(URL)

        var id: String {
            switch self {
            case .newFile(let u): return "file:\(u.path)"
            case .newFolder(let u): return "folder:\(u.path)"
            case .newScene: return "scene"
            case .rename(let u): return "rename:\(u.path)"
            }
        }

        var title: String {
            switch self {
            case .newFile: return "New File"
            case .newFolder: return "New Folder"
            case .newScene: return "New Scene"
            case .rename: return "Rename"
            }
        }

        var action: String {
            if case .rename = self { return "Rename" }
            return "Create"
        }

        var defaultText: String {
            switch self {
            case .newFile: return "untitled.txt"
            case .newFolder: return "New Folder"
            case .newScene: return "New Scene"
            case .rename(let u): return u.lastPathComponent
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            List(selection: $selection) {
                OutlineGroup(model.fileTree, children: \.children) { node in
                    Label(node.name, systemImage: node.icon)
                        .tag(node.url)
                        .draggable(node.url) // drop onto an Inspector path field
                }
            }
            .listStyle(.sidebar)
            .contextMenu(forSelectionType: URL.self) { urls in
                menu(for: urls)
            } primaryAction: { urls in
                if let u = urls.first, !isDirectory(u) { model.openFile(u) }
            }
            .alert(prompt?.title ?? "", isPresented: Binding(get: { prompt != nil }, set: { if !$0 { prompt = nil } })) {
                TextField("Name", text: $promptText)
                Button(prompt?.action ?? "OK") {
                    if let p = prompt { commit(p, name: promptText) }
                    prompt = nil
                }
                Button("Cancel", role: .cancel) { prompt = nil }
            }
        }
        .confirmationDialog(trashTitle, isPresented: Binding(get: { !trashTargets.isEmpty }, set: { if !$0 { trashTargets = [] } }),
                            titleVisibility: .visible) {
            Button("Move to Trash", role: .destructive) {
                for url in trashTargets {
                    do { try model.trash(url) } catch { errorText = error.localizedDescription }
                }
                trashTargets = []
                selection = []
            }
            Button("Cancel", role: .cancel) { trashTargets = [] }
        }
        .sheet(item: $scriptSheet) { NewScriptSheet(model: model, request: $0) }
        .sheet(isPresented: Binding(get: { spriteDir != nil }, set: { if !$0 { spriteDir = nil } })) {
            if let dir = spriteDir { NewSpriteSheet(model: model, directory: dir) { spriteDir = nil } }
        }
        .alert("Couldn't complete that", isPresented: Binding(get: { errorText != nil }, set: { if !$0 { errorText = nil } })) {
            Button("OK") { errorText = nil }
        } message: {
            Text(errorText ?? "")
        }
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 6) {
            Image(systemName: "shippingbox").foregroundStyle(.secondary)
            Text(model.projectName).font(.callout.weight(.semibold)).lineLimit(1)
            Spacer()
            Menu {
                creationItems(in: targetDir(selection))
            } label: {
                Image(systemName: "plus")
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .help("New…")
            Button { model.refreshFileTree() } label: { Image(systemName: "arrow.clockwise") }
                .buttonStyle(.borderless)
                .help("Refresh")
            Button {
                if let url = model.projectURL { model.reveal(url) }
            } label: { Image(systemName: "folder") }
                .buttonStyle(.borderless)
                .help("Reveal project in Finder")
        }
        .padding(.horizontal, 10)
        .frame(height: 32)
    }

    // MARK: Menus

    @ViewBuilder
    private func creationItems(in dir: URL) -> some View {
        Button("New File…") { promptText = NamePrompt.newFile(dir).defaultText; prompt = .newFile(dir) }
        Button("New Folder…") { promptText = NamePrompt.newFolder(dir).defaultText; prompt = .newFolder(dir) }
        Divider()
        Button("New Entity Script…") { scriptSheet = ScriptSheetRequest(kind: .entity, directory: model.scriptsDirectory(near: dir)) }
        Button("New Component Script…") { scriptSheet = ScriptSheetRequest(kind: .component, directory: model.scriptsDirectory(near: dir)) }
        Button("New Scene…") { promptText = NamePrompt.newScene.defaultText; prompt = .newScene }
        Button("New Sprite…") { spriteDir = dir }
    }

    @ViewBuilder
    private func menu(for urls: Set<URL>) -> some View {
        creationItems(in: targetDir(urls))
        if let u = urls.first {
            Divider()
            Button("Open") { model.openFile(u) }
            Button("Reveal in Finder") { model.reveal(u) }
            Button("Rename…") { promptText = NamePrompt.rename(u).defaultText; prompt = .rename(u) }
            Divider()
            Button("Move to Trash", role: .destructive) { trashTargets = Array(urls) }
        }
    }

    // MARK: Helpers

    private var trashTitle: String {
        trashTargets.count == 1 ? "Move \(trashTargets[0].lastPathComponent) to the Trash?" : "Move \(trashTargets.count) items to the Trash?"
    }

    private func isDirectory(_ url: URL) -> Bool {
        var isDir: ObjCBool = false
        FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir)
        return isDir.boolValue
    }

    /// Where "New…" puts things: the selected folder, or the selected file's folder, or the project root.
    private func targetDir(_ urls: Set<URL>) -> URL {
        guard let root = model.projectURL else { return URL(fileURLWithPath: "/") }
        guard let u = urls.first else { return root }
        return isDirectory(u) ? u : u.deletingLastPathComponent()
    }

    private func commit(_ prompt: NamePrompt, name: String) {
        do {
            switch prompt {
            case .newFile(let dir):
                model.openFile(try model.createFile(in: dir, name: name))
            case .newFolder(let dir):
                try model.createFolder(in: dir, name: name)
            case .newScene:
                let id = try model.createScene(name: name)
                model.activeTab = .scene
                Task { try? await model.loadScene(id) }
            case .rename(let url):
                try model.rename(url, to: name)
            }
        } catch {
            errorText = error.localizedDescription
        }
    }
}
