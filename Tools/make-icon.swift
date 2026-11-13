// Generates Piston's app icon: `swiftc -O Tools/make-icon.swift -o /tmp/make-icon && /tmp/make-icon Resources`
// Writes Resources/Piston.iconset/*.png and Resources/Piston.icns (via iconutil).
import AppKit
import CoreGraphics

func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: a)
}

func gradient(_ colors: [CGColor], _ locations: [CGFloat]? = nil) -> CGGradient {
    CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray, locations: locations)!
}

/// Draws the 1024×1024 icon artwork.
func drawIcon(_ ctx: CGContext) {
    let size: CGFloat = 1024
    // macOS icon grid: the squircle is 824 wide, centred, with room for a soft shadow.
    let rect = CGRect(x: 100, y: 100, width: 824, height: 824)
    let squircle = CGPath(roundedRect: rect, cornerWidth: 188, cornerHeight: 188, transform: nil)

    // Shadow under the tile
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -14), blur: 34, color: rgb(0x000000, 0.45))
    ctx.addPath(squircle)
    ctx.setFillColor(rgb(0x1A1D3A))
    ctx.fillPath()
    ctx.restoreGState()

    // Tile background
    ctx.saveGState()
    ctx.addPath(squircle)
    ctx.clip()
    ctx.drawLinearGradient(gradient([rgb(0x2A2F6E), rgb(0x1A1B3F), rgb(0x2B1655)], [0, 0.55, 1]),
                           start: CGPoint(x: 150, y: 924), end: CGPoint(x: 874, y: 100), options: [])
    // Soft glow behind the piston
    ctx.drawRadialGradient(gradient([rgb(0xFF8A3D, 0.55), rgb(0xFF8A3D, 0)]),
                           startCenter: CGPoint(x: 512, y: 400), startRadius: 0,
                           endCenter: CGPoint(x: 512, y: 400), endRadius: 360, options: [])
    ctx.restoreGState()

    // Cylinder (the bore): outer steel, inner dark
    let cylOuter = CGRect(x: 342, y: 210, width: 340, height: 520)
    let cylPath = CGPath(roundedRect: cylOuter, cornerWidth: 54, cornerHeight: 54, transform: nil)
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -10), blur: 22, color: rgb(0x000000, 0.4))
    ctx.addPath(cylPath)
    ctx.clip()
    ctx.drawLinearGradient(gradient([rgb(0xF4F6FF), rgb(0xA9B1D6), rgb(0xE9ECFF), rgb(0x8F98C4)], [0, 0.3, 0.6, 1]),
                           start: CGPoint(x: 342, y: 0), end: CGPoint(x: 682, y: 0), options: [])
    ctx.restoreGState()

    let bore = cylOuter.insetBy(dx: 26, dy: 26)
    let borePath = CGPath(roundedRect: bore, cornerWidth: 34, cornerHeight: 34, transform: nil)
    ctx.saveGState()
    ctx.addPath(borePath)
    ctx.clip()
    ctx.drawLinearGradient(gradient([rgb(0x0B0D22), rgb(0x1A1E44)]),
                           start: CGPoint(x: 0, y: bore.maxY), end: CGPoint(x: 0, y: bore.minY), options: [])

    // Rod from the head up through the top of the bore
    let rod = CGRect(x: 484, y: 420, width: 56, height: 330)
    ctx.addPath(CGPath(roundedRect: rod, cornerWidth: 16, cornerHeight: 16, transform: nil))
    ctx.clip()
    ctx.drawLinearGradient(gradient([rgb(0xFFFFFF), rgb(0xB5BCE0), rgb(0xFFFFFF)], [0, 0.5, 1]),
                           start: CGPoint(x: 484, y: 0), end: CGPoint(x: 540, y: 0), options: [])
    ctx.restoreGState()

    // Piston head (orange, with ring grooves)
    ctx.saveGState()
    ctx.addPath(borePath)
    ctx.clip()
    let head = CGRect(x: bore.minX + 10, y: 300, width: bore.width - 20, height: 150)
    let headPath = CGPath(roundedRect: head, cornerWidth: 26, cornerHeight: 26, transform: nil)
    ctx.setShadow(offset: CGSize(width: 0, height: -6), blur: 14, color: rgb(0x000000, 0.5))
    ctx.addPath(headPath)
    ctx.clip()
    ctx.drawLinearGradient(gradient([rgb(0xFFC15A), rgb(0xFF8A3D), rgb(0xE5502B)], [0, 0.55, 1]),
                           start: CGPoint(x: 0, y: head.maxY), end: CGPoint(x: 0, y: head.minY), options: [])
    ctx.restoreGState()

    ctx.saveGState()
    ctx.addPath(borePath)
    ctx.clip()
    for i in 0..<3 {
        let y = head.maxY - 42 - CGFloat(i) * 30
        ctx.setFillColor(rgb(0x8A2E12, 0.55))
        ctx.fill(CGRect(x: head.minX + 6, y: y, width: head.width - 12, height: 8))
        ctx.setFillColor(rgb(0xFFE2A8, 0.55))
        ctx.fill(CGRect(x: head.minX + 6, y: y + 8, width: head.width - 12, height: 3))
    }
    ctx.restoreGState()

    // Joint at the top of the rod
    let joint = CGRect(x: 512 - 58, y: 700, width: 116, height: 116)
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -6), blur: 14, color: rgb(0x000000, 0.45))
    ctx.setFillColor(rgb(0xFFFFFF))
    ctx.fillEllipse(in: joint)
    ctx.restoreGState()
    ctx.drawRadialGradient(gradient([rgb(0xFFC15A), rgb(0xFF6A3D)]),
                           startCenter: CGPoint(x: 512, y: 758), startRadius: 0,
                           endCenter: CGPoint(x: 512, y: 758), endRadius: 34, options: [])

    // Glass highlight across the top of the tile
    ctx.saveGState()
    ctx.addPath(squircle)
    ctx.clip()
    ctx.drawLinearGradient(gradient([rgb(0xFFFFFF, 0.20), rgb(0xFFFFFF, 0)]),
                           start: CGPoint(x: 0, y: 924), end: CGPoint(x: 0, y: 560), options: [])
    ctx.restoreGState()

    // Thin rim
    ctx.addPath(squircle)
    ctx.setStrokeColor(rgb(0xFFFFFF, 0.14))
    ctx.setLineWidth(3)
    ctx.strokePath()
    _ = size
}

func render(side: Int) -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side, bitsPerSample: 8, samplesPerPixel: 4,
                               hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    let gctx = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.current = gctx
    let ctx = gctx.cgContext
    ctx.scaleBy(x: CGFloat(side) / 1024, y: CGFloat(side) / 1024)
    ctx.interpolationQuality = .high
    drawIcon(ctx)
    NSGraphicsContext.current = nil
    return rep.representation(using: .png, properties: [:])!
}

let outDir = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ".")
let iconset = outDir.appendingPathComponent("Piston.iconset")
try? FileManager.default.removeItem(at: iconset)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)

let sizes: [(String, Int)] = [("icon_16x16", 16), ("icon_16x16@2x", 32), ("icon_32x32", 32), ("icon_32x32@2x", 64),
                              ("icon_128x128", 128), ("icon_128x128@2x", 256), ("icon_256x256", 256), ("icon_256x256@2x", 512),
                              ("icon_512x512", 512), ("icon_512x512@2x", 1024)]
for (name, px) in sizes {
    try render(side: px).write(to: iconset.appendingPathComponent("\(name).png"))
}
try render(side: 1024).write(to: outDir.appendingPathComponent("Piston-1024.png"))

let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
task.arguments = ["-c", "icns", iconset.path, "-o", outDir.appendingPathComponent("Piston.icns").path]
try task.run()
task.waitUntilExit()
print(task.terminationStatus == 0 ? "wrote Piston.icns" : "iconutil failed")
