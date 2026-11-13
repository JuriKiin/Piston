import SwiftUI
import AppKit

struct PixelLayer: Equatable {
    var name: String
    var visible = true
    var px: [UInt8]
}

struct PixelBuffer {
    let width: Int
    let height: Int
    let px: [UInt8]
}

struct PixelRect: Equatable {
    var x0: Int, y0: Int, x1: Int, y1: Int   // inclusive, normalised
    var w: Int { x1 - x0 + 1 }
    var h: Int { y1 - y0 + 1 }
    func contains(_ x: Int, _ y: Int) -> Bool { x >= x0 && x <= x1 && y >= y0 && y <= y1 }
}

/// A pixel-art document: layers of RGBA (not premultiplied) bytes with undo/redo, loaded from and saved to a PNG.
/// The PNG always holds the flattened image (so the game and every other tool see one picture); when there is more than
/// one layer a sidecar `<name>.png.layers.json` keeps the layers for editing and is ignored if the PNG changed outside.
@MainActor
final class PixelDoc: ObservableObject {
    static var open: [URL: PixelDoc] = [:]
    static weak var active: PixelDoc?
    static var clipboard: PixelBuffer?

    private struct Snapshot { var layers: [PixelLayer]; var active: Int; var width: Int; var height: Int }

    let url: URL
    @Published private(set) var width: Int
    @Published private(set) var height: Int
    @Published private(set) var version = 0
    @Published private(set) var dirty = false
    @Published private(set) var layers: [PixelLayer]
    @Published var activeLayer = 0
    @Published var selection: PixelRect?
    private var undoStack: [Snapshot] = []
    private var redoStack: [Snapshot] = []

    var layerPixels: [UInt8] { layers[activeLayer].px }

    /// Reads a PNG into non-premultiplied RGBA. Used for loading AND for the sidecar's staleness check, so both see identical bytes.
    nonisolated static func decode(_ url: URL) -> (width: Int, height: Int, px: [UInt8])? {
        guard let image = NSImage(contentsOf: url), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
        let w = cg.width, h = cg.height
        var buf = [UInt8](repeating: 0, count: w * h * 4)
        let space = CGColorSpace(name: CGColorSpace.sRGB)!
        buf.withUnsafeMutableBytes { raw in
            if let ctx = CGContext(data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: space,
                                   bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) {
                ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
            }
        }
        for i in stride(from: 0, to: buf.count, by: 4) { // un-premultiply
            let a = Int(buf[i + 3])
            if a > 0 && a < 255 { for c in 0..<3 { buf[i + c] = UInt8(min(255, Int(buf[i + c]) * 255 / a)) } }
        }
        return (w, h, buf)
    }

    init(url: URL) {
        self.url = url
        let decoded = Self.decode(url)
        let w = decoded?.width ?? 32, h = decoded?.height ?? 32
        width = w; height = h
        let base = decoded?.px ?? [UInt8](repeating: 0, count: w * h * 4)
        layers = [PixelLayer(name: "Layer 1", px: base)]
        if let saved = Self.loadSidecar(for: url, width: w, height: h, flatHash: Self.hash(base)) {
            layers = saved.layers
            activeLayer = min(saved.active, saved.layers.count - 1)
        }
    }

    static func image(of buffer: PixelBuffer) -> NSImage? {
        let doc = PixelDoc(blank: buffer.width, buffer.height)
        doc.layers[0].px = buffer.px
        return doc.image
    }

    static func createBlank(at url: URL, width: Int, height: Int) throws {
        let doc = PixelDoc(blank: width, height)
        try doc.writePNG(to: url)
    }

    private init(blank w: Int, _ h: Int) {
        url = URL(fileURLWithPath: "/"); width = w; height = h
        layers = [PixelLayer(name: "Layer 1", px: [UInt8](repeating: 0, count: w * h * 4))]
    }

    // MARK: Pixels (all edits apply to the active layer)

    func get(_ x: Int, _ y: Int) -> [UInt8] {
        guard x >= 0, y >= 0, x < width, y < height else { return [0, 0, 0, 0] }
        let i = (y * width + x) * 4
        return Array(layers[activeLayer].px[i..<i + 4])
    }

    func set(_ x: Int, _ y: Int, _ c: [UInt8]) {
        guard x >= 0, y >= 0, x < width, y < height else { return }
        let i = (y * width + x) * 4
        layers[activeLayer].px[i] = c[0]; layers[activeLayer].px[i + 1] = c[1]; layers[activeLayer].px[i + 2] = c[2]; layers[activeLayer].px[i + 3] = c[3]
    }

    func stamp(_ x: Int, _ y: Int, size: Int, _ c: [UInt8]) {
        let r = size / 2
        for dy in 0..<size { for dx in 0..<size { set(x - r + dx, y - r + dy, c) } }
    }

    func line(_ x0: Int, _ y0: Int, _ x1: Int, _ y1: Int, size: Int, _ c: [UInt8]) {
        var x = x0, y = y0
        let dx = abs(x1 - x0), dy = -abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
        var err = dx + dy
        while true {
            stamp(x, y, size: size, c)
            if x == x1 && y == y1 { break }
            let e2 = 2 * err
            if e2 >= dy { err += dy; x += sx }
            if e2 <= dx { err += dx; y += sy }
        }
    }

    func rect(_ x0: Int, _ y0: Int, _ x1: Int, _ y1: Int, filled: Bool, size: Int, _ c: [UInt8]) {
        let a = min(x0, x1), b = max(x0, x1), t = min(y0, y1), d = max(y0, y1)
        if filled { for y in max(0, t)...min(height - 1, d) { for x in max(0, a)...min(width - 1, b) { set(x, y, c) } } } else {
            line(a, t, b, t, size: size, c); line(a, d, b, d, size: size, c); line(a, t, a, d, size: size, c); line(b, t, b, d, size: size, c)
        }
    }

    func fill(_ x: Int, _ y: Int, _ c: [UInt8]) {
        guard x >= 0, y >= 0, x < width, y < height else { return }
        let target = get(x, y)
        if target == c { return }
        var stack = [(x, y)]
        while let (cx, cy) = stack.popLast() {
            guard cx >= 0, cy >= 0, cx < width, cy < height, get(cx, cy) == target else { continue }
            set(cx, cy, c)
            stack.append((cx + 1, cy)); stack.append((cx - 1, cy)); stack.append((cx, cy + 1)); stack.append((cx, cy - 1))
        }
    }

    func resize(width w: Int, height h: Int) {
        guard w > 0, h > 0, w <= 2048, h <= 2048, (w, h) != (width, height) else { return }
        snapshot()
        for l in layers.indices {
            var out = [UInt8](repeating: 0, count: w * h * 4)
            for y in 0..<min(h, height) { for x in 0..<min(w, width) { let s = (y * width + x) * 4, d = (y * w + x) * 4; for c in 0..<4 { out[d + c] = layers[l].px[s + c] } } }
            layers[l].px = out
        }
        width = w; height = h; selection = nil; touch()
    }

    // MARK: Selection and clipboard

    func extract(_ r: PixelRect) -> PixelBuffer {
        var out = [UInt8](repeating: 0, count: r.w * r.h * 4)
        for y in 0..<r.h { for x in 0..<r.w { let c = get(r.x0 + x, r.y0 + y); let d = (y * r.w + x) * 4; for i in 0..<4 { out[d + i] = c[i] } } }
        return PixelBuffer(width: r.w, height: r.h, px: out)
    }

    func clear(_ r: PixelRect) {
        for y in r.y0...r.y1 { for x in r.x0...r.x1 { set(x, y, [0, 0, 0, 0]) } }
    }

    /// Source-over: transparent pixels of the buffer leave what is underneath alone.
    func paste(_ b: PixelBuffer, atX ox: Int, y oy: Int) {
        for y in 0..<b.height { for x in 0..<b.width {
            let s = (y * b.width + x) * 4
            let sa = Int(b.px[s + 3])
            if sa == 0 { continue }
            let dstX = ox + x, dstY = oy + y
            guard dstX >= 0, dstY >= 0, dstX < width, dstY < height else { continue }
            let d = get(dstX, dstY)
            set(dstX, dstY, Self.over([b.px[s], b.px[s + 1], b.px[s + 2], b.px[s + 3]], d))
        } }
    }

    func flip(_ r: PixelRect, horizontal: Bool) {
        let b = extract(r)
        var out = b.px
        for y in 0..<b.height { for x in 0..<b.width {
            let sx = horizontal ? b.width - 1 - x : x, sy = horizontal ? y : b.height - 1 - y
            for i in 0..<4 { out[(y * b.width + x) * 4 + i] = b.px[(sy * b.width + sx) * 4 + i] }
        } }
        for y in 0..<b.height { for x in 0..<b.width { set(r.x0 + x, r.y0 + y, Array(out[(y * b.width + x) * 4..<(y * b.width + x) * 4 + 4])) } }
    }

    static func over(_ s: [UInt8], _ d: [UInt8]) -> [UInt8] {
        let sa = Int(s[3]), da = Int(d[3])
        if sa == 255 || da == 0 { return s }
        let oa = sa * 255 + da * (255 - sa)           // alpha * 255
        if oa == 0 { return [0, 0, 0, 0] }
        var out = [UInt8](repeating: 0, count: 4)
        for c in 0..<3 { out[c] = UInt8(min(255, (Int(s[c]) * sa * 255 + Int(d[c]) * da * (255 - sa)) / oa)) }
        out[3] = UInt8(min(255, oa / 255))
        return out
    }

    // MARK: Layers

    func addLayer() { snapshot(); layers.insert(PixelLayer(name: "Layer \(layers.count + 1)", px: [UInt8](repeating: 0, count: width * height * 4)), at: activeLayer + 1); activeLayer += 1; touch() }

    func duplicateLayer() {
        snapshot()
        var copy = layers[activeLayer]; copy.name += " copy"
        layers.insert(copy, at: activeLayer + 1); activeLayer += 1; touch()
    }

    func deleteLayer() {
        guard layers.count > 1 else { return }
        snapshot(); layers.remove(at: activeLayer); activeLayer = min(activeLayer, layers.count - 1); touch()
    }

    func moveLayer(by d: Int) {
        let to = activeLayer + d
        guard to >= 0, to < layers.count else { return }
        snapshot(); layers.swapAt(activeLayer, to); activeLayer = to; touch()
    }

    func mergeDown() {
        guard activeLayer > 0 else { return }
        snapshot()
        let top = layers[activeLayer].px
        var below = layers[activeLayer - 1].px
        for i in stride(from: 0, to: top.count, by: 4) {
            let o = Self.over([top[i], top[i + 1], top[i + 2], top[i + 3]], [below[i], below[i + 1], below[i + 2], below[i + 3]])
            below[i] = o[0]; below[i + 1] = o[1]; below[i + 2] = o[2]; below[i + 3] = o[3]
        }
        layers[activeLayer - 1].px = below
        layers.remove(at: activeLayer); activeLayer -= 1; touch()
    }

    func setVisible(_ index: Int, _ on: Bool) { guard index < layers.count else { return }; layers[index].visible = on; touch() }
    func rename(_ index: Int, _ name: String) { guard index < layers.count, !name.isEmpty else { return }; layers[index].name = name; dirty = true; objectWillChange.send() }

    // MARK: History

    private func current() -> Snapshot { Snapshot(layers: layers, active: activeLayer, width: width, height: height) }
    func snapshot() { undoStack.append(current()); if undoStack.count > 60 { undoStack.removeFirst() }; redoStack.removeAll() }
    func undo() { guard let last = undoStack.popLast() else { return }; redoStack.append(current()); apply(last) }
    func redo() { guard let next = redoStack.popLast() else { return }; undoStack.append(current()); apply(next) }
    var canUndo: Bool { !undoStack.isEmpty }
    var canRedo: Bool { !redoStack.isEmpty }

    private func apply(_ s: Snapshot) { layers = s.layers; activeLayer = s.active; width = s.width; height = s.height; selection = nil; touch() }

    /// Replaces the active layer's pixels (used while a line/rect/selection is being dragged, without adding history).
    func restore(_ bytes: [UInt8]) { if bytes.count == layers[activeLayer].px.count { layers[activeLayer].px = bytes }; touch() }
    var bytes: [UInt8] { layers[activeLayer].px }
    func touch() { version += 1; dirty = true }

    // MARK: Output

    /// All visible layers composited bottom to top.
    func flattened() -> [UInt8] {
        var out = [UInt8](repeating: 0, count: width * height * 4)
        for layer in layers where layer.visible {
            for i in stride(from: 0, to: out.count, by: 4) {
                let sa = layer.px[i + 3]
                if sa == 0 { continue }
                let o = Self.over([layer.px[i], layer.px[i + 1], layer.px[i + 2], sa], [out[i], out[i + 1], out[i + 2], out[i + 3]])
                out[i] = o[0]; out[i + 1] = o[1]; out[i + 2] = o[2]; out[i + 3] = o[3]
            }
        }
        return out
    }

    var image: NSImage? {
        var buf = flattened()
        for i in stride(from: 0, to: buf.count, by: 4) { // premultiply for CoreGraphics
            let a = Int(buf[i + 3])
            if a < 255 { for c in 0..<3 { buf[i + c] = UInt8(Int(buf[i + c]) * a / 255) } }
        }
        let space = CGColorSpace(name: CGColorSpace.sRGB)!
        let w = width, h = height
        let cg: CGImage? = buf.withUnsafeMutableBytes { raw in
            CGContext(data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: space,
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)?.makeImage()
        }
        return cg.map { NSImage(cgImage: $0, size: NSSize(width: w, height: h)) }
    }

    func writePNG(to url: URL) throws {
        guard let image, let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
              let data = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:]) else {
            throw NSError(domain: "Piston", code: 1, userInfo: [NSLocalizedDescriptionKey: "Couldn't encode the PNG"])
        }
        try data.write(to: url)
    }

    @discardableResult
    func save() -> Bool {
        do {
            try writePNG(to: url)
            try writeSidecar()
            dirty = false
            return true
        } catch { return false }
    }

    // MARK: Layer sidecar

    nonisolated static func hash(_ bytes: [UInt8]) -> String {
        var h: UInt64 = 1469598103934665603
        for b in bytes { h = (h ^ UInt64(b)) &* 1099511628211 }
        return String(h, radix: 16)
    }

    private static func sidecarURL(_ url: URL) -> URL { url.appendingPathExtension("layers.json") }

    private func writeSidecar() throws {
        let side = Self.sidecarURL(url)
        guard layers.count > 1 else { try? FileManager.default.removeItem(at: side); return }
        let space = CGColorSpace(name: CGColorSpace.sRGB)!
        var entries: [[String: Any]] = []
        for layer in layers {
            var buf = layer.px
            for i in stride(from: 0, to: buf.count, by: 4) { let a = Int(buf[i + 3]); if a < 255 { for c in 0..<3 { buf[i + c] = UInt8(Int(buf[i + c]) * a / 255) } } }
            let w = width, h = height
            guard let cg = buf.withUnsafeMutableBytes({ raw in
                CGContext(data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)?.makeImage()
            }), let png = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:]) else { continue }
            entries.append(["name": layer.name, "visible": layer.visible, "png": png.base64EncodedString()])
        }
        let written = Self.decode(url)?.px ?? flattened()   // hash what a reload will actually read back from the PNG
        let obj: [String: Any] = ["version": 1, "width": width, "height": height, "active": activeLayer, "flatHash": Self.hash(written), "layers": entries]
        try JSONSerialization.data(withJSONObject: obj).write(to: side)
    }

    private static func loadSidecar(for url: URL, width: Int, height: Int, flatHash: String) -> (layers: [PixelLayer], active: Int)? {
        guard let data = try? Data(contentsOf: sidecarURL(url)), let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              (obj["width"] as? Int) == width, (obj["height"] as? Int) == height, (obj["flatHash"] as? String) == flatHash,
              let entries = obj["layers"] as? [[String: Any]] else { return nil }   // PNG edited elsewhere: the sidecar is stale, ignore it
        var out: [PixelLayer] = []
        for e in entries {
            guard let b64 = e["png"] as? String, let png = Data(base64Encoded: b64), let img = NSImage(data: png),
                  let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil), cg.width == width, cg.height == height else { return nil }
            var buf = [UInt8](repeating: 0, count: width * height * 4)
            let space = CGColorSpace(name: CGColorSpace.sRGB)!
            buf.withUnsafeMutableBytes { raw in
                CGContext(data: raw.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: space,
                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)?.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
            }
            for i in stride(from: 0, to: buf.count, by: 4) { let a = Int(buf[i + 3]); if a > 0 && a < 255 { for c in 0..<3 { buf[i + c] = UInt8(min(255, Int(buf[i + c]) * 255 / a)) } } }
            out.append(PixelLayer(name: e["name"] as? String ?? "Layer", visible: e["visible"] as? Bool ?? true, px: buf))
        }
        return out.isEmpty ? nil : (out, obj["active"] as? Int ?? 0)
    }
}

enum PaintTool: String, CaseIterable, Identifiable {
    case pencil, eraser, fill, picker, line, rect, select
    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .pencil: return "pencil"
        case .eraser: return "eraser"
        case .fill: return "drop.fill"
        case .picker: return "eyedropper"
        case .line: return "line.diagonal"
        case .rect: return "rectangle"
        case .select: return "rectangle.dashed"
        }
    }
    var label: String { self == .select ? "Select (drag to select, drag inside to move; hold ⌥ to copy)" : rawValue.capitalized }
}

struct SpritePainterView: View {
    @ObservedObject var model: EditorModel
    let url: URL
    @StateObject private var holder = DocHolder()
    var body: some View {
        Group {
            if let doc = holder.doc { PainterBody(model: model, doc: doc) } else { ProgressView() }
        }
        .onAppear { if holder.doc == nil { holder.load(url) } }
        .onChange(of: url) { _, new in holder.load(new) }
    }

    @MainActor final class DocHolder: ObservableObject {
        @Published var doc: PixelDoc?
        func load(_ url: URL) { let d = PixelDoc.open[url] ?? PixelDoc(url: url); PixelDoc.open[url] = d; doc = d }
    }
}

private struct PainterBody: View {
    @ObservedObject var model: EditorModel
    @ObservedObject var doc: PixelDoc
    @State private var tool: PaintTool = .pencil
    @State private var color: Color = .black
    @State private var brush = 1
    @State private var zoom: CGFloat = 12
    @State private var showGrid = true
    @State private var frameW = 0
    @State private var frameH = 0
    @State private var filled = false
    @State private var lastPoint: (Int, Int)?
    @State private var startPoint: (Int, Int)?
    @State private var base: [UInt8]?
    @State private var hover: (Int, Int)?
    @State private var recent: [Color] = []
    @State private var moving: (buffer: PixelBuffer, origin: (Int, Int))?
    @State private var previewFPS = 8.0
    @State private var previewPlaying = true
    @FocusState private var focused: Bool

    private var rgba: [UInt8] {
        let c = NSColor(color).usingColorSpace(.sRGB) ?? .black
        return [UInt8(c.redComponent * 255), UInt8(c.greenComponent * 255), UInt8(c.blueComponent * 255), UInt8(c.alphaComponent * 255)]
    }

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            Divider()
            HStack(spacing: 0) {
                ScrollView([.horizontal, .vertical]) { canvas.padding(24) }
                    .background(Color(nsColor: .underPageBackgroundColor))
                Divider()
                sidePanel.frame(width: 190)
            }
            Divider()
            HStack {
                Text("\(doc.width) × \(doc.height) px").font(.caption)
                if let h = hover { Text("x \(h.0)  y \(h.1)").font(.caption.monospacedDigit()).foregroundStyle(.secondary) }
                if let sel = doc.selection { Text("selection \(sel.w) × \(sel.h)").font(.caption.monospacedDigit()).foregroundStyle(.secondary) }
                Spacer()
                Text(doc.dirty ? "Unsaved (saves when you close the tab or press ⌃⌘S)" : "Saved").font(.caption).foregroundStyle(.secondary)
            }.padding(.horizontal, 10).padding(.vertical, 4)
        }
        .focusable().focused($focused).focusEffectDisabled()
        .onCopyCommand { copy(cut: false) }
        .onCutCommand { copy(cut: true) }
        .onPasteCommand(of: [.png, .tiff, .image]) { providers in paste(providers) }
        .onDeleteCommand { deleteSelection() }
        .onAppear { PixelDoc.active = doc; focused = true }
        .onDisappear { if doc.dirty { save() } }
    }

    private func save() { if doc.save() { model.reloadRuntime(); model.status = "Saved \(doc.url.lastPathComponent)" } }

    // MARK: Toolbar and side panel

    private var toolbar: some View {
        HStack(spacing: 8) {
            ForEach(PaintTool.allCases) { t in
                Button { tool = t } label: { Image(systemName: t.symbol).frame(width: 22, height: 18) }
                    .buttonStyle(.bordered).tint(tool == t ? .accentColor : nil).help(t.label)
            }
            Divider().frame(height: 18)
            ColorPicker("", selection: $color, supportsOpacity: true).labelsHidden()
            ForEach(Array(recent.enumerated()), id: \.offset) { _, c in
                Button { color = c } label: { RoundedRectangle(cornerRadius: 3).fill(c).frame(width: 14, height: 14).overlay(RoundedRectangle(cornerRadius: 3).stroke(.secondary.opacity(0.5))) }.buttonStyle(.plain)
            }
            Divider().frame(height: 18)
            Stepper("Brush \(brush)", value: $brush, in: 1...16).fixedSize()
            if tool == .rect { Toggle("Fill", isOn: $filled).toggleStyle(.checkbox) }
            Divider().frame(height: 18)
            Button { doc.undo() } label: { Image(systemName: "arrow.uturn.backward") }.disabled(!doc.canUndo)
            Button { doc.redo() } label: { Image(systemName: "arrow.uturn.forward") }.disabled(!doc.canRedo)
            if let sel = doc.selection {
                Divider().frame(height: 18)
                Button { flip(sel, horizontal: true) } label: { Image(systemName: "arrow.left.and.right.righttriangle.left.righttriangle.right") }.help("Flip selection horizontally")
                Button { flip(sel, horizontal: false) } label: { Image(systemName: "arrow.up.and.down.righttriangle.up.righttriangle.down") }.help("Flip selection vertically")
            }
            Spacer()
            Toggle("Grid", isOn: $showGrid).toggleStyle(.checkbox)
            Text("Frame").font(.caption)
            LiveNumberField(value: Double(frameW)) { frameW = max(0, Int($0)) }.frame(width: 44)
            Text("×").font(.caption)
            LiveNumberField(value: Double(frameH)) { frameH = max(0, Int($0)) }.frame(width: 44)
            Divider().frame(height: 18)
            Slider(value: $zoom, in: 2...48).frame(width: 90)
            Text("\(Int(zoom))×").font(.caption.monospacedDigit()).frame(width: 30)
            Button("Save") { save() }.keyboardShortcut("s", modifiers: [.command, .control]).disabled(!doc.dirty)
        }
        .controlSize(.small)
        .padding(.horizontal, 8).padding(.vertical, 5)
    }

    private var sidePanel: some View {
        VStack(spacing: 0) {
            HStack {
                Text("LAYERS").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                Spacer()
                Button { doc.addLayer() } label: { Image(systemName: "plus") }.help("New layer")
                Button { doc.duplicateLayer() } label: { Image(systemName: "plus.square.on.square") }.help("Duplicate layer")
                Button { doc.mergeDown() } label: { Image(systemName: "arrow.down.to.line") }.help("Merge down").disabled(doc.activeLayer == 0)
                Button { doc.deleteLayer() } label: { Image(systemName: "trash") }.help("Delete layer").disabled(doc.layers.count < 2)
            }
            .buttonStyle(.borderless).controlSize(.small).padding(.horizontal, 8).frame(height: 26)
            Divider()
            List {
                ForEach(Array(doc.layers.enumerated().reversed()), id: \.offset) { i, layer in // top layer first
                    HStack(spacing: 6) {
                        Button { doc.setVisible(i, !layer.visible) } label: { Image(systemName: layer.visible ? "eye" : "eye.slash").frame(width: 16) }.buttonStyle(.borderless)
                        RenameField(name: layer.name) { doc.rename(i, $0) }
                    }
                    .listRowBackground(i == doc.activeLayer ? Color.accentColor.opacity(0.25) : Color.clear)
                    .contentShape(Rectangle())
                    .onTapGesture { doc.activeLayer = i }
                }
            }
            .listStyle(.plain)
            HStack {
                Button { doc.moveLayer(by: 1) } label: { Image(systemName: "chevron.up") }.help("Move layer up")
                Button { doc.moveLayer(by: -1) } label: { Image(systemName: "chevron.down") }.help("Move layer down")
                Spacer()
            }.buttonStyle(.borderless).controlSize(.small).padding(.horizontal, 8).frame(height: 24)
            Divider()
            framePreview
        }
    }

    /// Plays the frames cut by the Frame size, so you can see the animation without leaving the painter.
    @ViewBuilder
    private var framePreview: some View {
        let fw = frameW, fh = frameH
        if fw > 0, fh > 0, doc.width >= fw, doc.height >= fh {
            let cols = doc.width / fw, rows = doc.height / fh
            let count = cols * rows
            VStack(spacing: 4) {
                HStack {
                    Text("PREVIEW").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                    Spacer()
                    Button { previewPlaying.toggle() } label: { Image(systemName: previewPlaying ? "pause.fill" : "play.fill") }.buttonStyle(.borderless)
                    Text("fps").font(.caption2)
                    LiveNumberField(value: previewFPS) { previewFPS = max(1, min(60, $0)) }.frame(width: 38)
                }
                TimelineView(.animation(paused: !previewPlaying || count < 2)) { ctx in
                    let frame = count > 0 ? Int(ctx.date.timeIntervalSinceReferenceDate * previewFPS) % count : 0
                    let scale = max(1, min(CGFloat(150) / CGFloat(fw), CGFloat(110) / CGFloat(fh)))
                    ZStack {
                        Color(white: 0.5, opacity: 0.15)
                        if let image = doc.image {
                            Image(nsImage: image).resizable().interpolation(.none)
                                .frame(width: CGFloat(doc.width) * scale, height: CGFloat(doc.height) * scale)
                                .offset(x: -CGFloat(frame % cols * fw) * scale, y: -CGFloat(frame / cols * fh) * scale)
                                .frame(width: CGFloat(fw) * scale, height: CGFloat(fh) * scale, alignment: .topLeading)
                                .clipped()
                        }
                    }
                    .frame(width: CGFloat(fw) * scale, height: CGFloat(fh) * scale)
                    .overlay(alignment: .bottomTrailing) { Text("\(frame + 1)/\(count)").font(.system(size: 9, design: .monospaced)).padding(2).background(.black.opacity(0.5)).foregroundStyle(.white) }
                }
                .frame(maxWidth: .infinity)
            }
            .padding(8)
        } else {
            Text("Set the Frame size in the toolbar to preview the animation here.").font(.caption2).foregroundStyle(.secondary).padding(8)
        }
    }

    // MARK: Canvas

    private var canvas: some View {
        let w = CGFloat(doc.width) * zoom, h = CGFloat(doc.height) * zoom
        return ZStack(alignment: .topLeading) {
            Canvas { ctx, size in // checkerboard so transparent pixels are visible
                let cell: CGFloat = max(zoom, 8)
                var y: CGFloat = 0, row = 0
                while y < size.height {
                    var x: CGFloat = 0, col = row % 2
                    while x < size.width {
                        ctx.fill(Path(CGRect(x: x, y: y, width: cell, height: cell)), with: .color(col % 2 == 0 ? Color(white: 0.82) : Color(white: 0.68)))
                        x += cell; col += 1
                    }
                    y += cell; row += 1
                }
            }
            if let image = doc.image {
                Image(nsImage: image).resizable().interpolation(.none).frame(width: w, height: h).id(doc.version)
            }
            Canvas { ctx, size in
                if showGrid, zoom >= 6 {
                    var p = Path()
                    for x in 0...doc.width { p.move(to: CGPoint(x: CGFloat(x) * zoom, y: 0)); p.addLine(to: CGPoint(x: CGFloat(x) * zoom, y: size.height)) }
                    for y in 0...doc.height { p.move(to: CGPoint(x: 0, y: CGFloat(y) * zoom)); p.addLine(to: CGPoint(x: size.width, y: CGFloat(y) * zoom)) }
                    ctx.stroke(p, with: .color(.black.opacity(0.18)), lineWidth: 0.5)
                }
                if frameW > 0, frameH > 0 {
                    var f = Path()
                    for x in stride(from: 0, through: doc.width, by: frameW) { f.move(to: CGPoint(x: CGFloat(x) * zoom, y: 0)); f.addLine(to: CGPoint(x: CGFloat(x) * zoom, y: size.height)) }
                    for y in stride(from: 0, through: doc.height, by: frameH) { f.move(to: CGPoint(x: 0, y: CGFloat(y) * zoom)); f.addLine(to: CGPoint(x: size.width, y: CGFloat(y) * zoom)) }
                    ctx.stroke(f, with: .color(.blue.opacity(0.8)), lineWidth: 1)
                }
                if let s = doc.selection { // marching-ants style box
                    let r = CGRect(x: CGFloat(s.x0) * zoom, y: CGFloat(s.y0) * zoom, width: CGFloat(s.w) * zoom, height: CGFloat(s.h) * zoom)
                    ctx.stroke(Path(r), with: .color(.white), lineWidth: 1.5)
                    ctx.stroke(Path(r), with: .color(.black), style: StrokeStyle(lineWidth: 1.5, dash: [4, 4]))
                }
            }.allowsHitTesting(false)
        }
        .frame(width: w, height: h)
        .overlay(Rectangle().stroke(.secondary.opacity(0.6)))
        .contentShape(Rectangle())
        .onContinuousHover { phase in
            if case .active(let p) = phase { hover = (Int(p.x / zoom), Int(p.y / zoom)) } else { hover = nil }
        }
        .gesture(DragGesture(minimumDistance: 0).onChanged { g in stroke(g) }.onEnded { _ in endStroke() })
    }

    // MARK: Painting

    private func stroke(_ g: DragGesture.Value) {
        focused = true
        let x = Int(floor(g.location.x / zoom)), y = Int(floor(g.location.y / zoom))
        let c = tool == .eraser ? [0, 0, 0, 0] as [UInt8] : rgba
        if lastPoint == nil {
            startPoint = (x, y)
            switch tool {
            case .select: beginSelect(x, y)
            case .fill: doc.snapshot(); base = doc.bytes; doc.fill(x, y, c); doc.touch()
            case .picker:
                let p = doc.get(x, y)
                color = Color(.sRGB, red: Double(p[0]) / 255, green: Double(p[1]) / 255, blue: Double(p[2]) / 255, opacity: Double(p[3]) / 255)
            case .pencil, .eraser: doc.snapshot(); base = doc.bytes; doc.stamp(x, y, size: brush, c); doc.touch()
            case .line, .rect: doc.snapshot(); base = doc.bytes
            }
        } else if let last = lastPoint, last != (x, y) {
            switch tool {
            case .pencil, .eraser: doc.line(last.0, last.1, x, y, size: brush, c); doc.touch()
            case .line, .rect:
                if let base, let s = startPoint {
                    doc.restore(base)
                    if tool == .line { doc.line(s.0, s.1, x, y, size: brush, c) } else { doc.rect(s.0, s.1, x, y, filled: filled, size: brush, c) }
                    doc.touch()
                }
            case .select: dragSelect(x, y)
            default: break
            }
        }
        lastPoint = (x, y)
    }

    private func endStroke() {
        if tool != .picker, tool != .select, !recent.contains(color), tool != .eraser { recent.insert(color, at: 0); recent = Array(recent.prefix(8)) }
        moving = nil
        lastPoint = nil; startPoint = nil; base = nil
    }

    // MARK: Selection

    private func beginSelect(_ x: Int, _ y: Int) {
        if let sel = doc.selection, sel.contains(x, y) {   // drag inside the selection: lift it (⌥ keeps the original)
            doc.snapshot()
            let buffer = doc.extract(sel)
            if !NSEvent.modifierFlags.contains(.option) { doc.clear(sel) }
            base = doc.bytes
            moving = (buffer, (sel.x0, sel.y0))
            doc.touch()
        } else {
            doc.selection = PixelRect(x0: x, y0: y, x1: x, y1: y)
            moving = nil
        }
    }

    private func dragSelect(_ x: Int, _ y: Int) {
        guard let s = startPoint else { return }
        if let moving, let base, let sel = doc.selection {
            let nx = moving.origin.0 + (x - s.0), ny = moving.origin.1 + (y - s.1)
            doc.restore(base)
            doc.paste(moving.buffer, atX: nx, y: ny)
            doc.selection = PixelRect(x0: nx, y0: ny, x1: nx + sel.w - 1, y1: ny + sel.h - 1)
        } else {
            let x0 = max(0, min(s.0, x)), y0 = max(0, min(s.1, y)), x1 = min(doc.width - 1, max(s.0, x)), y1 = min(doc.height - 1, max(s.1, y))
            doc.selection = PixelRect(x0: x0, y0: y0, x1: x1, y1: y1)
        }
    }

    private func flip(_ sel: PixelRect, horizontal: Bool) {
        doc.snapshot(); doc.flip(sel, horizontal: horizontal); doc.touch()
    }

    private func deleteSelection() {
        guard let sel = doc.selection else { return }
        doc.snapshot(); doc.clear(sel); doc.touch()
    }

    private func copy(cut: Bool) -> [NSItemProvider] {
        guard let sel = doc.selection else { return [] }
        let buffer = doc.extract(sel)
        PixelDoc.clipboard = buffer
        if cut { doc.snapshot(); doc.clear(sel); doc.touch() }
        return PixelDoc.image(of: buffer).map { [NSItemProvider(object: $0)] } ?? []
    }

    private func paste(_ providers: [NSItemProvider]) {
        if let buffer = PixelDoc.clipboard {
            drop(buffer)
        } else if let provider = providers.first, provider.canLoadObject(ofClass: NSImage.self) {
            _ = provider.loadObject(ofClass: NSImage.self) { object, _ in
                guard let image = object as? NSImage, let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return }
                Task { @MainActor in drop(bufferFrom(cg)) }
            }
        }
    }

    private func bufferFrom(_ cg: CGImage) -> PixelBuffer {
        let w = cg.width, h = cg.height
        var buf = [UInt8](repeating: 0, count: w * h * 4)
        buf.withUnsafeMutableBytes { raw in
            CGContext(data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)?.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        }
        for i in stride(from: 0, to: buf.count, by: 4) { let a = Int(buf[i + 3]); if a > 0 && a < 255 { for c in 0..<3 { buf[i + c] = UInt8(min(255, Int(buf[i + c]) * 255 / a)) } } }
        return PixelBuffer(width: w, height: h, px: buf)
    }

    /// Pastes at the top-left of the selection (or the hovered pixel), then selects it so it can be dragged into place.
    private func drop(_ buffer: PixelBuffer) {
        let origin = doc.selection.map { ($0.x0, $0.y0) } ?? hover ?? (0, 0)
        doc.snapshot()
        doc.paste(buffer, atX: origin.0, y: origin.1)
        doc.selection = PixelRect(x0: origin.0, y0: origin.1, x1: min(doc.width - 1, origin.0 + buffer.width - 1), y1: min(doc.height - 1, origin.1 + buffer.height - 1))
        tool = .select
        doc.touch()
    }
}

// MARK: New sprite

struct NewSpriteSheet: View {
    @ObservedObject var model: EditorModel
    let directory: URL
    var onDone: () -> Void
    @State private var name = "sprite"
    @State private var width = 64
    @State private var height = 64
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("New Sprite").font(.headline)
            HStack { Text("Name").frame(width: 60, alignment: .leading); TextField("", text: $name).textFieldStyle(.roundedBorder) }
            HStack {
                Text("Size").frame(width: 60, alignment: .leading)
                LiveNumberField(value: Double(width)) { width = max(1, min(2048, Int($0))) }.frame(width: 70)
                Text("×")
                LiveNumberField(value: Double(height)) { height = max(1, min(2048, Int($0))) }.frame(width: 70)
                Menu("Presets") { ForEach([16, 32, 64, 128, 256], id: \.self) { s in Button("\(s) × \(s)") { width = s; height = s } } }.fixedSize()
            }
            Text("Tip: for an animation, make the image N frames wide, e.g. 4 frames of 32×32 → 128 × 32.").font(.caption).foregroundStyle(.secondary)
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("Cancel") { onDone() }.keyboardShortcut(.cancelAction)
                Button("Create") { create() }.keyboardShortcut(.defaultAction)
            }
        }
        .padding(18).frame(width: 380)
    }

    private func create() {
        let base = name.trimmingCharacters(in: .whitespaces)
        guard !base.isEmpty else { return }
        let file = directory.appendingPathComponent(base.hasSuffix(".png") ? base : base + ".png")
        guard !FileManager.default.fileExists(atPath: file.path) else { error = "\(file.lastPathComponent) already exists"; return }
        do {
            try PixelDoc.createBlank(at: file, width: width, height: height)
            onDone()
            model.openFile(file)
        } catch { self.error = error.localizedDescription }
    }
}
