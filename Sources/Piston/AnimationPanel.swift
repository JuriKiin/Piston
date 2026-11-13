import SwiftUI

// MARK: Data (mirrors the runtime's clip JSON: { name, duration, loop, tracks:[{path, keys:[{t,v,ease}]}], events:[{t,name}] })

enum AnimValue: Hashable {
    case num(Double)
    case color(String)

    init?(_ any: Any?) {
        if let s = any as? String { self = .color(s) } else if let n = any as? NSNumber { self = .num(n.doubleValue) } else { return nil }
    }
    var json: Any { switch self { case .num(let d): return d; case .color(let s): return s } }
}

struct AnimKey: Identifiable, Equatable {
    let id = UUID()
    var t: Double
    var v: AnimValue
    var ease: String = "linear"
}

struct AnimTrack: Identifiable, Equatable {
    let id = UUID()
    var path: String
    var keys: [AnimKey]
    var isColor: Bool { if case .color = keys.first?.v { return true } else { return false } }
}

struct AnimEvent: Identifiable, Equatable {
    let id = UUID()
    var t: Double
    var name: String
}

struct AnimClip: Identifiable, Equatable {
    let id = UUID()
    var name: String
    var duration: Double = 1
    var loop = true
    var tracks: [AnimTrack] = []
    var events: [AnimEvent] = []

    init(name: String) { self.name = name }

    init(json: [String: Any]) {
        name = json["name"] as? String ?? "clip"
        duration = max(0.05, (json["duration"] as? NSNumber)?.doubleValue ?? 1)
        loop = (json["loop"] as? Bool) ?? true
        tracks = (json["tracks"] as? [[String: Any]] ?? []).map { t in
            AnimTrack(path: t["path"] as? String ?? "", keys: (t["keys"] as? [[String: Any]] ?? []).compactMap { k in
                guard let v = AnimValue(k["v"]) else { return nil }
                return AnimKey(t: (k["t"] as? NSNumber)?.doubleValue ?? 0, v: v, ease: k["ease"] as? String ?? "linear")
            })
        }
        events = (json["events"] as? [[String: Any]] ?? []).map { AnimEvent(t: ($0["t"] as? NSNumber)?.doubleValue ?? 0, name: $0["name"] as? String ?? "event") }
    }

    var json: [String: Any] {
        ["name": name, "duration": duration, "loop": loop,
         "tracks": tracks.map { tr in ["path": tr.path, "keys": tr.keys.sorted { $0.t < $1.t }.map { ["t": $0.t, "v": $0.v.json, "ease": $0.ease] as [String: Any] }] as [String: Any] },
         "events": events.sorted { $0.t < $1.t }.map { ["t": $0.t, "name": $0.name] as [String: Any] }]
    }
}

struct AnimProperty: Identifiable, Hashable {
    var id: String { path }
    let path: String
    let label: String
    let isColor: Bool
    let value: AnimValue
}

enum AnimSelection: Equatable {
    case key(track: Int, key: Int)
    case event(Int)
}

func animEase(_ name: String, _ p: Double) -> Double {
    switch name {
    case "step": return p >= 1 ? 1 : 0
    case "easeIn": return p * p
    case "easeOut": return 1 - (1 - p) * (1 - p)
    case "easeInOut": return p < 0.5 ? 2 * p * p : 1 - pow(-2 * p + 2, 2) / 2
    case "cubicIn": return p * p * p
    case "cubicOut": return 1 - pow(1 - p, 3)
    case "cubicInOut": return p < 0.5 ? 4 * p * p * p : 1 - pow(-2 * p + 2, 3) / 2
    case "backOut": let c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * pow(p - 1, 3) + c1 * pow(p - 1, 2)
    case "bounceOut":
        let n = 7.5625, d = 2.75; var q = p
        if q < 1 / d { return n * q * q }
        if q < 2 / d { q -= 1.5 / d; return n * q * q + 0.75 }
        if q < 2.5 / d { q -= 2.25 / d; return n * q * q + 0.9375 }
        q -= 2.625 / d; return n * q * q + 0.984375
    default: return p
    }
}

/// CSS colors as [r, g, b, a] (0...255, a 0...1): "#rgb", "#rrggbb", "#rrggbbaa", rgb()/rgba(), a few names. Mirrors the runtime.
enum AnimColor {
    static let named: [String: [Double]] = ["white": [255, 255, 255, 1], "black": [0, 0, 0, 1], "red": [255, 0, 0, 1], "green": [0, 128, 0, 1],
        "lime": [0, 255, 0, 1], "blue": [0, 0, 255, 1], "yellow": [255, 255, 0, 1], "orange": [255, 165, 0, 1], "purple": [128, 0, 128, 1],
        "pink": [255, 192, 203, 1], "gray": [128, 128, 128, 1], "grey": [128, 128, 128, 1], "cyan": [0, 255, 255, 1], "magenta": [255, 0, 255, 1],
        "transparent": [0, 0, 0, 0]]

    static func parse(_ text: String) -> [Double]? {
        let s = text.trimmingCharacters(in: .whitespaces).lowercased()
        if let n = named[s] { return n }
        if s.hasPrefix("#") {
            var h = String(s.dropFirst())
            if h.count == 3 || h.count == 4 { h = h.map { "\($0)\($0)" }.joined() }
            guard h.count == 6 || h.count == 8, let v = UInt64(h, radix: 16) else { return nil }
            if h.count == 6 { return [Double((v >> 16) & 255), Double((v >> 8) & 255), Double(v & 255), 1] }
            return [Double((v >> 24) & 255), Double((v >> 16) & 255), Double((v >> 8) & 255), Double(v & 255) / 255]
        }
        if s.hasPrefix("rgb") {
            let nums = s.components(separatedBy: CharacterSet(charactersIn: "0123456789.").inverted).filter { !$0.isEmpty }.compactMap(Double.init)
            if nums.count >= 3 { return [nums[0], nums[1], nums[2], nums.count > 3 ? nums[3] : 1] }
        }
        return nil
    }

    static func format(_ c: [Double]) -> String {
        let v = c.prefix(3).map { Int(max(0, min(255, $0.rounded()))) }
        if c[3] >= 0.999 { return String(format: "#%02x%02x%02x", v[0], v[1], v[2]) }
        return "rgba(\(v[0]),\(v[1]),\(v[2]),\((max(0, c[3]) * 1000).rounded() / 1000))"
    }

    static func mix(_ a: String, _ b: String, _ p: Double) -> String? {
        guard let ca = parse(a), let cb = parse(b) else { return nil }
        return format((0..<4).map { ca[$0] + (cb[$0] - ca[$0]) * p })
    }
}

extension AnimClip {
    /// Any track's value at `t` (numbers and colors), so the Inspector can show what the animation does at the playhead.
    func value(_ path: String, at t: Double) -> AnimValue? {
        guard let tr = tracks.first(where: { $0.path == path }) else { return nil }
        let keys = tr.keys.sorted { $0.t < $1.t }
        guard let first = keys.first, let last = keys.last else { return nil }
        if t <= first.t { return first.v }
        if t >= last.t { return last.v }
        guard let i = keys.lastIndex(where: { $0.t <= t }), i + 1 < keys.count else { return nil }
        let a = keys[i], b = keys[i + 1]
        let span = b.t - a.t
        let p = animEase(a.ease, span > 0 ? (t - a.t) / span : 1)
        switch (a.v, b.v) {
        case (.num(let x), .num(let y)): return .num(x + (y - x) * p)
        case (.color(let x), .color(let y)): return AnimColor.mix(x, y, p).map { .color($0) } ?? (p >= 1 ? b.v : a.v)
        default: return p >= 1 ? b.v : a.v
        }
    }

    /// A number track's value at `t` (mirrors the runtime's evaluateTrack; used so edits start from the visible pose).
    func number(_ path: String, at t: Double) -> Double? {
        guard let tr = tracks.first(where: { $0.path == path }) else { return nil }
        let keys = tr.keys.sorted { $0.t < $1.t }
        guard let first = keys.first, let last = keys.last else { return nil }
        func val(_ k: AnimKey) -> Double? { if case .num(let d) = k.v { return d } else { return nil } }
        if t <= first.t { return val(first) }
        if t >= last.t { return val(last) }
        guard let i = keys.lastIndex(where: { $0.t <= t }), i + 1 < keys.count, let a = val(keys[i]), let b = val(keys[i + 1]) else { return nil }
        let span = keys[i + 1].t - keys[i].t
        let p = span > 0 ? (t - keys[i].t) / span : 1
        return a + (b - a) * animEase(keys[i].ease, p)
    }
}

let animationEasings = ["linear", "step", "easeIn", "easeOut", "easeInOut", "cubicIn", "cubicOut", "cubicInOut", "backOut", "bounceOut"]

// MARK: State

/// Everything the Animation panel edits. The clips themselves live in the document (the selected entity's Animator
/// component), so Undo, Save and the Scene view all work as for any other field; this holds only the playhead,
/// selection and the list of animatable properties.
@MainActor
final class AnimationEditorState: ObservableObject {
    unowned let model: EditorModel
    @Published var clipName: String?
    @Published var time: Double = 0
    @Published var isPlaying = false
    @Published var selection: AnimSelection?
    @Published var properties: [AnimProperty] = []
    @Published var recording = true   // edits to the posed entity become keys at the playhead
    @Published var pxPerSecond: Double = 0   // 0 = fit the panel; zoom buttons raise it
    private var playTask: Task<Void, Never>?
    private var previewInFlight = false
    private var previewDirty = false

    init(model: EditorModel) { self.model = model }

    var entityKey: String? { model.selection }
    var animatorIndex: Int? {
        guard let k = entityKey else { return nil }
        return model.components(k).firstIndex { ($0["type"] as? String) == "Animator" }
    }
    /// The shared animation file this entity's Animator points at, if any (the clips then live in that file, not in the scene).
    var assetURL: URL? {
        guard let k = entityKey, let i = animatorIndex, let raw = model.componentField(k, i, "asset") as? String, !raw.isEmpty,
              let root = model.projectURL else { return nil }
        return root.appendingPathComponent(raw.hasPrefix("./") ? String(raw.dropFirst(2)) : raw)
    }
    private var fileCache: (url: URL, stamp: Date, clips: [AnimClip])?

    private func readFile(_ url: URL) -> [AnimClip] {
        let stamp = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
        if let c = fileCache, c.url == url, c.stamp == stamp { return c.clips }
        guard let data = try? Data(contentsOf: url), let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let raw = obj["clips"] as? [[String: Any]] else { return [] }
        let list = raw.map(AnimClip.init(json:))
        fileCache = (url, stamp, list)
        return list
    }

    private func writeFile(_ url: URL, _ list: [AnimClip]) {
        let obj: [String: Any] = ["version": 1, "clips": list.map(\.json)]
        guard let data = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys]) else { return }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
        let stamp = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
        fileCache = (url, stamp, list)
    }

    private func relativePath(_ url: URL) -> String? {
        guard let root = model.projectURL?.resolvingSymlinksInPath().path else { return nil }
        let p = url.resolvingSymlinksInPath().path
        return p.hasPrefix(root + "/") ? "./" + p.dropFirst(root.count + 1) : nil
    }

    /// Moves this entity's clips out of the scene into a shared `.anim.json` file (survives removing the Animator, reusable by other entities).
    func moveToFile(_ url: URL) {
        guard let k = entityKey, let i = animatorIndex, assetURL == nil else { return }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true) // so symlinks resolve
        guard let rel = relativePath(url.deletingLastPathComponent().resolvingSymlinksInPath().appendingPathComponent(url.lastPathComponent)) else {
            model.status = "Animation files must live inside the project"; return
        }
        writeFile(url, clips)
        model.setComponentField(k, i, "clips", [] as [[String: Any]])
        model.setComponentField(k, i, "asset", rel)
        model.status = "Saved animations to \(rel)"
    }

    /// Points this Animator at an existing animation file (its own inline clips must be empty).
    func link(_ url: URL) {
        guard let k = entityKey, let i = animatorIndex, let rel = relativePath(url) else { model.status = "Animation files must live inside the project"; return }
        model.setComponentField(k, i, "clips", [] as [[String: Any]])
        model.setComponentField(k, i, "asset", rel)
        clipName = nil
    }

    /// Copies the file's clips back into the scene and stops using the file.
    func unlink() {
        guard let k = entityKey, let i = animatorIndex, assetURL != nil else { return }
        let list = clips
        model.setComponentField(k, i, "asset", "")
        model.setComponentField(k, i, "clips", list.map(\.json))
    }

    var clips: [AnimClip] {
        if let url = assetURL { return readFile(url) }
        guard let k = entityKey, let i = animatorIndex, let raw = model.componentField(k, i, "clips") as? [[String: Any]] else { return [] }
        return raw.map(AnimClip.init(json:))
    }
    var clip: AnimClip? { clips.first { $0.name == clipName } ?? clips.first }

    // MARK: Editing

    /// Applies an edit to the clip list, writes it to the document, and refreshes the Scene view's preview pose.
    func mutate(_ edit: (inout [AnimClip]) -> Void) {
        guard let k = entityKey, let i = animatorIndex else { return }
        var list = clips
        edit(&list)
        if let url = assetURL { writeFile(url, list); preview(); return } // file-backed: the file is the source of truth
        model.setComponentField(k, i, "clips", list.map(\.json))
        if (model.componentField(k, i, "defaultClip") as? String ?? "").isEmpty, let first = list.first {
            model.setComponentField(k, i, "defaultClip", first.name)
        }
        preview()
    }

    func mutateClip(_ edit: (inout AnimClip) -> Void) {
        guard let name = clip?.name else { return }
        mutate { list in if let n = list.firstIndex(where: { $0.name == name }) { edit(&list[n]) } }
    }

    func addAnimator() async {
        guard let k = entityKey else { return }
        await model.addComponent(k, type: "Animator")
        await refreshProperties()
    }

    func addClip() {
        let existing = Set(clips.map(\.name))
        var n = clips.count + 1
        while existing.contains("clip\(n)") { n += 1 }
        let name = clips.isEmpty ? "idle" : "clip\(n)"
        mutate { $0.append(AnimClip(name: name)) }
        clipName = name
        time = 0
        selection = nil
    }

    func deleteClip() {
        guard let name = clip?.name else { return }
        mutate { $0.removeAll { $0.name == name } }
        clipName = clips.first?.name
        selection = nil
        endPreview()
    }

    func rename(_ new: String) {
        let trimmed = new.trimmingCharacters(in: .whitespaces)
        guard let old = clip?.name, !trimmed.isEmpty, trimmed != old, !clips.contains(where: { $0.name == trimmed }) else { return }
        mutateClip { $0.name = trimmed }
        if let k = entityKey, let i = animatorIndex, (model.componentField(k, i, "defaultClip") as? String) == old {
            model.setComponentField(k, i, "defaultClip", trimmed)
        }
        clipName = trimmed
    }

    func addTrack(_ p: AnimProperty) {
        mutateClip { clip in
            guard !clip.tracks.contains(where: { $0.path == p.path }) else { return }
            clip.tracks.append(AnimTrack(path: p.path, keys: [AnimKey(t: 0, v: p.value)]))
        }
        if let c = clip { selection = .key(track: c.tracks.count - 1, key: 0) }
    }

    func removeTrack(_ index: Int) {
        mutateClip { if index < $0.tracks.count { $0.tracks.remove(at: index) } }
        selection = nil
    }

    /// Adds a key at the playhead holding whatever value the track has there now (so the curve doesn't jump).
    func addKey(track: Int) {
        guard let c = clip, track < c.tracks.count else { return }
        let t = min(max(0, (time * 100).rounded() / 100), c.duration)
        let tr = c.tracks[track]
        if let existing = tr.keys.firstIndex(where: { abs($0.t - t) < 0.005 }) { selection = .key(track: track, key: existing); return }
        Task {
            let value = await sampleValue(c, path: tr.path, at: t) ?? tr.keys.last?.v ?? .num(0)
            mutateClip { clip in
                guard track < clip.tracks.count else { return }
                clip.tracks[track].keys.append(AnimKey(t: t, v: value))
                clip.tracks[track].keys.sort { $0.t < $1.t }
            }
            if let idx = clip?.tracks[track].keys.firstIndex(where: { abs($0.t - t) < 0.005 }) { selection = .key(track: track, key: idx) }
        }
    }

    func moveKey(track: Int, key: Int, to t: Double) {
        mutateClip { clip in
            guard track < clip.tracks.count, key < clip.tracks[track].keys.count else { return }
            clip.tracks[track].keys[key].t = min(max(0, (t * 100).rounded() / 100), clip.duration)
        }
    }

    func updateKey(track: Int, key: Int, _ edit: (inout AnimKey) -> Void) {
        mutateClip { clip in
            guard track < clip.tracks.count, key < clip.tracks[track].keys.count else { return }
            edit(&clip.tracks[track].keys[key])
        }
    }

    func deleteSelection() {
        switch selection {
        case .key(let t, let k):
            mutateClip { clip in
                guard t < clip.tracks.count, k < clip.tracks[t].keys.count else { return }
                clip.tracks[t].keys.remove(at: k)
                if clip.tracks[t].keys.isEmpty { clip.tracks.remove(at: t) }
            }
        case .event(let i):
            mutateClip { if i < $0.events.count { $0.events.remove(at: i) } }
        case nil: break
        }
        selection = nil
    }

    func addEvent() {
        let t = min(max(0, (time * 100).rounded() / 100), clip?.duration ?? 1)
        mutateClip { $0.events.append(AnimEvent(t: t, name: "event")) }
        if let c = clip { selection = .event(c.events.count - 1) }
    }


    // MARK: Inspector hooks

    /// Property paths animated by this entity's current clip (drives the red markers in the Inspector).
    func animatedPaths(for key: String) -> Set<String> {
        guard entityKey == key, animatorIndex != nil, let c = clip else { return [] }
        return Set(c.tracks.map(\.path))
    }

    /// What the animation gives at the playhead, while the Animation tab is recording on this entity (else nil: show the stored value).
    func poseValue(for key: String, path: String) -> AnimValue? {
        guard recordingActive(for: key), let c = clip else { return nil }
        return c.value(path, at: time)
    }

    /// What the animation gives at the playhead for display (Inspector rows, track labels), whether or not Rec is on or it is playing.
    func displayValue(for key: String, path: String) -> AnimValue? {
        guard entityKey == key, model.bottomTab == .animation, animatorIndex != nil, let c = clip else { return nil }
        return c.value(path, at: time)
    }

    func displayTransform(_ key: String) -> (x: Double, y: Double, rotation: Double, w: Double, h: Double) {
        var r = model.transform(key)
        func num(_ path: String) -> Double? { if case .num(let d)? = displayValue(for: key, path: path) { return d } else { return nil } }
        if let v = num("transform.position.x") { r.x = v }
        if let v = num("transform.position.y") { r.y = v }
        if let v = num("transform.rotation") { r.rotation = v }
        if let v = num("transform.size.x") { r.w = v }
        if let v = num("transform.size.y") { r.h = v }
        return r
    }

    // MARK: Record mode (edit the posed entity, get keys)

    /// True when edits to this entity should become keys: the Animation tab is open on it with a clip, Record is on, not playing.
    func recordingActive(for key: String) -> Bool {
        recording && !isPlaying && model.bottomTab == .animation && entityKey == key && animatorIndex != nil && clip != nil
    }

    /// The animated transform values at the playhead (so a drag starts from what you see, not from the stored base).
    func poseValues(for key: String) -> [String: Double]? {
        guard recordingActive(for: key), let c = clip else { return nil }
        var out: [String: Double] = [:]
        for tr in c.tracks where tr.path.hasPrefix("transform.") { if let v = c.number(tr.path, at: time) { out[tr.path] = v } }
        return out.isEmpty ? nil : out
    }

    func recordTransform(_ key: String, x: Double?, y: Double?, rotation: Double?, w: Double?, h: Double?) -> Bool {
        guard recordingActive(for: key) else { return false }
        var changes: [(String, Double)] = []
        if let x { changes.append(("transform.position.x", x)) }
        if let y { changes.append(("transform.position.y", y)) }
        if let rotation { changes.append(("transform.rotation", rotation)) }
        if let w { changes.append(("transform.size.x", w)) }
        if let h { changes.append(("transform.size.y", h)) }
        guard !changes.isEmpty else { return true }
        let t = snappedTime
        mutateClip { clip in for (path, v) in changes { upsertKey(&clip, path: path, value: .num(v), at: t) } }
        model.status = "Keyed \(changes.count == 1 ? changes[0].0 : "\(changes.count) properties") at \(String(format: "%.2f", t))s"
        return true
    }

    func recordField(_ key: String, _ index: Int, _ field: String, _ value: Any) -> Bool {
        guard recordingActive(for: key) else { return false }
        let comps = model.components(key)
        guard index < comps.count, let type = comps[index]["type"] as? String, type != "Animator",
              let prop = properties.first(where: { $0.path == "\(type).\(field)" }), let v = AnimValue(value),
              prop.isColor == { if case .color = v { return true } else { return false } }() else { return false }
        let t = snappedTime
        mutateClip { upsertKey(&$0, path: prop.path, value: v, at: t) }
        model.status = "Keyed \(prop.label) at \(String(format: "%.2f", t))s"
        return true
    }

    private var snappedTime: Double { min(max(0, (time * 100).rounded() / 100), clip?.duration ?? 1) }

    private func upsertKey(_ clip: inout AnimClip, path: String, value: AnimValue, at t: Double) {
        var idx = clip.tracks.firstIndex { $0.path == path }
        if idx == nil { // a new track keeps the rest pose at time 0 so the animation still starts where the entity sits
            let base = properties.first { $0.path == path }?.value ?? value
            clip.tracks.append(AnimTrack(path: path, keys: t > 0.0049 ? [AnimKey(t: 0, v: base)] : []))
            idx = clip.tracks.count - 1
        }
        let i = idx!
        if let k = clip.tracks[i].keys.firstIndex(where: { abs($0.t - t) < 0.005 }) { clip.tracks[i].keys[k].v = value }
        else { clip.tracks[i].keys.append(AnimKey(t: t, v: value)); clip.tracks[i].keys.sort { $0.t < $1.t } }
    }

    /// Keys every animated property at the playhead with the value it has right now.
    func keyAll() {
        guard let c = clip, !c.tracks.isEmpty else { model.status = "Add a track first (+ Track)"; return }
        let t = snappedTime
        Task {
            var values: [String: AnimValue] = [:]
            for tr in c.tracks { if let v = await sampleValue(c, path: tr.path, at: t) { values[tr.path] = v } }
            mutateClip { clip in for (path, v) in values { upsertKey(&clip, path: path, value: v, at: t) } }
            model.status = "Keyed \(values.count) propert\(values.count == 1 ? "y" : "ies") at \(String(format: "%.2f", t))s"
        }
    }

    // MARK: Runtime preview (the Scene view shows the pose; the document is untouched)

    func refreshProperties() async {
        guard let k = entityKey, animatorIndex != nil,
              let result = try? await model.host.request("animationProperties", ["key": k]) as? [String: Any],
              let list = result["properties"] as? [[String: Any]] else { properties = []; return }
        properties = list.compactMap { p in
            guard let path = p["path"] as? String, let v = AnimValue(p["value"]) else { return nil }
            return AnimProperty(path: path, label: p["label"] as? String ?? path, isColor: (p["type"] as? String) == "color", value: v)
        }
    }

    func sampleValue(_ clip: AnimClip, path: String, at t: Double) async -> AnimValue? {
        guard let r = try? await model.host.request("sampleAnimation", ["clip": clip.json, "time": t]) as? [String: Any],
              let values = r["values"] as? [String: Any] else { return nil }
        return AnimValue(values[path])
    }

    /// Asks the runtime to show the pose at the playhead. Requests are coalesced (latest wins, one in flight) so dragging
    /// or playing never queues a backlog.
    func preview() { previewDirty = true; pumpPreview() }

    private func pumpPreview() {
        guard !previewInFlight, previewDirty, let k = entityKey, let c = clip else { return }
        previewDirty = false
        previewInFlight = true
        let t = time, json = c.json
        Task {
            _ = try? await model.host.request("previewAnimation", ["key": k, "clip": json, "time": t])
            previewInFlight = false
            if previewDirty { pumpPreview() } else if case .idle = model.dragMode { await model.refreshSelectionBounds() }
        }
    }

    func endPreview() {
        Task { _ = try? await model.host.request("endPreview") }
    }

    func scrub(to t: Double) {
        guard let c = clip else { return }
        time = min(max(0, t), c.duration)
        preview()
    }

    func togglePlay() {
        if isPlaying { pause(); return }
        guard let c = clip else { return }
        if time >= c.duration { time = 0 }
        isPlaying = true
        playTask = Task { [weak self] in
            var last = Date()
            while let self, !Task.isCancelled, self.isPlaying {
                try? await Task.sleep(nanoseconds: 33_000_000)
                let now = Date(); let dt = now.timeIntervalSince(last); last = now
                guard let c = self.clip else { break }
                var t = self.time + dt
                if t >= c.duration {
                    if c.loop { t = t.truncatingRemainder(dividingBy: c.duration) } else { t = c.duration; self.isPlaying = false }
                }
                self.time = t
                self.preview()
            }
        }
    }

    func pause() { isPlaying = false; playTask?.cancel(); playTask = nil }

    func stop() { pause(); time = 0; endPreview() }
}

// MARK: Panel

struct AnimationPanel: View {
    @ObservedObject var model: EditorModel
    @ObservedObject var anim: AnimationEditorState
    @FocusState private var panelFocus: Bool
    private let rowHeight: CGFloat = 24
    private let labelWidth: CGFloat = 190

    var body: some View {
        Group {
            if model.selection == nil {
                placeholder("Select an entity to animate it.")
            } else if anim.animatorIndex == nil {
                VStack(spacing: 8) {
                    Text("This entity has no Animator.").foregroundStyle(.secondary)
                    Button("Add Animator") { Task { await anim.addAnimator() } }.buttonStyle(.borderedProminent).controlSize(.small)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let clip = anim.clip {
                VStack(spacing: 0) {
                    header(clip)
                    Divider()
                    timeline(clip)
                    if anim.selection != nil { Divider(); detail(clip) }
                    Divider()
                    hint
                }
            } else {
                VStack(spacing: 8) {
                    Text("No animations yet.").foregroundStyle(.secondary)
                    HStack {
                        Button("New Animation") { anim.addClip() }.buttonStyle(.borderedProminent)
                        Button("Use Animation File…") { chooseFile() }
                    }.controlSize(.small)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .focusable()
        .focused($panelFocus)
        .focusEffectDisabled()
        .onKeyPress(.delete) { anim.selection == nil ? .ignored : { anim.deleteSelection(); return .handled }() }
        .onKeyPress(.deleteForward) { anim.selection == nil ? .ignored : { anim.deleteSelection(); return .handled }() }
        .task(id: model.selection) { anim.stop(); anim.selection = nil; anim.clipName = nil; await anim.refreshProperties() }
        .onDisappear { anim.pause(); anim.endPreview() }
    }

    private func placeholder(_ text: String) -> some View {
        Text(text).foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Header

    private func header(_ clip: AnimClip) -> some View {
        HStack(spacing: 8) {
            Picker("", selection: Binding(get: { clip.name }, set: { anim.clipName = $0; anim.time = 0; anim.selection = nil; anim.preview() })) {
                ForEach(anim.clips) { Text($0.name).tag($0.name) }
            }.labelsHidden().frame(width: 120)
            RenameField(name: clip.name) { anim.rename($0) }.frame(width: 110)
            Button { anim.addClip() } label: { Image(systemName: "plus") }.help("New animation")
            Button { anim.deleteClip() } label: { Image(systemName: "trash") }.help("Delete this animation")
            fileMenu
            Divider().frame(height: 16)
            Button { anim.stop() } label: { Image(systemName: "backward.end.fill") }.help("Back to start")
            Button { anim.togglePlay() } label: { Image(systemName: anim.isPlaying ? "pause.fill" : "play.fill") }.help("Preview in the Scene view")
            Text(String(format: "%.2f / %.2f s", anim.time, clip.duration)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            Divider().frame(height: 16)
            Text("Length").font(.caption)
            LiveNumberField(value: clip.duration) { v in anim.mutateClip { $0.duration = max(0.05, v) } }.frame(width: 56)
            Toggle("Loop", isOn: Binding(get: { clip.loop }, set: { v in anim.mutateClip { $0.loop = v } })).toggleStyle(.checkbox)
            Spacer()
            Button { anim.recording.toggle() } label: {
                HStack(spacing: 4) {
                    Circle().fill(anim.recording ? Color.white : Color.red).frame(width: 7, height: 7)
                    Text(anim.recording ? "REC" : "Rec").font(.caption.weight(.semibold))
                }
                .padding(.horizontal, 7).padding(.vertical, 2)
                .background(anim.recording ? Color.red : Color.secondary.opacity(0.18), in: Capsule())
                .foregroundStyle(anim.recording ? Color.white : Color.primary)
            }
            .buttonStyle(.plain)
            .help("Record: when on, changing the entity's values in the Inspector or Scene view at the playhead creates or updates keys instead of changing its stored values")
            Button { anim.keyAll() } label: { Label("Key", systemImage: "diamond.fill") }
                .help("Key every animated property at the playhead with its current value")
            Menu {
                let used = Set(clip.tracks.map(\.path))
                ForEach(anim.properties.filter { !used.contains($0.path) }) { p in Button(p.label) { anim.addTrack(p) } }
            } label: { Label("Track", systemImage: "plus.circle") }.menuStyle(.borderlessButton).fixedSize().help("Animate another property")
            Button { anim.addEvent() } label: { Label("Event", systemImage: "flag") }.help("Add an event at the playhead")
            Button { anim.pxPerSecond = max(20, anim.pxPerSecond / 1.4) } label: { Image(systemName: "minus.magnifyingglass") }
            Button { anim.pxPerSecond = min(4000, max(anim.pxPerSecond, 200) * 1.4) } label: { Image(systemName: "plus.magnifyingglass") }
        }
        .controlSize(.small)
        .padding(.horizontal, 8).padding(.vertical, 5)
    }

    private var hint: some View {
        HStack(spacing: 6) {
            Circle().fill(anim.recording ? Color.red : Color.secondary).frame(width: 6, height: 6)
            Text(anim.recording
                 ? "Recording: move the playhead, then change a value in the Inspector or drag in the Scene view to set a key there."
                 : "Rec is off: Inspector and Scene edits change the entity's stored values. Click Rec to key them instead.")
                .font(.caption2).foregroundStyle(.secondary)
            Spacer()
        }
        .padding(.horizontal, 8).padding(.vertical, 3)
    }

    // MARK: Animation file

    private var fileMenu: some View {
        Menu {
            if let url = anim.assetURL {
                Button("Open \(url.lastPathComponent)") { model.openFile(url) }
                Button("Reveal in Finder") { NSWorkspace.shared.activateFileViewerSelecting([url]) }
                Divider()
                Button("Stop Using File (copy into scene)") { anim.unlink() }
            } else {
                Button("Save Animations to File…") { saveToFile() }
            }
        } label: {
            Label(anim.assetURL?.lastPathComponent ?? "In scene", systemImage: anim.assetURL == nil ? "doc" : "doc.fill")
        }
        .menuStyle(.borderlessButton).fixedSize()
        .help(anim.assetURL == nil ? "These animations are stored in the scene, on this entity." : "These animations live in a shared file. Every entity that uses it plays the same clips.")
    }

    private func saveToFile() {
        guard let root = model.projectURL, let key = model.selection else { return }
        let dir = root.appendingPathComponent("assets/animations", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let panel = NSSavePanel()
        panel.directoryURL = dir
        let entity = (model.entityDoc(key)?["name"] as? String) ?? (model.entityDoc(key)?["tag"] as? String) ?? "animation"
        panel.nameFieldStringValue = "\(entity.lowercased().replacingOccurrences(of: " ", with: "-")).anim.json"
        panel.message = "Save these animations as a file in your project"
        if panel.runModal() == .OK, let url = panel.url { anim.moveToFile(url) }
    }

    private func chooseFile() {
        guard let root = model.projectURL else { return }
        let panel = NSOpenPanel()
        panel.directoryURL = root.appendingPathComponent("assets/animations", isDirectory: true)
        panel.canChooseFiles = true; panel.canChooseDirectories = false
        if panel.runModal() == .OK, let url = panel.url { anim.link(url) }
    }

    // MARK: Timeline

    /// Pixels per second actually used: at least enough to fill the panel, more when zoomed in.
    private func scale(_ clip: AnimClip, available: CGFloat) -> Double {
        max(anim.pxPerSecond, Double(max(0, available - labelWidth - 40)) / max(0.05, clip.duration))
    }

    private func timeline(_ clip: AnimClip) -> some View {
        GeometryReader { geo in
            let pps = scale(clip, available: geo.size.width)
            let width = max(geo.size.width - labelWidth, CGFloat(clip.duration * pps) + 40)
            let rows = CGFloat(clip.tracks.count + 2) * rowHeight
            ScrollView(.vertical) {
                HStack(alignment: .top, spacing: 0) {
                    VStack(alignment: .leading, spacing: 0) {
                        Color.clear.frame(height: rowHeight)                                 // ruler
                        HStack { Image(systemName: "flag").font(.caption2); Text("Events").font(.caption) }
                            .foregroundStyle(.secondary).frame(height: rowHeight).padding(.leading, 8)
                        ForEach(Array(clip.tracks.enumerated()), id: \.element.id) { i, track in trackLabel(i, track, clip) }
                        if clip.tracks.isEmpty {
                            Text("Use + Track to animate a property").font(.caption).foregroundStyle(.secondary).padding(8)
                        }
                    }
                    .frame(width: labelWidth, alignment: .leading)
                    Divider()
                    ScrollView(.horizontal) {
                        ZStack(alignment: .topLeading) {
                            VStack(spacing: 0) {
                                ruler(clip, width: width, pps: pps)
                                eventRow(clip, width: width, pps: pps)
                                ForEach(Array(clip.tracks.enumerated()), id: \.element.id) { i, track in trackRow(i, track, clip, width: width, pps: pps) }
                            }
                            // Clip end marker and playhead run the full height of the panel.
                            Rectangle().fill(Color.secondary.opacity(0.45)).frame(width: 1).offset(x: clip.duration * pps)
                                .frame(height: max(rows, geo.size.height), alignment: .top).allowsHitTesting(false)
                            Rectangle().fill(Color.red).frame(width: 1.5)
                                .frame(height: max(rows, geo.size.height), alignment: .top)
                                .offset(x: anim.time * pps - 0.75)
                                .allowsHitTesting(false)
                            Image(systemName: "arrowtriangle.down.fill").font(.system(size: 9)).foregroundStyle(.red)
                                .offset(x: anim.time * pps - 4.5, y: 2).allowsHitTesting(false)
                        }
                        .frame(width: width, alignment: .topLeading)
                    }
                }
                .frame(minHeight: geo.size.height, alignment: .top)
            }
        }
    }

    private func ruler(_ clip: AnimClip, width: CGFloat, pps: Double) -> some View {
        // Label spacing grows as you zoom out so labels never crowd: pick the first "nice" step that is at least 70px apart.
        let nice = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30]
        let labelStep = nice.first { $0 * pps >= 70 } ?? 60
        let minorStep = labelStep / (labelStep == 0.25 ? 5 : 5)
        let count = Int(clip.duration / minorStep) + 1
        return ZStack(alignment: .topLeading) {
            Rectangle().fill(Color.secondary.opacity(0.10))
            ForEach(0...max(0, count), id: \.self) { n in
                let t = Double(n) * minorStep
                if t <= clip.duration + 0.0001 {
                    let major = n % 5 == 0
                    Rectangle().fill(Color.secondary.opacity(major ? 0.7 : 0.35)).frame(width: 1, height: major ? 10 : 5)
                        .offset(x: t * pps, y: rowHeight - 3 - (major ? 10 : 5))
                    if major { Text(String(format: "%g", (t * 1000).rounded() / 1000)).font(.system(size: 9)).foregroundStyle(.secondary).offset(x: t * pps + 3, y: 1) }
                }
            }
            Rectangle().fill(Color.accentColor.opacity(0.35)).frame(width: clip.duration * pps, height: 2).offset(y: rowHeight - 2)
        }
        .frame(width: width, height: rowHeight)
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 0).onChanged { anim.pause(); anim.scrub(to: $0.location.x / pps) })
    }

    private func eventRow(_ clip: AnimClip, width: CGFloat, pps: Double) -> some View {
        ZStack(alignment: .topLeading) {
            Color.clear
            ForEach(Array(clip.events.enumerated()), id: \.element.id) { i, e in
                Image(systemName: "flag.fill").font(.caption2)
                    .foregroundStyle(anim.selection == .event(i) ? Color.accentColor : Color.orange)
                    .offset(x: e.t * pps - 4, y: 5)
                    .onTapGesture { anim.selection = .event(i); panelFocus = true }
                    .help("\(e.name) @ \(String(format: "%.2f", e.t))s")
            }
        }
        .frame(width: width, height: rowHeight)
    }

    /// The track's value at the playhead, so you can read what the animation is doing right now.
    @ViewBuilder
    private func liveValue(_ track: AnimTrack, _ clip: AnimClip) -> some View {
        switch clip.value(track.path, at: anim.time) {
        case .num(let d)?:
            Text(String(format: "%.4g", d)).font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary)
        case .color(let hex)?:
            RoundedRectangle(cornerRadius: 3).fill(ColorField.parse(hex) ?? .clear).frame(width: 18, height: 12)
                .overlay(RoundedRectangle(cornerRadius: 3).stroke(.secondary.opacity(0.6)))
        case nil: EmptyView()
        }
    }

    private func trackLabel(_ i: Int, _ track: AnimTrack, _ clip: AnimClip) -> some View {
        let label = anim.properties.first { $0.path == track.path }?.label ?? track.path
        return HStack(spacing: 4) {
            Text(label).font(.caption).lineLimit(1).truncationMode(.middle)
            liveValue(track, clip)
            if Set(track.keys.map(\.v)).count <= 1 {
                Image(systemName: "exclamationmark.triangle.fill").font(.caption2).foregroundStyle(.orange)
                    .help(track.keys.count < 2 ? "Only one key: add another at a different time with a different value, or nothing changes." : "Every key has the same value, so nothing changes. Edit one key's value.")
            }
            Spacer(minLength: 0)
            Button { anim.addKey(track: i) } label: { Image(systemName: "diamond") }.buttonStyle(.borderless).help("Add a key at the playhead")
            Button { anim.removeTrack(i) } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).help("Remove this track")
        }
        .controlSize(.small)
        .padding(.horizontal, 8)
        .frame(height: rowHeight)
    }

    private func trackRow(_ i: Int, _ track: AnimTrack, _ clip: AnimClip, width: CGFloat, pps: Double) -> some View {
        ZStack(alignment: .topLeading) {
            Rectangle().fill(i % 2 == 0 ? Color.secondary.opacity(0.05) : Color.clear)
            ForEach(Array(track.keys.enumerated()), id: \.element.id) { k, key in
                KeyDiamond(selected: anim.selection == .key(track: i, key: k), color: key.v)
                    .offset(x: key.t * pps - 6, y: (rowHeight - 12) / 2)
                    .gesture(DragGesture(minimumDistance: 2, coordinateSpace: .named("timeline\(i)"))
                        .onChanged { g in anim.selection = .key(track: i, key: k); panelFocus = true; anim.moveKey(track: i, key: k, to: g.location.x / pps) })
                    .onTapGesture { anim.selection = .key(track: i, key: k); anim.scrub(to: key.t); panelFocus = true }
            }
        }
        .coordinateSpace(name: "timeline\(i)")
        .frame(width: width, height: rowHeight)
    }

    // MARK: Selected key / event

    @ViewBuilder
    private func detail(_ clip: AnimClip) -> some View {
        HStack(spacing: 10) {
            switch anim.selection {
            case .key(let t, let k):
                if t < clip.tracks.count, k < clip.tracks[t].keys.count {
                    let key = clip.tracks[t].keys[k]
                    Text("Key").font(.caption.weight(.semibold))
                    Text("Time").font(.caption)
                    LiveNumberField(value: key.t) { v in anim.moveKey(track: t, key: k, to: v) }.frame(width: 60)
                    Text("Key value").font(.caption)
                    switch key.v {
                    case .num(let d): LiveNumberField(value: d) { v in anim.updateKey(track: t, key: k) { $0.v = .num(v) } }.frame(width: 80)
                    case .color(let hex): ColorField(hex: Binding(get: { hex }, set: { h in anim.updateKey(track: t, key: k) { $0.v = .color(h) } })).frame(width: 120)
                    }
                    Text("Easing to next").font(.caption)
                    Picker("", selection: Binding(get: { key.ease }, set: { e in anim.updateKey(track: t, key: k) { $0.ease = e } })) {
                        ForEach(animationEasings, id: \.self) { Text($0).tag($0) }
                    }.labelsHidden().frame(width: 110)
                }
            case .event(let i):
                if i < clip.events.count {
                    let e = clip.events[i]
                    Text("Event").font(.caption.weight(.semibold))
                    Text("Time").font(.caption)
                    LiveNumberField(value: e.t) { v in anim.mutateClip { if i < $0.events.count { $0.events[i].t = min(max(0, v), $0.duration) } } }.frame(width: 60)
                    Text("Name").font(.caption)
                    RenameField(name: e.name) { n in anim.mutateClip { if i < $0.events.count { $0.events[i].name = n } } }.frame(width: 140)
                    Text("→ entity.onAnimationEvent(name)").font(.caption2).foregroundStyle(.secondary)
                }
            case nil: EmptyView()
            }
            Spacer()
            Button(role: .destructive) { anim.deleteSelection() } label: { Label("Delete", systemImage: "trash") }
        }
        .controlSize(.small)
        .padding(.horizontal, 8).padding(.vertical, 5)
    }
}

private struct KeyDiamond: View {
    let selected: Bool
    let color: AnimValue
    var body: some View {
        Rectangle()
            .fill(fill)
            .frame(width: 10, height: 10)
            .rotationEffect(.degrees(45))
            .overlay(Rectangle().stroke(selected ? Color.white : Color.black.opacity(0.5), lineWidth: selected ? 2 : 1).rotationEffect(.degrees(45)))
            .frame(width: 12, height: 12)
            .contentShape(Rectangle())
    }
    private var fill: Color {
        if case .color(let hex) = color, let c = ColorField.parse(hex) { return c }
        return selected ? .accentColor : .yellow
    }
}

/// A text field that applies its value on Return or when it loses focus (names must not change per keystroke).
struct RenameField: View {
    let name: String
    let commit: (String) -> Void
    @State private var text = ""
    @FocusState private var focused: Bool
    var body: some View {
        TextField("", text: $text)
            .textFieldStyle(.roundedBorder)
            .focused($focused)
            .onAppear { text = name }
            .onChange(of: name) { _, new in if !focused { text = new } }
            .onSubmit { commit(text) }
            .onChange(of: focused) { _, now in if !now { commit(text) } }
    }
}
