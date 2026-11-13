import SwiftUI
import AppKit

/// Piston's brand: one colour plus white. The geometry matches Tools/branding/make_icon.py (the app icon and the exported marks).
enum Brand {
    static let orange = Color(red: 1.0, green: 0x5A / 255, blue: 0x1F / 255)      // #FF5A1F
    static let ink = Color(red: 0x0E / 255, green: 0x10 / 255, blue: 0x14 / 255)  // splash / dark panels

    /// The app version, read from Info.plist (bundle.sh sets it: one place). `swift run` builds have no plist value.
    static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev" }
}

/// Files that ship inside the app bundle (bundle.sh copies Resources/branding and LICENSE). Nil when running unbundled.
enum BrandResources {
    static func image(_ name: String) -> NSImage? {
        Bundle.main.resourceURL.flatMap { NSImage(contentsOf: $0.appendingPathComponent("branding/\(name)")) }
    }
    static var license: String {
        Bundle.main.resourceURL.flatMap { try? String(contentsOf: $0.appendingPathComponent("LICENSE"), encoding: .utf8) }
            ?? "Piston is released under the MIT License. See the LICENSE file in the repository."
    }
}

/// The license text, shown from the Hub footer.
struct LicenseSheet: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("MIT License").font(.headline)
            ScrollView { Text(BrandResources.license).font(.system(.callout, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
            HStack { Spacer(); Button("Done") { dismiss() }.keyboardShortcut(.defaultAction) }
        }
        .padding(20).frame(width: 560, height: 420)
    }
}

/// The piston mark: a piston tilted 38° clockwise. Geometry is upright in a 1024 frame, rotated about (512, 512) and fitted to the rect;
/// it matches Tools/branding/make_icon.py (the app icon and exported marks). `PistonMark` is the cylinder, rod and cap (fill it orange);
/// `PistonHead` is the head inside the cylinder (fill it cream). Both fit the same rect, so stack them: see `PistonLogo`.
enum PistonGeometry {
    static let box = CGRect(x: 182, y: 167, width: 634, height: 690)    // bounds of the tilted glyph, 1024 frame
    static let tilt = Double.pi * 38 / 180

    static func transform(in rect: CGRect) -> CGAffineTransform {
        let k = min(rect.width / box.width, rect.height / box.height)
        return CGAffineTransform.identity
            .translatedBy(x: rect.midX, y: rect.midY)
            .scaledBy(x: k, y: k)
            .translatedBy(x: -box.midX, y: -box.midY)
            .translatedBy(x: 512, y: 512)
            .rotated(by: tilt)
            .translatedBy(x: -512, y: -512)
    }
}

struct PistonMark: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        // U: outer 290..734 x 400..820 (bottom corners r93), inner cut 350..674 to 760 (r68), open at the top
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: y) }
        p.move(to: pt(290, 400)); p.addLine(to: pt(350, 400))
        p.addArc(tangent1End: pt(350, 760), tangent2End: pt(674, 760), radius: 68)      // inner bottom-left
        p.addArc(tangent1End: pt(674, 760), tangent2End: pt(674, 400), radius: 68)      // inner bottom-right
        p.addLine(to: pt(674, 400)); p.addLine(to: pt(734, 400))
        p.addArc(tangent1End: pt(734, 820), tangent2End: pt(290, 820), radius: 93)      // outer bottom-right
        p.addArc(tangent1End: pt(290, 820), tangent2End: pt(290, 400), radius: 93)      // outer bottom-left
        p.closeSubpath()
        p.addRect(CGRect(x: 484, y: 150, width: 56, height: 380))                                     // rod
        p.addRoundedRect(in: CGRect(x: 392, y: 150, width: 240, height: 80), cornerSize: CGSize(width: 40, height: 40))   // cap
        return p.applying(PistonGeometry.transform(in: rect))
    }
}

struct PistonHead: Shape {
    func path(in rect: CGRect) -> Path {
        Path(roundedRect: CGRect(x: 392, y: 520, width: 240, height: 120), cornerRadius: 22).applying(PistonGeometry.transform(in: rect))
    }
}

/// The full mark in brand colours: orange body, cream head.
struct PistonLogo: View {
    static let cream = Color(red: 1.0, green: 0xF4 / 255, blue: 0xD6 / 255)    // #FFF4D6
    var body: some View {
        ZStack {
            PistonMark().fill(Brand.orange)
            PistonHead().fill(Self.cream)
        }
    }
}

/// The launch splash: a press comes down from above the window, pushing the word "Piston" in until it is centred, then draws back
/// and the whole thing fades into the Hub. Purely a view over the window content: nothing waits for it, and a click skips it.
struct PistonSplash: View {
    var fixedTime: Double? = nil        // render one frame (debug stills); nil = play in real time
    var onDone: () -> Void = {}
    @State private var start = Date()
    @State private var finished = false

    static let duration = 1.95

    /// Splash only for an ordinary launch: command-line modes and the developer shortcuts that open a project straight away skip it.
    static var enabled: Bool {
        let args = ProcessInfo.processInfo.arguments
        if !Set(args).isDisjoint(with: ["--selftest", "--build", "--serve", "--project", "--sample", "--play"]) { return false }
        let env = ProcessInfo.processInfo.environment
        return env["PISTON_NO_SPLASH"] == nil && env["PISTON_SHOT"] == nil
    }

    private func clamp(_ x: Double) -> Double { min(max(x, 0), 1) }
    private func easeOutBack(_ x: Double) -> Double { let c1 = 0.9, c3 = c1 + 1; return 1 + c3 * pow(x - 1, 3) + c1 * pow(x - 1, 2) }
    private func easeInCubic(_ x: Double) -> Double { x * x * x }

    var body: some View {
        TimelineView(.animation(minimumInterval: nil, paused: fixedTime != nil)) { ctx in
            let t = fixedTime ?? ctx.date.timeIntervalSince(start)
            frame(t)
                .onChange(of: t >= Self.duration) { _, over in if over { finish() } }
        }
        .contentShape(Rectangle())
        .onTapGesture { finish() }
    }

    private func finish() { if !finished && fixedTime == nil { finished = true; onDone() } }

    private func frame(_ t: Double) -> some View {
        GeometryReader { geo in
            let cy = geo.size.height / 2, cx = geo.size.width / 2
            let wordH = 96.0, gap = 4.0, plateH = 20.0
            let push = easeOutBack(clamp(t / 0.85))
            let wordY = -wordH + (cy + wordH) * push                       // centre of the word
            let retract = easeInCubic(clamp((t - 0.95) / 0.4))
            let plateY = wordY - wordH / 2 - gap - plateH / 2 - retract * (cy + 160)
            let settle = sin(Double.pi * clamp((t - 0.8) / 0.35))
            let fade = 1 - clamp((t - 1.55) / 0.4)
            ZStack {
                Brand.ink
                Rectangle().fill(Brand.orange).frame(width: 16, height: max(0, plateY + 20)).position(x: cx, y: (plateY - 20) / 2)
                RoundedRectangle(cornerRadius: 6).fill(Brand.orange).frame(width: 330, height: plateH).position(x: cx, y: plateY)
                Text("Piston")
                    .font(.system(size: 84, weight: .heavy))
                    .tracking(-1.5)
                    .foregroundStyle(.white)
                    .scaleEffect(1 + 0.03 * settle)
                    .position(x: cx, y: wordY)
            }
            .clipped()
            .opacity(fade)
        }
    }
}

/// Debug aid: `PISTON_BRAND_SHOT=<dir> Piston --selftest-free launch` renders splash frames and the Hub to PNGs, then exits.
@MainActor
enum BrandShots {
    static func run(model: EditorModel, dir: String) async {
        let out = URL(fileURLWithPath: dir)
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        func shot<V: View>(_ view: V, _ size: NSSize, _ name: String) async {
            let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .fullSizeContentView], backing: .buffered, defer: false)
            let host = NSHostingView(rootView: view.frame(width: size.width, height: size.height))
            window.contentView = host
            window.setFrame(NSRect(origin: .zero, size: size), display: true)
            window.orderBack(nil)
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            host.layoutSubtreeIfNeeded()
            if let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) {
                host.cacheDisplay(in: host.bounds, to: rep)
                try? rep.representation(using: .png, properties: [:])?.write(to: out.appendingPathComponent(name))
            }
            window.orderOut(nil)
        }
        for t in [0.2, 0.45, 0.8, 1.2, 1.5, 1.75] {
            await shot(PistonSplash(fixedTime: t), NSSize(width: 900, height: 560), "splash-\(Int(t * 100)).png")
        }
        await shot(HubView(model: model), NSSize(width: 1100, height: 700), "hub.png")
    }
}

/// Buttons for the dark brand panel: a solid orange primary, a quiet outlined secondary, and a text link.
struct BrandButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, link(Color) }
    var kind: Kind
    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        switch kind {
        case .primary:
            configuration.label.font(.body.weight(.semibold)).foregroundStyle(.white)
                .padding(.vertical, 9).frame(maxWidth: .infinity)
                .background(RoundedRectangle(cornerRadius: 8).fill(Brand.orange.opacity(pressed ? 0.8 : 1)))
        case .secondary:
            configuration.label.font(.body).foregroundStyle(.white)
                .padding(.vertical, 9).frame(maxWidth: .infinity)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(pressed ? 0.16 : 0.09)))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.white.opacity(0.14)))
        case .link(let c):
            configuration.label.foregroundStyle(c.opacity(pressed ? 0.6 : 1))
        }
    }
}
