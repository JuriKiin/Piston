import SwiftUI
import AppKit

/// Piston's brand: one colour plus white. The geometry matches Tools/branding/make_icon.py (the app icon and the exported marks).
enum Brand {
    static let orange = Color(red: 1.0, green: 0x5A / 255, blue: 0x1F / 255)      // #FF5A1F
    static let ink = Color(red: 0x0E / 255, green: 0x10 / 255, blue: 0x14 / 255)  // splash / dark panels

    /// The app version, read from Info.plist (bundle.sh sets it: one place). `swift run` builds have no plist value.
    static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev" }
}

/// The piston glyph: a cylinder open at the top (a U), a head inside it, and a rod with a cap. Fits its rect (aspect 56:80).
struct PistonMark: Shape {
    func path(in rect: CGRect) -> Path {
        let k = min(rect.width / 56, rect.height / 80)
        let ox = rect.midX - 28 * k, oy = rect.midY - 40 * k
        func r(_ x0: CGFloat, _ y0: CGFloat, _ x1: CGFloat, _ y1: CGFloat, _ rad: CGFloat) -> Path {
            Path(roundedRect: CGRect(x: ox + (x0 - 22) * k, y: oy + (y0 - 12) * k, width: (x1 - x0) * k, height: (y1 - y0) * k), cornerRadius: rad * k)
        }
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + (x - 22) * k, y: oy + (y - 12) * k) }
        var p = Path()
        // U: walls 8 wide, round bottom
        p.move(to: pt(22, 38)); p.addLine(to: pt(30, 38)); p.addLine(to: pt(30, 78))
        p.addQuadCurve(to: pt(36, 84), control: pt(30, 84)); p.addLine(to: pt(64, 84))
        p.addQuadCurve(to: pt(70, 78), control: pt(70, 84)); p.addLine(to: pt(70, 38)); p.addLine(to: pt(78, 38))
        p.addLine(to: pt(78, 79)); p.addQuadCurve(to: pt(65, 92), control: pt(78, 92)); p.addLine(to: pt(35, 92))
        p.addQuadCurve(to: pt(22, 79), control: pt(22, 92)); p.closeSubpath()
        p.addPath(r(34, 54, 66, 70, 3))      // head
        p.addPath(r(46, 20, 54, 56, 0))      // rod
        p.addPath(r(38, 12, 62, 21, 4.5))    // cap
        return p
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
