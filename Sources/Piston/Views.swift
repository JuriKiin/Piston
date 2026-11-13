import SwiftUI

struct ProjectView: View {
    @ObservedObject var model: EditorModel

    var body: some View {
        HSplitView {
            LeftPanel(model: model)
                .frame(minWidth: 160, idealWidth: 250, maxWidth: 700)
            CenterPanel(model: model)
                .frame(minWidth: 360)
            InspectorView(model: model, anim: model.anim)
                .frame(minWidth: 200, idealWidth: 290, maxWidth: 700)
        }
        .toolbar { EditorToolbar(model: model) }
        .sheet(item: $model.pluginDialog) { d in PluginDialogView(dialog: d) { model.pluginDialog = nil } }
        .confirmationDialog(closeTitle, isPresented: Binding(get: { model.pendingClose != nil },
                                                              set: { if !$0 { model.pendingClose = nil } }),
                            titleVisibility: .visible) {
            Button("Save") {
                if case .file(let url)? = model.pendingClose { model.saveFile(url); model.forceCloseTab(.file(url)) }
            }
            Button("Discard Changes", role: .destructive) {
                if let tab = model.pendingClose { model.forceCloseTab(tab) }
            }
            Button("Cancel", role: .cancel) { model.pendingClose = nil }
        }
    }

    private var closeTitle: String {
        if case .file(let url)? = model.pendingClose { return "Save changes to \(url.lastPathComponent)?" }
        return "Save changes?"
    }
}

// MARK: Window toolbar: Play / Pause / Step / Stop, status, Save

struct EditorToolbar: ToolbarContent {
    @ObservedObject var model: EditorModel

    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .navigation) {
            Button { Task { await model.play() } } label: {
                Label(model.playState == .paused ? "Resume" : "Play", systemImage: "play.fill")
            }
            .help("Play (⌘R)")
            .disabled(model.playState == .playing)

            Button { Task { await model.pause() } } label: { Label("Pause", systemImage: "pause.fill") }
                .help("Pause (⇧⌘P)")
                .disabled(model.playState != .playing)

            Button { Task { await model.step() } } label: { Label("Step", systemImage: "forward.frame.fill") }
                .help("Step one frame (⌘')")
                .disabled(model.playState == .playing)

            Button { model.stopGame() } label: { Label("Stop", systemImage: "stop.fill") }
                .help("Stop (⌘.)")
                .disabled(model.playState == .stopped)
        }
        ToolbarItem(placement: .principal) {
            HStack(spacing: 8) {
                PlayStateBadge(state: model.playState)
                Text(model.status).font(.callout).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        ToolbarItemGroup(placement: .primaryAction) {
            Menu {
                Button("Build Development  ⌘B") { Task { await model.build(.development) } }
                Button("Build Release  ⇧⌘B") { Task { await model.build(.release) } }
                Divider()
                Button("Run Build in Browser") { Task { await model.runBuildInBrowser() } }.disabled(model.lastBuild?.ok != true)
                Button("Reveal Build Folder") { model.revealBuild() }.disabled(model.lastBuild?.outputURL == nil)
            } label: {
                Label("Build", systemImage: model.isBuilding ? "hourglass" : "hammer")
            }
            .help("Build the game for the web (⌘B)")
            .disabled(model.isBuilding)
            Button { model.openDocs() } label: { Label("Docs", systemImage: "book") }
                .help("Documentation (⇧⌘/)")
            Button { model.saveActive() } label: {
                Label("Save", systemImage: "square.and.arrow.down")
            }
            .help("Save (⌘S)")
            .disabled(!model.activeIsDirty)
            Button { model.saveAll() } label: { Label("Save All", systemImage: "square.and.arrow.down.on.square") }
                .help("Save all (⌥⌘S)")
                .disabled(!model.hasUnsaved)
        }
    }
}

struct PlayStateBadge: View {
    let state: PlayState

    private var text: String {
        switch state {
        case .stopped: return "Stopped"
        case .playing: return "Playing"
        case .paused: return "Paused"
        }
    }

    private var color: Color {
        switch state {
        case .stopped: return .secondary
        case .playing: return .green
        case .paused: return .orange
        }
    }

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(color.opacity(0.15), in: Capsule())
    }
}

// MARK: Left panel: Project files | Scene (scenes + hierarchy)

enum SidebarMode: String, CaseIterable {
    case project = "Project"
    case scene = "Scene"
}

struct LeftPanel: View {
    @ObservedObject var model: EditorModel

    var body: some View {
        // Scene (scenes + hierarchy) above, Project (files) below; drag the divider to resize.
        VSplitView {
            VStack(spacing: 0) {
                PanelTitle(text: "Scene", icon: "square.grid.3x3")
                Divider()
                SceneListView(model: model)
            }
            .frame(minHeight: 60, idealHeight: 320)
            VStack(spacing: 0) {
                PanelTitle(text: "Project", icon: "folder")
                Divider()
                ExplorerView(model: model)
            }
            .frame(minHeight: 60, idealHeight: 320)
        }
        .panelBar()
    }
}

struct PanelTitle: View {
    let text: String
    let icon: String
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.caption).foregroundStyle(.secondary)
            Text(text.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            Spacer()
        }
        .padding(.horizontal, 10)
        .frame(height: 24)
        .background(Color(nsColor: .windowBackgroundColor).opacity(0.6))
    }
}

struct SceneListView: View {
    @ObservedObject var model: EditorModel

    var body: some View {
        List {
            Section("Scenes") {
                ForEach(model.sceneIDs, id: \.self) { id in
                    Button {
                        model.activeTab = .scene
                        Task { try? await model.loadScene(id) }
                    } label: {
                        HStack {
                            Image(systemName: "photo")
                            Text(id)
                            Spacer()
                            if model.currentScene == id && model.dirty { Circle().fill(.orange).frame(width: 7, height: 7) }
                        }
                    }
                    .buttonStyle(.plain)
                    .fontWeight(model.currentScene == id ? .semibold : .regular)
                }
            }
            Section {
                ForEach(model.hierarchyRows()) { row in
                    if let e = model.entities.first(where: { $0.key == row.key }) {
                        HierarchyRowView(model: model, entity: e, row: row)
                    }
                }
            } header: {
                HierarchyHeader(model: model)
            }
        }
        .listStyle(.sidebar)
        .dropDestination(for: String.self) { items, _ in // dropped on empty space: unparent
            guard let k = items.first else { return false }
            Task { await model.setParent(k, to: nil) }
            return true
        }
        .onDeleteCommand { model.deleteSelection() }
    }
}

// MARK: Center: tab bar + Scene / Game / file tabs + console

struct CenterPanel: View {
    @ObservedObject var model: EditorModel

    var body: some View {
        VStack(spacing: 0) {
            TabBarView(model: model)
            Divider()
            ZStack {
                // Both runtime views stay alive (just hidden): a web view that leaves the window stops animating.
                SceneTabView(model: model)
                    .opacity(model.activeTab == .scene ? 1 : 0)
                    .allowsHitTesting(model.activeTab == .scene)
                GameTabView(model: model)
                    .opacity(model.activeTab == .game ? 1 : 0)
                    .allowsHitTesting(model.activeTab == .game)
                if model.activeTab == .docs {
                    DocsView(model: model)
                        .background(Color(nsColor: .windowBackgroundColor))
                }
                if case .file(let url) = model.activeTab {
                    FileTabView(model: model, url: url)
                        .background(Color(nsColor: .textBackgroundColor))
                }
            }
            Divider()
            BottomPanel(model: model)
        }
    }
}

struct TabBarView: View {
    @ObservedObject var model: EditorModel

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                ForEach(model.tabs, id: \.self) { tab in
                    TabButton(model: model, tab: tab)
                }
            }
            .padding(.horizontal, 6)
        }
        .frame(height: 30)
        .panelBar()
    }
}

struct TabButton: View {
    @ObservedObject var model: EditorModel
    let tab: EditorTab

    private var active: Bool { model.activeTab == tab }

    private var title: String {
        switch tab {
        case .scene: return "Scene" + (model.currentScene.map { " · \($0)" } ?? "")
        case .game: return "Game"
        case .docs: return "Documentation"
        case .file(let url): return url.lastPathComponent
        }
    }

    private var icon: String {
        switch tab {
        case .scene: return "square.grid.3x3"
        case .game: return "gamecontroller"
        case .docs: return "book"
        case .file: return "doc.text"
        }
    }

    private var isDirty: Bool {
        switch tab {
        case .scene: return model.dirty
        case .game, .docs: return false
        case .file(let url): return model.textDocs[url]?.isDirty ?? false
        }
    }

    @Environment(\.openWindow) private var openWindow

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.caption)
            Text(title).font(.callout).lineLimit(1)
            if tab == .game && model.playState != .stopped {
                Circle().fill(model.playState == .playing ? Color.green : Color.orange).frame(width: 6, height: 6)
            }
            if isDirty { Circle().fill(.orange).frame(width: 7, height: 7) }
            if case .file = tab { closeButton }
            if tab == .docs { closeButton }
        }
        .padding(.horizontal, 10).padding(.vertical, 5)
        .background(active ? Color(nsColor: .selectedContentBackgroundColor).opacity(0.35) : .clear, in: RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        .onTapGesture { model.activeTab = tab }
        .contextMenu {
            if case .file(let url) = tab {
                Button("Open in New Window") { model.popOut(tab); openWindow(value: PopoutItem.file(url.path)) }
                Button("Close") { model.closeTab(tab) }
            } else if tab == .docs {
                Button("Open in New Window") { model.popOut(tab); openWindow(value: PopoutItem.docs(model.docsPage)) }
                Button("Close") { model.closeTab(tab) }
            }
        }
    }

    private var closeButton: some View {
        Button { model.closeTab(tab) } label: { Image(systemName: "xmark").font(.caption2) }
            .buttonStyle(.plain)
            .help("Close")
    }
}

// MARK: Scene tab (viewport header strip ABOVE the view, not over it)

struct SceneTabView: View {
    @ObservedObject var model: EditorModel
    @State private var dragging = false
    @State private var lastTranslation = CGSize.zero
    @State private var lastMouse = CGPoint.zero

    var body: some View {
        VStack(spacing: 0) {
            ViewportHeader(model: model)
            Divider()
            ZStack {
                WebViewRepresentable(webView: model.host.webView)
                SelectionOverlay(bounds: model.vertexEditing ? nil : model.selectionBounds)
                    .allowsHitTesting(false)
                GameFrameOverlay(model: model).allowsHitTesting(false)
                VertexOverlay(model: model).allowsHitTesting(false)
                // The editor owns pointer input; the web view only draws.
                Color.clear
                    .contentShape(Rectangle())
                    .gesture(dragGesture)
                    .onContinuousHover { if case .active(let p) = $0 { lastMouse = p } }
                    .contextMenu { createMenu }
                    .gesture(MagnifyGesture().onChanged { v in model.setZoom(model.camera.zoom * (1 + (v.magnification - 1) * 0.1)) })
            }
            .dropDestination(for: URL.self) { urls, location in
                let ids = urls.compactMap { model.prefabID(for: $0) }
                guard !ids.isEmpty else { return false }
                let at = model.worldPoint(forScreen: location)
                Task { for id in ids { await model.addPrefab(id, at: at) } }
                return true
            }
            .background(GeometryReader { g in
                Color.clear
                    .onAppear { model.viewportResized(g.size) }
                    .onChange(of: g.size) { _, size in model.viewportResized(size) }
            })
            .clipped()
        }
    }

    /// Right-click in the viewport: create things where the cursor is.
    @ViewBuilder
    private var createMenu: some View {
        let at = model.worldPoint(forScreen: lastMouse)
        Button("Create Empty") { Task { await model.addEntity(type: "Empty", at: at) } }
        Menu("Create") {
            let groups = Dictionary(grouping: model.entityTypes, by: \.group)
            ForEach(groups.keys.sorted(), id: \.self) { group in
                Section(group == "engine" ? "Engine" : group) {
                    ForEach((groups[group] ?? []).sorted { $0.name < $1.name }, id: \.self) { t in
                        Button(t.name) { Task { await model.addEntity(type: t.name, at: at) } }
                    }
                }
            }
        }
        let prefabs = model.loadPrefabList()
        if !prefabs.isEmpty {
            Menu("Prefab") { ForEach(prefabs) { p in Button(p.name) { Task { await model.addPrefab(p.id, at: at) } } } }
        }
        if !model.clipboard.isEmpty { Button("Paste") { Task { await model.pasteClipboard() } } }
        if model.selection != nil {
            Divider()
            Button("Duplicate") { Task { await model.duplicateSelection() } }
            Button("Delete", role: .destructive) { model.deleteSelection() }
        }
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { v in
                if !dragging { dragging = true; lastTranslation = .zero; model.dragBegan(at: v.startLocation) }
                let d = CGSize(width: v.translation.width - lastTranslation.width,
                               height: v.translation.height - lastTranslation.height)
                lastTranslation = v.translation
                model.dragChanged(delta: d)
            }
            .onEnded { _ in dragging = false; model.dragEnded() }
    }
}

struct ViewportHeader: View {
    @ObservedObject var model: EditorModel

    var body: some View {
        HStack(spacing: 6) {
            Button { model.setZoom(model.camera.zoom / 1.25) } label: { Image(systemName: "minus.magnifyingglass") }
                .help("Zoom out")
            Text("\(Int(model.camera.zoom * 100))%")
                .font(.caption.monospacedDigit())
                .frame(width: 46)
            Button { model.setZoom(model.camera.zoom * 1.25) } label: { Image(systemName: "plus.magnifyingglass") }
                .help("Zoom in")
            Button("Fit") { model.resetView() }.help("Fit the scene in the view")
            Button("100%") { model.setZoom(1) }.help("Actual size")
            Divider().frame(height: 16)
            Toggle(isOn: Binding(get: { model.showColliders }, set: { model.setColliders($0) })) {
                Image(systemName: "square.dashed")
            }
            .toggleStyle(.button)
            .help("Show colliders")
            Toggle(isOn: $model.vertexEditing) { Image(systemName: "point.topleft.down.curvedto.point.bottomright.up") }
                .toggleStyle(.button).help("Edit polygon vertices: drag a point, click an edge to add one, Option-click a point to remove it")
                .disabled(model.polygonOfSelection() == nil)
            Toggle(isOn: $model.showGameFrame) { Image(systemName: "rectangle.dashed") }
                .toggleStyle(.button).help("Show the game frame (what the player sees)")
            Toggle(isOn: $model.snapEnabled) { Image(systemName: "magnet") }
                .toggleStyle(.button).help("Snap to grid (hold Option to flip for one drag)")
            Picker("", selection: $model.gridSize) {
                ForEach([1.0, 5.0, 10.0, 20.0, 25.0, 50.0], id: \.self) { Text("\(Int($0)) px").tag($0) }
            }
            .labelsHidden().frame(width: 74).help("Grid size")
            Button { model.reloadRuntime() } label: { Image(systemName: "arrow.clockwise") }
                .help("Reload runtime")
            Spacer()
            if let scene = model.currentScene {
                Text(scene).font(.caption).foregroundStyle(.secondary)
                if model.dirty { Text("edited").font(.caption2).foregroundStyle(.orange) }
            }
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 10)
        .frame(height: 32)
        .panelBar()
    }
}

/// The selection gizmo is drawn by the EDITOR as a SwiftUI overlay (not inside the game canvas),
/// positioned from the bounds the runtime reports.
struct SelectionOverlay: View {
    let bounds: ScreenBounds?

    var body: some View {
        GeometryReader { _ in
            if let b = bounds {
                ZStack {
                    Rectangle().stroke(Color.accentColor, lineWidth: 1.5)
                    Path { p in p.move(to: CGPoint(x: max(b.w, 1) / 2, y: 0)); p.addLine(to: CGPoint(x: max(b.w, 1) / 2, y: -24)) }
                        .stroke(Color.accentColor, lineWidth: 1)
                    Circle().fill(.white).overlay(Circle().stroke(Color.accentColor, lineWidth: 1.5))
                        .frame(width: 10, height: 10).position(x: max(b.w, 1) / 2, y: -24)
                    ForEach(0..<4, id: \.self) { i in
                        Rectangle().fill(.white).overlay(Rectangle().stroke(Color.accentColor, lineWidth: 1))
                            .frame(width: 8, height: 8)
                            .position(x: i % 2 == 0 ? 0 : max(b.w, 1), y: i < 2 ? 0 : max(b.h, 1))
                    }
                }
                .frame(width: max(b.w, 1), height: max(b.h, 1))
                .rotationEffect(.degrees(b.rotation))
                .position(x: b.cx, y: b.cy)
            }
        }
    }
}

// MARK: Game tab (separate runtime instance)

struct GameTabView: View {
    @ObservedObject var model: EditorModel

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                PlayStateBadge(state: model.playState)
                Text(model.playState == .stopped
                     ? "Not running"
                     : "Running a snapshot of \(model.currentScene ?? "the scene"). Edits apply to the Scene view only; Stop to start fresh.")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Spacer()
                ResolutionPicker(model: model)
            }
            .padding(.horizontal, 10)
            .frame(height: 32)
            .panelBar()
            Divider()
            ZStack {
                WebViewRepresentable(webView: model.playHost.webView)
                if model.playState == .stopped {
                    VStack(spacing: 10) {
                        Image(systemName: "play.circle").font(.system(size: 44)).foregroundStyle(.secondary)
                        Text("Press Play to run the game").foregroundStyle(.secondary)
                        Button("Play") { Task { await model.play() } }
                            .buttonStyle(.borderedProminent)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(nsColor: .underPageBackgroundColor))
                }
            }
        }
    }
}

// MARK: File tabs

struct FileTabView: View {
    @ObservedObject var model: EditorModel
    let url: URL

    var body: some View {
        if let doc = model.textDocs[url] {
            if doc.isImage {
                if url.pathExtension.lowercased() == "png" {
                    SpritePainterView(model: model, url: url).id(url)
                } else if let image = NSImage(contentsOf: url) {
                    Image(nsImage: image).resizable().scaledToFit().padding(20)
                } else {
                    Text("Can't preview this image").foregroundStyle(.secondary)
                }
            } else {
                CodeEditor(text: Binding(get: { model.textDocs[url]?.text ?? "" }, set: { model.setText(url, $0) }),
                           fileExtension: url.pathExtension, onSave: { model.saveFile(url) })
                    .id(url)
            }
        } else {
            Text("File closed").foregroundStyle(.secondary)
        }
    }
}

// MARK: Console

struct BottomPanel: View {
    @ObservedObject var model: EditorModel

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $model.bottomTab) {
                ForEach(BottomTab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented).labelsHidden().controlSize(.small).fixedSize()
            .padding(.vertical, 4).frame(maxWidth: .infinity)
            Divider()
            switch model.bottomTab {
            case .console: ConsoleView(model: model)
            case .animation: AnimationPanel(model: model, anim: model.anim)
            }
        }
        .frame(height: model.bottomTab == .animation ? 270 : 150)
    }
}

struct ConsoleView: View {
    @ObservedObject var model: EditorModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Console").font(.caption.weight(.semibold))
                Spacer()
                Text("\(model.logs.count)").font(.caption).foregroundStyle(.secondary)
                Button("Clear") { model.logs.removeAll() }.controlSize(.small)
            }
            .padding(6)
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(model.logs) { line in
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text(line.source)
                                    .font(.system(size: 9, weight: .semibold, design: .monospaced))
                                    .foregroundStyle(line.source == "game" ? Color.green : Color.blue)
                                    .frame(width: 34, alignment: .leading)
                                Text(line.text)
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundStyle(color(line.level))
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .id(line.id)
                        }
                    }
                    .padding(6)
                }
                .onChange(of: model.logs.count) { _, _ in
                    if let last = model.logs.last { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
        .background(Color(nsColor: .textBackgroundColor))
    }

    private func color(_ level: String) -> Color {
        switch level {
        case "error": return .red
        case "warn": return .orange
        default: return .primary
        }
    }
}


/// The window's root: the Hub when no project is open, otherwise the editor.
struct RootView: View {
    @ObservedObject var model: EditorModel

    var body: some View {
        Group {
            if model.projectURL == nil {
                HubView(model: model)
            } else {
                ProjectView(model: model)
            }
        }
        .navigationTitle(model.projectURL == nil ? "Piston" : model.projectName)
        .navigationSubtitle(model.projectURL == nil ? "" : (model.currentScene ?? ""))
        .sheet(isPresented: $model.showNewProject) { NewProjectSheet(model: model) }
    }
}

extension View {
    /// Toolbar-style strips: Liquid Glass on macOS 26+, the classic control background before that.
    @ViewBuilder
    func panelBar() -> some View {
        if #available(macOS 26.0, *) {
            self.glassEffect(.regular, in: Rectangle())
        } else {
            self.background(Color(nsColor: .controlBackgroundColor))
        }
    }

    /// Rounded cards (Hub): glass on macOS 26+.
    @ViewBuilder
    func glassCard(cornerRadius: CGFloat = 8, tint: Color? = nil) -> some View {
        if #available(macOS 26.0, *) {
            self.glassEffect(tint.map { Glass.regular.tint($0) } ?? .regular, in: RoundedRectangle(cornerRadius: cornerRadius))
        } else {
            self.background(tint ?? Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: cornerRadius))
        }
    }
}

/// Game aspect ratio / design resolution. The Game view scales this to fit any window size, keeping the ratio.
struct ResolutionPicker: View {
    @ObservedObject var model: EditorModel
    @State private var w = ""
    @State private var h = ""

    private static let presets: [(String, Double, Double)] = [
        ("800 × 600  (4:3)", 800, 600), ("1024 × 768  (4:3)", 1024, 768), ("1280 × 720  (16:9)", 1280, 720),
        ("1920 × 1080  (16:9)", 1920, 1080), ("720 × 1280  (9:16 portrait)", 720, 1280), ("600 × 600  (1:1)", 600, 600),
    ]

    var body: some View {
        HStack(spacing: 4) {
            Menu {
                ForEach(Self.presets, id: \.0) { p in Button(p.0) { model.setResolution(width: p.1, height: p.2) } }
            } label: { Image(systemName: "aspectratio") }
                .menuStyle(.borderlessButton).fixedSize().help("Aspect ratio presets")
            TextField("W", text: $w).frame(width: 52).textFieldStyle(.roundedBorder).onSubmit(apply)
            Text("×").foregroundStyle(.secondary)
            TextField("H", text: $h).frame(width: 52).textFieldStyle(.roundedBorder).onSubmit(apply)
        }
        .font(.caption)
        .onAppear(perform: sync)
        .onChange(of: model.gameResolution) { _, _ in sync() }
    }

    private func sync() { w = String(Int(model.gameResolution.width)); h = String(Int(model.gameResolution.height)) }
    private func apply() {
        guard let ww = Double(w), let hh = Double(h) else { sync(); return }
        model.setResolution(width: ww, height: hh)
    }
}

struct HierarchyRowView: View {
    @ObservedObject var model: EditorModel
    let entity: EntitySummary
    let row: HierarchyRow
    @State private var targeted = false

    var body: some View {
        let e = entity
        Button { model.activeTab = .scene; if NSEvent.modifierFlags.contains(.shift) { model.toggleSelect(e.key) } else { model.select(e.key) } } label: {
            HStack(spacing: 4) {
                if row.hasChildren {
                    Image(systemName: model.collapsed.contains(e.key) ? "chevron.right" : "chevron.down")
                        .font(.caption2.weight(.bold)).foregroundStyle(.secondary).frame(width: 12)
                        .contentShape(Rectangle())
                        .onTapGesture { if model.collapsed.contains(e.key) { model.collapsed.remove(e.key) } else { model.collapsed.insert(e.key) } }
                } else { Color.clear.frame(width: 12, height: 1) }
                Image(systemName: row.hasChildren ? "square.stack.3d.up" : "cube")
                Text(e.name.isEmpty ? e.tag : e.name)
                Spacer()
                Text(e.type ?? e.tag).font(.caption2).foregroundStyle(.secondary)
            }
            .padding(.vertical, 6)
            .padding(.leading, 8 + CGFloat(row.depth) * 14)
            .padding(.trailing, 8)
            .frame(maxWidth: .infinity, minHeight: 30, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 6)
                .fill(targeted ? Color.accentColor.opacity(0.45) : (model.selectedKeys.contains(e.key) ? Color.accentColor.opacity(0.28) : .clear)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowInsets(EdgeInsets(top: 1, leading: 4, bottom: 1, trailing: 4))
        .draggable(e.key)
        .dropDestination(for: String.self, action: { items, _ in
            guard let k = items.first, model.canParent(k, under: e.key) else { return false }
            Task { await model.setParent(k, to: e.key) }
            return true
        }, isTargeted: { targeted = $0 })
        .contextMenu {
            Button("Duplicate") { Task { await model.duplicateEntity(e.key) } }
            if model.entityDoc(e.key)?["parentKey"] as? String != nil {
                Button("Unparent") { Task { await model.setParent(e.key, to: nil) } }
            }
            Button("Delete", role: .destructive) { model.deleteEntity(e.key) }
        }
    }
}
