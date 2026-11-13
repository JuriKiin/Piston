import SwiftUI
import AppKit

/// Native port of the web editor's sprite sheet grid painter, plus animation clips.
/// Edits a working copy; Apply writes the grid to the entity's SpriteRenderer and the clips to its SpriteAnimator.
struct SpriteSheetEditor: View {
    @ObservedObject var model: EditorModel
    let key: String
    @Environment(\.dismiss) private var dismiss

    struct Clip: Identifiable, Equatable {
        var id = UUID()
        var name: String
        var from: Int
        var to: Int
        var fps: Double
        var loop: Bool
    }

    enum Tool: String, CaseIterable { case cell = "Set cell size", frames = "Pick frames" }

    @State private var image: NSImage?
    @State private var imageSize = CGSize.zero
    @State private var cellW = 0
    @State private var cellH = 0
    @State private var columns = 1
    @State private var frameCount = 1
    @State private var clips: [Clip] = []
    @State private var selectedClip: UUID?
    @State private var tool: Tool = .cell
    @State private var loaded = false

    private let canvasW: CGFloat = 520
    private let canvasH: CGFloat = 380

    private var rendererIndex: Int? { model.components(key).firstIndex { ($0["type"] as? String) == "SpriteRenderer" } }
    private var animatorIndex: Int? { model.components(key).firstIndex { ($0["type"] as? String) == "SpriteAnimator" } }

    private var scale: CGFloat {
        guard imageSize.width > 0, imageSize.height > 0 else { return 1 }
        return min(canvasW / imageSize.width, canvasH / imageSize.height, 8)
    }
    private var displaySize: CGSize { CGSize(width: imageSize.width * scale, height: imageSize.height * scale) }
    private var gridReady: Bool { cellW > 0 && cellH > 0 }
    private var maxFrames: Int { gridReady ? max(1, columns * max(1, Int(imageSize.height) / cellH)) : 1 }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Sprite Sheet").font(.headline)
            if rendererIndex == nil {
                Text("This entity has no SpriteRenderer.").foregroundStyle(.secondary)
                Button("Add SpriteRenderer") { Task { await model.addComponent(key, type: "SpriteRenderer"); load() } }
            } else if image == nil {
                Text("Set the SpriteRenderer's Image Path (relative to the project, e.g. ./assets/hero.png) first.")
                    .foregroundStyle(.secondary)
            } else {
                HStack(alignment: .top, spacing: 16) {
                    VStack(alignment: .leading, spacing: 8) {
                        Picker("", selection: $tool) { ForEach(Tool.allCases, id: \.self) { Text($0.rawValue).tag($0) } }
                            .pickerStyle(.segmented).labelsHidden()
                        sheetCanvas
                        Text(tool == .cell ? "Click the bottom-right corner of the first frame." : "Drag across frames to set the selected clip's range.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    controls
                }
            }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Apply") { Task { await apply() } }
                    .keyboardShortcut(.defaultAction).disabled(rendererIndex == nil || image == nil)
            }
        }
        .padding(16)
        .frame(minWidth: 820)
        .onAppear { if !loaded { load() } }
    }

    // MARK: Canvas

    private var sheetCanvas: some View {
        Canvas { ctx, _ in
            guard let image else { return }
            let rect = CGRect(origin: .zero, size: displaySize)
            ctx.draw(Image(nsImage: image).interpolation(.none), in: rect)
            guard gridReady else { return }
            let cw = CGFloat(cellW) * scale, ch = CGFloat(cellH) * scale
            let grid = Color(red: 0.3, green: 0.65, blue: 1).opacity(0.9)
            var path = Path()
            var x: CGFloat = 0
            while x <= rect.width + 0.5 { path.move(to: CGPoint(x: x, y: 0)); path.addLine(to: CGPoint(x: x, y: rect.height)); x += cw }
            var y: CGFloat = 0
            while y <= rect.height + 0.5 { path.move(to: CGPoint(x: 0, y: y)); path.addLine(to: CGPoint(x: rect.width, y: y)); y += ch }
            ctx.stroke(path, with: .color(grid), lineWidth: 1)
            if let clip = clips.first(where: { $0.id == selectedClip }) {
                for f in max(0, clip.from)...max(clip.from, clip.to) where f < frameCount {
                    let r = CGRect(x: CGFloat(f % columns) * cw, y: CGFloat(f / columns) * ch, width: cw, height: ch)
                    ctx.fill(Path(r), with: .color(.orange.opacity(0.28)))
                    ctx.stroke(Path(r), with: .color(.orange), lineWidth: 1.5)
                }
            }
        }
        .frame(width: displaySize.width, height: displaySize.height)
        .background(Color.checker)
        .border(Color.secondary.opacity(0.4))
        .gesture(DragGesture(minimumDistance: 0).onChanged { g in
            if tool == .frames { pickFrames(from: g.startLocation, to: g.location) }
        }.onEnded { g in
            if tool == .cell { setCellFromCorner(g.location) } else { pickFrames(from: g.startLocation, to: g.location) }
        })
        .frame(width: canvasW, height: min(canvasH, displaySize.height), alignment: .topLeading)
    }

    private func setCellFromCorner(_ p: CGPoint) {
        cellW = max(1, Int((p.x / scale).rounded()))
        cellH = max(1, Int((p.y / scale).rounded()))
        cellW = min(cellW, Int(imageSize.width)); cellH = min(cellH, Int(imageSize.height))
        guessCounts()
    }

    private func guessCounts() {
        guard gridReady else { return }
        columns = max(1, Int(imageSize.width) / cellW)
        frameCount = max(1, columns * max(1, Int(imageSize.height) / cellH))
    }

    private func frameIndex(_ p: CGPoint) -> Int {
        guard gridReady else { return 0 }
        let col = min(columns - 1, max(0, Int(p.x / scale) / cellW))
        let row = max(0, Int(p.y / scale) / cellH)
        return min(frameCount - 1, row * columns + col)
    }

    private func pickFrames(from a: CGPoint, to b: CGPoint) {
        guard gridReady else { return }
        if selectedClip == nil { addClip() }
        guard let i = clips.firstIndex(where: { $0.id == selectedClip }) else { return }
        let fa = frameIndex(a), fb = frameIndex(b)
        clips[i].from = min(fa, fb)
        clips[i].to = max(fa, fb)
    }

    // MARK: Controls

    private var controls: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Grid").font(.subheadline.weight(.semibold))
            intRow("Cell Width", $cellW) { guessCounts() }
            intRow("Cell Height", $cellH) { guessCounts() }
            intRow("Columns", $columns) {}
            intRow("Frame Count", $frameCount) {}
            HStack {
                Button("Auto-detect") { autoDetect() }.controlSize(.small)
                Text("\(Int(imageSize.width))×\(Int(imageSize.height)) px").font(.caption).foregroundStyle(.secondary)
            }
            Divider()
            HStack {
                Text("Animations").font(.subheadline.weight(.semibold))
                Spacer()
                Button { addClip() } label: { Image(systemName: "plus") }.buttonStyle(.borderless).disabled(!gridReady)
            }
            if clips.isEmpty {
                Text("No clips yet. Add one, then drag across frames to set its range.").font(.caption).foregroundStyle(.secondary)
            }
            ScrollView {
                VStack(spacing: 6) {
                    ForEach($clips) { $clip in clipRow($clip) }
                }
            }
            .frame(minHeight: 90, maxHeight: 170)
            Divider()
            Text("Preview").font(.subheadline.weight(.semibold))
            preview
        }
        .frame(width: 250)
    }

    private func clipRow(_ clip: Binding<Clip>) -> some View {
        let isSel = selectedClip == clip.wrappedValue.id
        return VStack(alignment: .leading, spacing: 4) {
            HStack {
                TextField("name", text: clip.name).textFieldStyle(.roundedBorder)
                Button { clips.removeAll { $0.id == clip.wrappedValue.id }; if isSel { selectedClip = clips.first?.id } }
                    label: { Image(systemName: "trash") }.buttonStyle(.borderless)
            }
            HStack(spacing: 6) {
                Text("frames").font(.caption2)
                clipInt(clip.from); Text("–").font(.caption2); clipInt(clip.to)
                Text("fps").font(.caption2)
                TextField("", value: clip.fps, format: .number).textFieldStyle(.roundedBorder).frame(width: 44)
                Toggle("loop", isOn: clip.loop).toggleStyle(.checkbox).font(.caption2)
            }
        }
        .padding(6)
        .background(RoundedRectangle(cornerRadius: 6).fill(isSel ? Color.accentColor.opacity(0.18) : Color.secondary.opacity(0.08)))
        .contentShape(Rectangle())
        .onTapGesture { selectedClip = clip.wrappedValue.id }
    }

    private func clipInt(_ b: Binding<Int>) -> some View {
        TextField("", value: b, format: .number).textFieldStyle(.roundedBorder).frame(width: 40)
    }

    private func intRow(_ label: String, _ value: Binding<Int>, _ changed: @escaping () -> Void) -> some View {
        HStack {
            Text(label).font(.caption).frame(width: 82, alignment: .leading)
            TextField("", value: value, format: .number).textFieldStyle(.roundedBorder)
                .onChange(of: value.wrappedValue) { _, _ in changed() }
        }
    }

    // MARK: Preview

    private var preview: some View {
        let clip = clips.first(where: { $0.id == selectedClip })
        return TimelineView(.animation) { timeline in
            Canvas { ctx, size in
                guard let image, gridReady else { return }
                let from = clip?.from ?? 0
                let to = min(clip?.to ?? (frameCount - 1), frameCount - 1)
                let count = max(1, to - from + 1)
                let fps = clip?.fps ?? 8
                let t = timeline.date.timeIntervalSinceReferenceDate
                var i = Int(t * max(1, fps))
                i = (clip?.loop ?? true) ? i % count : min(i, count - 1)
                let f = from + i
                let s = min(size.width / CGFloat(cellW), size.height / CGFloat(cellH))
                let dw = CGFloat(cellW) * s, dh = CGFloat(cellH) * s
                let dest = CGRect(x: (size.width - dw) / 2, y: (size.height - dh) / 2, width: dw, height: dh)
                ctx.clip(to: Path(dest))
                let full = CGRect(x: dest.minX - CGFloat((f % columns) * cellW) * s,
                                  y: dest.minY - CGFloat((f / columns) * cellH) * s,
                                  width: imageSize.width * s, height: imageSize.height * s)
                ctx.draw(Image(nsImage: image).interpolation(.none), in: full)
            }
        }
        .frame(width: 120, height: 120)
        .background(Color.checker)
        .border(Color.secondary.opacity(0.4))
    }

    // MARK: Load / apply

    private func addClip() {
        let c = Clip(name: clips.isEmpty ? "idle" : "clip\(clips.count + 1)", from: 0, to: max(0, frameCount - 1), fps: 12, loop: true)
        clips.append(c)
        selectedClip = c.id
    }

    private func autoDetect() {
        // Pixel-art strips are usually one row of square frames; otherwise assume the whole image is one frame.
        let w = Int(imageSize.width), h = Int(imageSize.height)
        if w > h, h > 0, w % h == 0 { cellW = h; cellH = h } else { cellW = w; cellH = h }
        guessCounts()
    }

    private func imageURL(_ path: String) -> URL? {
        guard let root = model.projectURL, !path.isEmpty else { return nil }
        var p = path
        if p.hasPrefix("./") { p.removeFirst(2) } else if p.hasPrefix("/") { p.removeFirst() }
        return root.appendingPathComponent(p)
    }

    private func load() {
        loaded = true
        if let r = rendererIndex {
            let path = (model.componentField(key, r, "imagePath") as? String) ?? ""
            if let url = imageURL(path), let img = NSImage(contentsOf: url) {
                image = img
                if let rep = img.representations.first, rep.pixelsWide > 0 {
                    imageSize = CGSize(width: rep.pixelsWide, height: rep.pixelsHigh)
                } else { imageSize = img.size }
            }
            func int(_ f: String) -> Int { (model.componentField(key, r, f) as? NSNumber)?.intValue ?? 0 }
            cellW = int("frameWidth"); cellH = int("frameHeight")
            columns = max(1, int("columns")); frameCount = max(1, int("frameCount"))
            if !gridReady, image != nil { autoDetect() }
        }
        if let a = animatorIndex, let raw = model.componentField(key, a, "clips") as? [[String: Any]] {
            clips = raw.map {
                Clip(name: $0["name"] as? String ?? "clip", from: ($0["from"] as? NSNumber)?.intValue ?? 0,
                     to: ($0["to"] as? NSNumber)?.intValue ?? 0, fps: ($0["fps"] as? NSNumber)?.doubleValue ?? 12,
                     loop: ($0["loop"] as? Bool) ?? true)
            }
            selectedClip = clips.first?.id
        }
    }

    private func apply() async {
        guard let r = rendererIndex else { return }
        model.setComponentField(key, r, "frameWidth", cellW)
        model.setComponentField(key, r, "frameHeight", cellH)
        model.setComponentField(key, r, "columns", columns)
        model.setComponentField(key, r, "frameCount", frameCount)
        let payload: [[String: Any]] = clips.map { ["name": $0.name, "from": $0.from, "to": min($0.to, max(0, frameCount - 1)), "fps": $0.fps, "loop": $0.loop] }
        if animatorIndex == nil, !payload.isEmpty { await model.addComponent(key, type: "SpriteAnimator") }
        if let a = animatorIndex {
            model.setComponentField(key, a, "clips", payload)
            if (model.componentField(key, a, "defaultClip") as? String ?? "").isEmpty, let first = clips.first {
                model.setComponentField(key, a, "defaultClip", first.name)
            }
        }
        dismiss()
    }
}

extension Color {
    /// A neutral backdrop so transparent sprite pixels are visible.
    static var checker: Color { Color(nsColor: .underPageBackgroundColor) }
}
