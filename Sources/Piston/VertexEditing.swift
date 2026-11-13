import SwiftUI

/// Direct vertex editing for polygon entities (anything with a component that has a `vertices` array).
/// Vertices live in the component's own local space; this maps them to the viewport using the editor camera.
extension EditorModel {
    /// (component index, local vertices) for the selected entity, if it has an editable polygon.
    func polygonOfSelection() -> (key: String, comp: Int, verts: [CGPoint])? {
        guard let key = selection else { return nil }
        for (i, c) in components(key).enumerated() {
            guard let raw = (c["fields"] as? [String: Any])?["vertices"] as? [[String: Any]], raw.count >= 3 else { continue }
            let pts = raw.map { CGPoint(x: ($0["x"] as? NSNumber)?.doubleValue ?? 0, y: ($0["y"] as? NSNumber)?.doubleValue ?? 0) }
            return (key, i, pts)
        }
        return nil
    }

    /// Local vertex -> viewport point.
    func screenPoint(forLocal p: CGPoint, key: String) -> CGPoint {
        let t = transform(key), r = t.rotation * .pi / 180
        let wx = t.x + p.x * cos(r) - p.y * sin(r), wy = t.y + p.x * sin(r) + p.y * cos(r)
        return CGPoint(x: (wx - camera.x) * camera.zoom + viewportSize.width / 2, y: (wy - camera.y) * camera.zoom + viewportSize.height / 2)
    }

    private func localPoint(forScreen s: CGPoint, key: String, snapped: Bool) -> CGPoint {
        var wx = (s.x - viewportSize.width / 2) / camera.zoom + camera.x
        var wy = (s.y - viewportSize.height / 2) / camera.zoom + camera.y
        if snapped { wx = (wx / gridSize).rounded() * gridSize; wy = (wy / gridSize).rounded() * gridSize }
        let t = transform(key), r = -t.rotation * .pi / 180
        let dx = wx - t.x, dy = wy - t.y
        return CGPoint(x: dx * cos(r) - dy * sin(r), y: dx * sin(r) + dy * cos(r))
    }

    /// Hit-test vertex handles first, then edges (clicking an edge inserts a vertex and starts dragging it).
    /// Option-click on a vertex removes it (a polygon keeps at least 3).
    func vertexHit(at p: CGPoint) -> DragMode? {
        guard let poly = polygonOfSelection() else { return nil }
        let pts = poly.verts.map { screenPoint(forLocal: $0, key: poly.key) }
        for (i, sp) in pts.enumerated() where hypot(sp.x - p.x, sp.y - p.y) <= 9 {
            if NSEvent.modifierFlags.contains(.option), poly.verts.count > 3 {
                var v = poly.verts; v.remove(at: i)
                writeVertices(poly.key, poly.comp, v)
                return .idle
            }
            return .vertex(poly.key, comp: poly.comp, index: i)
        }
        for i in pts.indices {
            let a = pts[i], b = pts[(i + 1) % pts.count]
            let dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy
            guard len2 > 0 else { continue }
            let t = max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
            if hypot(a.x + t * dx - p.x, a.y + t * dy - p.y) <= 6 {
                var v = poly.verts
                v.insert(localPoint(forScreen: p, key: poly.key, snapped: false), at: i + 1)
                writeVertices(poly.key, poly.comp, v)
                return .vertex(poly.key, comp: poly.comp, index: i + 1)
            }
        }
        return nil
    }

    func moveVertex(_ key: String, _ comp: Int, _ index: Int, to screen: CGPoint) {
        guard let poly = polygonOfSelection(), poly.key == key, index < poly.verts.count else { return }
        var v = poly.verts
        v[index] = localPoint(forScreen: screen, key: key, snapped: snapEnabled != NSEvent.modifierFlags.contains(.option))
        writeVertices(key, comp, v)
    }

    private func writeVertices(_ key: String, _ comp: Int, _ verts: [CGPoint]) {
        setComponentField(key, comp, "vertices", verts.map { ["x": $0.x, "y": $0.y] })
    }
}

struct VertexOverlay: View {
    @ObservedObject var model: EditorModel

    var body: some View {
        Canvas { ctx, _ in
            guard model.vertexEditing, let poly = model.polygonOfSelection() else { return }
            let pts = poly.verts.map { model.screenPoint(forLocal: $0, key: poly.key) }
            var path = Path()
            path.addLines(pts); path.closeSubpath()
            ctx.stroke(path, with: .color(.orange), lineWidth: 1.5)
            for p in pts {
                let r = CGRect(x: p.x - 5, y: p.y - 5, width: 10, height: 10)
                ctx.fill(Path(ellipseIn: r), with: .color(.white))
                ctx.stroke(Path(ellipseIn: r), with: .color(.orange), lineWidth: 1.5)
            }
        }
    }
}

/// The area the player will see: the design resolution centred on the scene's main camera (from project.piston.json "resolution").
struct GameFrameOverlay: View {
    @ObservedObject var model: EditorModel

    var body: some View {
        Canvas { ctx, size in
            guard model.showGameFrame else { return }
            let cam = (model.doc["entities"] as? [[String: Any]])?.first { ($0["tag"] as? String) == "MainCamera" }
            let t = cam?["transform"] as? [String: Any]
            let p = t?["position"] as? [String: Any]
            let cx = (p?["x"] as? NSNumber)?.doubleValue ?? model.gameResolution.width / 2
            let cy = (p?["y"] as? NSNumber)?.doubleValue ?? model.gameResolution.height / 2
            let zoom = (((cam?["components"] as? [[String: Any]])?.first { ($0["type"] as? String) == "Camera" }?["fields"] as? [String: Any])?["zoom"] as? NSNumber)?.doubleValue ?? 1
            let w = model.gameResolution.width / max(zoom, 0.01), h = model.gameResolution.height / max(zoom, 0.01)
            let s = model.camera.zoom
            let rect = CGRect(x: (cx - w / 2 - model.camera.x) * s + size.width / 2, y: (cy - h / 2 - model.camera.y) * s + size.height / 2,
                              width: w * s, height: h * s)
            var outside = Path(CGRect(origin: .zero, size: size)); outside.addRect(rect)
            ctx.fill(outside, with: .color(.black.opacity(0.25)), style: FillStyle(eoFill: true))
            ctx.stroke(Path(rect), with: .color(.green), style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]))
        }
    }
}
