import SwiftUI

// MARK: Inspector (generated from the schemas the runtime reports)

struct SpriteEditorRequest: Identifiable { let key: String; var id: String { key } }

struct InspectorView: View {
    @ObservedObject var model: EditorModel
    @ObservedObject var anim: AnimationEditorState   // so animated values refresh while the playhead moves
    @State private var spriteEditor: SpriteEditorRequest?
    @State private var showSavePrefab = false
    @State private var savePrefabName = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let key = model.selection, let e = model.entityDoc(key) {
                    selected(key, e)
                } else {
                    Text("Nothing selected").foregroundStyle(.secondary)
                    Text("Click an entity in the viewport or the Scene list. Drag it to move. Drag empty space to pan.")
                        .font(.caption).foregroundStyle(.secondary)
                    Divider()
                    diagnostics
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .alert("Save as Prefab", isPresented: $showSavePrefab) {
            TextField("Name", text: $savePrefabName)
            Button("Save") { model.saveSelectionAsPrefab(named: savePrefabName) }
            Button("Cancel", role: .cancel) {}
        }
        .sheet(item: $spriteEditor) { req in SpriteSheetEditor(model: model, key: req.key) }
    }

    @ViewBuilder
    private func selected(_ key: String, _ e: [String: Any]) -> some View {
        let type = e["type"] as? String
        Text(((e["name"] as? String) ?? (e["tag"] as? String) ?? key)).font(.headline)
        Text(type ?? "untyped entity").font(.caption).foregroundStyle(.secondary)
        HStack {
            Button { Task { await model.duplicateEntity(key) } } label: { Label("Duplicate", systemImage: "plus.square.on.square") }
            Button(role: .destructive) { model.deleteEntity(key) } label: { Label("Delete", systemImage: "trash") }
        }
        .controlSize(.small)
        Button { savePrefabName = (e["name"] as? String) ?? (e["tag"] as? String) ?? "Prefab"; showSavePrefab = true } label: {
            Label("Save as Prefab…", systemImage: "square.stack.3d.up")
        }.controlSize(.small)
        HStack {
            Text("Name").font(.caption).frame(width: 64, alignment: .leading)
            TextField("", text: Binding(get: { (e["name"] as? String) ?? "" }, set: { model.renameEntity(key, to: $0) }),
                      prompt: Text((e["tag"] as? String) ?? "")).textFieldStyle(.roundedBorder)
        }.id("\(key)/name")
        Divider()
        Text("Transform").font(.subheadline.weight(.semibold))
        let animated = anim.animatedPaths(for: key)
        let shown = anim.displayTransform(key)
        NumberRow(label: "X", value: shown.x, animated: animated.contains("transform.position.x"), recording: anim.recordingActive(for: key)) { model.setTransform(key, x: $0) }.id("\(key)/x")
        NumberRow(label: "Y", value: shown.y, animated: animated.contains("transform.position.y"), recording: anim.recordingActive(for: key)) { model.setTransform(key, y: $0) }.id("\(key)/y")
        NumberRow(label: "Rotation", value: shown.rotation, animated: animated.contains("transform.rotation"), recording: anim.recordingActive(for: key)) { model.setTransform(key, rotation: $0) }.id("\(key)/r")
        NumberRow(label: "Width", value: shown.w, animated: animated.contains("transform.size.x"), recording: anim.recordingActive(for: key)) { model.setTransform(key, w: $0) }.id("\(key)/w")
        NumberRow(label: "Height", value: shown.h, animated: animated.contains("transform.size.y"), recording: anim.recordingActive(for: key)) { model.setTransform(key, h: $0) }.id("\(key)/h")
        if let type, let fields = model.entitySchemas[type], !fields.isEmpty {
            Divider()
            Text(type).font(.subheadline.weight(.semibold))
            ForEach(fields, id: \.self) { f in
                FieldRow(model: model, key: key, field: f).id("\(key)/\(f.key)")
            }
        }
        componentSections(key)
    }

    @ViewBuilder
    private func componentSections(_ key: String) -> some View {
        let comps = model.components(key)
        ForEach(Array(comps.enumerated()), id: \.offset) { i, c in
            let type = (c["type"] as? String) ?? "?"
            Divider()
            HStack {
                Text(type).font(.subheadline.weight(.semibold))
                Spacer()
                if type == "SpriteRenderer" || type == "SpriteAnimator" {
                    Button("Sprite Sheet…") { spriteEditor = SpriteEditorRequest(key: key) }.controlSize(.small)
                }
                Button { model.removeComponent(key, index: i) } label: { Image(systemName: "minus.circle") }
                    .buttonStyle(.borderless).help("Remove component")
            }
            ForEach(model.componentSchemas[type] ?? [], id: \.self) { f in
                ComponentFieldRow(model: model, anim: anim, key: key, index: i, field: f).id("\(key)/c\(i)/\(f.key)")
            }
        }
        Divider()
        Menu {
            ForEach(model.componentSchemas.keys.sorted(), id: \.self) { name in
                Button(name) { Task { await model.addComponent(key, type: name) } }
            }
        } label: { Label("Add Component", systemImage: "plus.circle") }
            .controlSize(.small)
    }

    private var diagnostics: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("Bridge").font(.subheadline.weight(.semibold))
            Group {
                Text("runtime ready: \(model.runtimeReady ? "yes" : "no")")
                Text("ready events: \(model.readyCount)")
                Text("round trips: \(model.roundTrips)")
                Text("hot reloads: \(model.reloadCount)")
                Text("server port: \(model.server.map { String($0.port) } ?? "-")")
            }
            .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        }
    }
}

/// A number box that applies every valid keystroke immediately (so the scene updates and Save enables as
/// you type) instead of waiting for Return or focus loss.
struct LiveNumberField: View {
    let value: Double
    let commit: (Double) -> Void
    @State private var text = ""
    @FocusState private var focused: Bool

    private func format(_ v: Double) -> String {
        if v == v.rounded() { return String(Int(v)) }
        var s = String(format: "%.4f", v)
        while s.hasSuffix("0") { s.removeLast() }
        return s
    }

    var body: some View {
        TextField("", text: $text)
            .textFieldStyle(.roundedBorder)
            .focused($focused)
            .onAppear { text = format(value) }
            .onChange(of: value) { _, v in if !focused { text = format(v) } }
            .onChange(of: text) { _, t in
                guard focused, let d = Double(t.trimmingCharacters(in: .whitespaces)), d != value else { return }
                commit(d)
            }
            .onChange(of: focused) { _, isFocused in if !isFocused { text = format(value) } }
    }
}

struct NumberRow: View {
    let label: String
    let value: Double
    var animated = false      // a track in the current animation drives this property
    var recording = false     // ...and the Animation tab is recording on it
    let commit: (Double) -> Void

    var body: some View {
        HStack {
            AnimatedLabel(text: label, width: 64, animated: animated)
            LiveNumberField(value: value, commit: commit)
        }
        .background(animated && recording ? Color.red.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 4))
    }
}

/// A field label that turns red with a dot when an animation track drives that property.
struct AnimatedLabel: View {
    let text: String
    let width: CGFloat
    let animated: Bool
    var body: some View {
        HStack(spacing: 3) {
            if animated { Circle().fill(Color.red).frame(width: 6, height: 6) }
            Text(text).font(.caption).foregroundStyle(animated ? Color.red : .primary).lineLimit(2)
        }
        .frame(width: width, alignment: .leading)
        .help(animated ? "Animated: a keyframe track changes this property" : "")
    }
}

struct FieldRow: View {
    @ObservedObject var model: EditorModel
    let key: String
    let field: SchemaField

    var body: some View {
        let raw = model.fieldValue(key, field.key)
        HStack {
            Text(field.label).font(.caption).frame(width: 110, alignment: .leading).lineLimit(2)
            switch field.type {
            case "checkbox":
                Toggle("", isOn: Binding(get: { (raw as? Bool) ?? ((raw as? NSNumber)?.boolValue ?? false) },
                                         set: { model.setField(key, field.key, $0) })).labelsHidden()
                Spacer()
            case "color", "text":
                if field.isPath {
                    PathField(model: model, field: field, path: Binding(get: { (raw as? String) ?? "" }, set: { model.setField(key, field.key, $0) }))
                } else if field.isColor {
                    ColorField(hex: Binding(get: { (raw as? String) ?? "" }, set: { model.setField(key, field.key, $0) }))
                } else {
                    TextField("", text: Binding(get: { (raw as? String) ?? "" }, set: { model.setField(key, field.key, $0) }))
                        .textFieldStyle(.roundedBorder)
                }
            case "select":
                Picker("", selection: Binding(get: { (raw as? String) ?? field.options.first ?? "" },
                                              set: { model.setField(key, field.key, $0) })) {
                    ForEach(field.options, id: \.self) { Text($0).tag($0) }
                }.labelsHidden()
            default:
                LiveNumberField(value: (raw as? NSNumber)?.doubleValue ?? 0) { model.setField(key, field.key, $0) }
            }
        }
    }
}

struct ComponentFieldRow: View {
    @ObservedObject var model: EditorModel
    @ObservedObject var anim: AnimationEditorState
    let key: String
    let index: Int
    let field: SchemaField

    var body: some View {
        let comps = model.components(key)
        let type = index < comps.count ? (comps[index]["type"] as? String ?? "") : ""
        let path = "\(type).\(field.key)"
        let animated = anim.animatedPaths(for: key).contains(path)
        // While recording, show what the animation does at the playhead instead of the stored value.
        let raw: Any? = animated ? (anim.displayValue(for: key, path: path)?.json ?? model.componentField(key, index, field.key)) : model.componentField(key, index, field.key)
        let set: (Any) -> Void = { model.setComponentField(key, index, field.key, $0) }
        HStack {
            AnimatedLabel(text: field.label, width: 110, animated: animated)
            switch field.type {
            case "checkbox":
                Toggle("", isOn: Binding(get: { (raw as? Bool) ?? ((raw as? NSNumber)?.boolValue ?? false) }, set: { set($0) })).labelsHidden()
                Spacer()
            case "color", "text":
                if field.isPath {
                    PathField(model: model, field: field, path: Binding(get: { (raw as? String) ?? "" }, set: { set($0) }))
                } else if field.isColor {
                    ColorField(hex: Binding(get: { (raw as? String) ?? "" }, set: { set($0) }))
                } else {
                    TextField("", text: Binding(get: { (raw as? String) ?? "" }, set: { set($0) })).textFieldStyle(.roundedBorder)
                }
            case "select":
                Picker("", selection: Binding(get: { (raw as? String) ?? field.options.first ?? "" }, set: { set($0) })) {
                    ForEach(field.options, id: \.self) { Text($0).tag($0) }
                }.labelsHidden()
            case "number":
                LiveNumberField(value: (raw as? NSNumber)?.doubleValue ?? 0) { set($0) }
            case "animation":
                Text("\((raw as? [Any])?.count ?? 0) animations").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Open Animation Panel") { model.bottomTab = .animation }.controlSize(.small)
            case "clips":
                Text("\((raw as? [Any])?.count ?? 0) clips").font(.caption).foregroundStyle(.secondary)
                Spacer()
            default:
                Text("edited in code / scene file").font(.caption).foregroundStyle(.secondary)
                Spacer()
            }
        }
        .background(animated && anim.recordingActive(for: key) ? Color.red.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 4))
    }
}

extension SchemaField {
    /// Only fields declared `type: 'color'` get the picker (no guessing from the field name).
    var isColor: Bool { type == "color" }
}

/// A color well plus the hex text, kept in sync. Stores "#rrggbb" (or "#rrggbbaa" when translucent).
struct ColorField: View {
    @Binding var hex: String

    private var color: Binding<Color> {
        Binding(get: { Self.parse(hex) ?? .clear },
                set: { hex = Self.format($0) })
    }

    var body: some View {
        HStack(spacing: 6) {
            ColorPicker("", selection: color, supportsOpacity: true).labelsHidden()
            TextField("#rrggbb", text: $hex).textFieldStyle(.roundedBorder).font(.system(.caption, design: .monospaced))
        }
    }

    static func parse(_ s: String) -> Color? {
        var t = s.trimmingCharacters(in: .whitespaces)
        if t.hasPrefix("#") { t.removeFirst() }
        if t.count == 3 { t = t.map { "\($0)\($0)" }.joined() }
        guard t.count == 6 || t.count == 8, let v = UInt64(t, radix: 16) else {
            // rgb()/rgba(): what an animated translucent color comes back as
            if let m = s.range(of: #"^\s*rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)\s*$"#, options: [.regularExpression, .caseInsensitive]) {
                let nums = s[m].components(separatedBy: CharacterSet(charactersIn: "0123456789.").inverted).filter { !$0.isEmpty }.compactMap(Double.init)
                if nums.count >= 3 { return Color(.sRGB, red: nums[0] / 255, green: nums[1] / 255, blue: nums[2] / 255, opacity: nums.count > 3 ? nums[3] : 1) }
            }
            return NSColor(named: NSColor.Name(s)).map(Color.init(nsColor:)) ?? Self.named[s.lowercased()]
        }
        let hasAlpha = t.count == 8
        let r = Double((v >> (hasAlpha ? 24 : 16)) & 0xFF) / 255, g = Double((v >> (hasAlpha ? 16 : 8)) & 0xFF) / 255
        let b = Double((v >> (hasAlpha ? 8 : 0)) & 0xFF) / 255, a = hasAlpha ? Double(v & 0xFF) / 255 : 1
        return Color(.sRGB, red: r, green: g, blue: b, opacity: a)
    }

    static func format(_ c: Color) -> String {
        let n = NSColor(c).usingColorSpace(.sRGB) ?? .black
        let r = Int((n.redComponent * 255).rounded()), g = Int((n.greenComponent * 255).rounded()), b = Int((n.blueComponent * 255).rounded())
        let a = Int((n.alphaComponent * 255).rounded())
        return a == 255 ? String(format: "#%02x%02x%02x", r, g, b) : String(format: "#%02x%02x%02x%02x", r, g, b, a)
    }

    private static let named: [String: Color] = ["white": .white, "black": .black, "red": .red, "green": .green, "blue": .blue,
                                                 "yellow": .yellow, "orange": .orange, "purple": .purple, "gray": .gray, "grey": .gray]
}

extension SchemaField {
    /// Only fields declared with `accept: 'image' | 'audio' | 'any'` get the file chooser (no guessing from the field name).
    var isPath: Bool { accept != nil }
}

/// A project file path with Choose… and drag-and-drop from the Project panel. Stored as "./folder/file.ext".
struct PathField: View {
    @ObservedObject var model: EditorModel
    let field: SchemaField
    @Binding var path: String
    @State private var targeted = false

    private static let imageTypes: Set<String> = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]
    private static let audioTypes: Set<String> = ["mp3", "wav", "ogg", "m4a", "aac"]

    var body: some View {
        HStack(spacing: 4) {
            TextField(placeholder, text: $path).textFieldStyle(.roundedBorder)
                .overlay(RoundedRectangle(cornerRadius: 5).stroke(Color.accentColor, lineWidth: targeted ? 2 : 0))
            Button { choose() } label: { Image(systemName: "folder") }
                .buttonStyle(.borderless).help("Choose a file…")
        }
        .dropDestination(for: URL.self, action: { urls, _ in
            guard let u = urls.first, let rel = relative(u) else { return false }
            path = rel
            return true
        }, isTargeted: { targeted = $0 })
    }

    private var placeholder: String { field.accept == "image" ? "./assets/image.png" : field.accept == "audio" ? "./assets/sound.mp3" : "./path" }

    private func relative(_ url: URL) -> String? {
        guard let root = model.projectURL?.resolvingSymlinksInPath().path else { return nil }
        let p = url.resolvingSymlinksInPath().path
        guard p.hasPrefix(root + "/"), !url.hasDirectoryPath else { return nil }
        let ext = url.pathExtension.lowercased()
        if field.accept == "image", !Self.imageTypes.contains(ext) { return nil }
        if field.accept == "audio", !Self.audioTypes.contains(ext) { return nil }
        return "./" + p.dropFirst(root.count + 1)
    }

    private func choose() {
        guard let root = model.projectURL else { return }
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.directoryURL = root.appendingPathComponent("assets", isDirectory: true)
        if !FileManager.default.fileExists(atPath: panel.directoryURL!.path) { panel.directoryURL = root }
        panel.message = "Choose a file from the project (files from elsewhere are copied into assets/)"
        guard panel.runModal() == .OK, var url = panel.url else { return }
        if relative(url) == nil, FileManager.default.fileExists(atPath: url.path) {
            // Outside the project: copy it into assets/ so the game (and builds) can find it.
            let assets = root.appendingPathComponent("assets", isDirectory: true)
            try? FileManager.default.createDirectory(at: assets, withIntermediateDirectories: true)
            var dest = assets.appendingPathComponent(url.lastPathComponent)
            var n = 2
            while FileManager.default.fileExists(atPath: dest.path) {
                dest = assets.appendingPathComponent("\(url.deletingPathExtension().lastPathComponent) \(n).\(url.pathExtension)"); n += 1
            }
            if (try? FileManager.default.copyItem(at: url, to: dest)) != nil { url = dest; model.refreshFileTree() }
        }
        if let rel = relative(url) { path = rel } else { model.status = "Choose a file inside the project, or one that can be copied into it" }
    }
}
