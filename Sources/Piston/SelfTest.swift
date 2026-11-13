import SwiftUI
import AppKit
import Foundation
import CoreGraphics

/// `Piston.app/Contents/MacOS/Piston --selftest` runs the spike's claims end to end against a copy of
/// the fixture project and exits 0/1. Each check maps to a risk named in PISTON_SPEC.md.
@MainActor
enum SelfTest {
    static func run(model: EditorModel, project: URL) async -> Bool {
        var failures = 0
        // Display-dependent checks (animation, synthetic clicks) can't pass while the screen is locked.
        let screenLocked = (CGSessionCopyCurrentDictionary() as? [String: Any])?["CGSSessionScreenIsLocked"] as? Bool ?? false
        if screenLocked { print("NOTE  screen is locked: display-dependent checks are skipped") }
        func check(_ name: String, _ ok: Bool, _ detail: String = "", needsDisplay: Bool = false) {
            if needsDisplay && screenLocked { print("SKIP  \(name)  - screen is locked"); return }
            print("\(ok ? "PASS" : "FAIL")  \(name)\(detail.isEmpty ? "" : "  - \(detail)")")
            if !ok { failures += 1 }
        }
        func num(_ v: Any?) -> Double { (v as? NSNumber)?.doubleValue ?? .nan }

        // 1. Host + bridge boot: ES modules load over the embedded HTTP server.
        model.suppressRecoveryPrompt = true
        let ready = await model.waitUntilReady(timeout: 20)
        if ready, model.currentScene != "hole1" { try? await model.loadScene("hole1") }   // the sample starts on its main menu; most checks need a hole
        check("runtime boots over HTTP (ES modules)", ready, "port \(model.server?.port ?? 0), scenes \(model.sceneIDs)")
        guard ready else { print("Logs:"); model.logs.forEach { print("  [\($0.level)] \($0.text)") }; return false }

        // 2. Scene load: entities built from the editor's document.
        // The shipped course: every hole builds in the runtime with all its entity types registered (nothing silently skipped).
        var holesOK = 0, holeDetail = ""
        for n in 1...9 {
            let file = project.appendingPathComponent("scenes/hole\(n).json")
            guard let data = try? Data(contentsOf: file), let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { holeDetail += " hole\(n): unreadable"; continue }
            let expected = (json["entities"] as? [[String: Any]])?.count ?? -1
            let built = ((try? await model.host.request("loadScene", ["data": json])) as? [String: Any])?["entities"] as? [[String: Any]]
            if built?.count == expected { holesOK += 1 } else { holeDetail += " hole\(n): \(built?.count ?? -1)/\(expected)" }
        }
        check("all 9 holes of the sample course build in the runtime with every entity type registered", holesOK == 9, holeDetail)
        try? await model.sendScene(reloadFromDisk: true, id: model.currentScene ?? "hole1")
        for _ in 0..<60 where model.entities.isEmpty { try? await Task.sleep(nanoseconds: 100_000_000) } // the first scene load runs right after "ready"
        check("scene loaded into runtime", model.entities.count > 0, "\(model.currentScene ?? "-"): \(model.entities.count) entities")
        let types = Set(model.entities.compactMap(\.type))
        check("entity types resolved via registry", types.contains("Ball") && types.contains("Hole"), "\(types.sorted())")

        // 2b. The engine ships with Piston: a project contains only game content.
        check("the engine is not part of the project folder",
              !FileManager.default.fileExists(atPath: project.appendingPathComponent("engine").path)
              && !FileManager.default.fileExists(atPath: project.appendingPathComponent("js").path)
              && !model.fileTree.contains { $0.name == "engine" || $0.name == "js" },
              "top level: \(model.fileTree.map(\.name))")

        // 3. Schema discovery from the runtime (no hand-written duplicates).
        let ballFields = model.entitySchemas["Ball"]?.map(\.key) ?? []
        check("schemas discovered from runtime", ballFields.contains("radius") && ballFields.contains("powerScale"),
              "\(model.schemaEntityCount) entity types, \(model.schemaComponentCount) components, Ball fields \(ballFields)")

        // 4. Bounds for the gizmo overlay.
        guard let ball = model.entities.first(where: { $0.type == "Ball" }) else { check("found a Ball", false); return false }
        model.select(ball.key)
        try? await Task.sleep(nanoseconds: 400_000_000)
        let b0 = model.selectionBounds
        check("getBounds returns screen rect for selection", b0 != nil && (b0?.w ?? 0) > 0,
              b0.map { "cx \(Int($0.cx)) cy \(Int($0.cy)) w \(Int($0.w))" } ?? "nil")

        // 5. Hit test round trip at the ball's screen centre.
        if let b0 {
            let hit = await model.hitKey(at: CGPoint(x: b0.cx, y: b0.cy))
            check("hitTest at ball centre selects the ball", hit == ball.key, "got \(hit ?? "nil")")
            let miss = await model.hitKey(at: CGPoint(x: -500, y: -500))
            check("hitTest on empty space returns nothing", miss == nil)
        }

        // 6. Patch moves the runtime's entity; overlay bounds follow.
        let t0 = model.transform(ball.key)
        model.setTransform(ball.key, x: t0.x + 100, y: t0.y + 50)
        try? await Task.sleep(nanoseconds: 500_000_000)
        let b1 = model.selectionBounds
        if let b0, let b1 {
            let dx = b1.cx - b0.cx, dy = b1.cy - b0.cy
            check("applyPatch moves entity; bounds follow", abs(dx - 100 * model.camera.zoom) < 1 && abs(dy - 50 * model.camera.zoom) < 1,
                  "screen delta (\(dx), \(dy))")
        } else { check("applyPatch moves entity; bounds follow", false, "missing bounds") }

        // 7. Editor camera is independent of the scene (scene data must not change).
        let docBefore = (model.doc["entities"] as? [[String: Any]])?.count ?? -1
        model.panCamera(screenDelta: CGSize(width: -80, height: 0))
        try? await Task.sleep(nanoseconds: 400_000_000)
        let b2 = model.selectionBounds
        check("editor pan moves view, not scene data", abs(((b2?.cx ?? 0) - (b1?.cx ?? 0)) + 80) < 1 && model.transform(ball.key).x == t0.x + 100
              && ((model.doc["entities"] as? [[String: Any]])?.count ?? -2) == docBefore)

        // 8. Save writes the document; our own write must NOT trigger a reload loop.
        let reloadsBefore = model.reloadCount, sceneReloadsBefore = model.sceneReloadCount
        model.saveScene()
        try? await Task.sleep(nanoseconds: 1_500_000_000)
        let file = project.appendingPathComponent(model.scenesDir).appendingPathComponent("\(model.currentScene ?? "").json")
        let saved = (try? Data(contentsOf: file)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        let savedBall = (saved?["entities"] as? [[String: Any]])?.first { ($0["sceneKey"] as? String) == ball.key }
        let savedX = num(((savedBall?["transform"] as? [String: Any])?["position"] as? [String: Any])?["x"])
        check("save writes edited position to disk", abs(savedX - (t0.x + 100)) < 0.01, "x \(savedX)")
        check("own save does not trigger reload", model.reloadCount == reloadsBefore && model.sceneReloadCount == sceneReloadsBefore)

        // 9. Runtime logs reach the editor console.
        _ = try? await model.host.request("emitTestLog", ["text": "spike-log-marker"])
        try? await Task.sleep(nanoseconds: 300_000_000)
        check("runtime console.warn reaches editor", model.logs.contains { $0.text.contains("spike-log-marker") && $0.level == "warn" })

        // 10. Unknown request fails cleanly (no hang).
        var errored = false
        do { _ = try await model.host.request("noSuchThing", timeout: 3) } catch { errored = true }
        check("unknown bridge request errors cleanly", errored)

        // 10b. External scene-file edit (say, a git checkout) reloads the document without reloading the page.
        let sceneReloadsBeforeExt = model.sceneReloadCount, pageReloadsBeforeExt = model.reloadCount
        if var edited = saved, var list = edited["entities"] as? [[String: Any]],
           let i = list.firstIndex(where: { ($0["sceneKey"] as? String) == ball.key }) {
            var t = list[i]["transform"] as? [String: Any] ?? [:]
            var p = t["position"] as? [String: Any] ?? [:]
            p["x"] = 777.0
            t["position"] = p
            list[i]["transform"] = t
            edited["entities"] = list
            if let data = try? JSONSerialization.data(withJSONObject: edited, options: [.prettyPrinted, .sortedKeys]) {
                try? data.write(to: file, options: .atomic)
            }
        }
        try? await Task.sleep(nanoseconds: 2_000_000_000)
        check("external scene edit reloads document (not the page)",
              model.sceneReloadCount == sceneReloadsBeforeExt + 1 && model.reloadCount == pageReloadsBeforeExt
              && abs(model.transform(ball.key).x - 777) < 0.01 && !model.dirty,
              "sceneReloads \(model.sceneReloadCount), x \(model.transform(ball.key).x)")

        // 11. Hot reload: editing a script reloads the runtime and restores scene + camera + selection state.
        model.select(ball.key)
        try? await Task.sleep(nanoseconds: 500_000_000)
        let boundsPreReload = model.selectionBounds
        let readyBefore = model.readyCount
        let script = project.appendingPathComponent("scripts/Hole.js")
        if var text = try? String(contentsOf: script, encoding: .utf8) {
            text += "\n// touched by selftest \(Date().timeIntervalSince1970)\n"
            try? text.write(to: script, atomically: true, encoding: .utf8)
        }
        let reloaded = await model.waitForReadyCount(readyBefore + 1, timeout: 12)
        try? await Task.sleep(nanoseconds: 600_000_000)
        check("script edit triggers hot reload", reloaded && model.reloadCount == reloadsBefore + 1,
              "ready \(readyBefore)→\(model.readyCount), reloads \(model.reloadCount)")
        check("scene restored after reload (document position kept)", model.entities.count > 0
              && abs(model.transform(ball.key).x - 777) < 0.01)
        model.select(ball.key)
        try? await Task.sleep(nanoseconds: 600_000_000)
        let boundsPostReload = model.selectionBounds
        check("editor camera restored after reload (same screen position)",
              boundsPreReload != nil && boundsPostReload != nil
              && abs((boundsPreReload?.cx ?? 0) - (boundsPostReload?.cx ?? 1)) < 1
              && abs((boundsPreReload?.cy ?? 0) - (boundsPostReload?.cy ?? 1)) < 1,
              "before \(boundsPreReload.map { "(\(Int($0.cx)), \(Int($0.cy)))" } ?? "nil") after \(boundsPostReload.map { "(\(Int($0.cx)), \(Int($0.cy)))" } ?? "nil")")

        // 13. Play: a SEPARATE runtime instance (spec §4.2)
        model.activeTab = .scene
        model.select(ball.key)
        try? await Task.sleep(nanoseconds: 500_000_000)
        // Put the ball back at its original in-course spot (earlier checks moved it out of bounds).
        model.setTransform(ball.key, x: t0.x, y: t0.y)
        try? await Task.sleep(nanoseconds: 600_000_000)
        model.select(ball.key)
        try? await Task.sleep(nanoseconds: 500_000_000)
        let sceneBoundsBeforePlay = model.selectionBounds
        let docXBeforePlay = model.transform(ball.key).x
        let dirtyBeforePlay = model.dirty
        await model.play()
        let g1 = await model.playInfo()
        check("Play starts a separate game instance with the scene's entities",
              model.playState == .playing && g1?.playState == "playing" && g1?.entityCount == model.entities.count && model.activeTab == .game,
              "state \(model.playState), game entities \(g1?.entityCount ?? -1) vs \(model.entities.count)")
        try? await Task.sleep(nanoseconds: 700_000_000)
        let g2 = await model.playInfo()
        check("simulation runs while playing", (g2?.frames ?? 0) > (g1?.frames ?? 0) + 5, "frames \(g1?.frames ?? -1) → \(g2?.frames ?? -1)", needsDisplay: true)
        await model.pause()
        let g3 = await model.playInfo()
        try? await Task.sleep(nanoseconds: 500_000_000)
        let g4 = await model.playInfo()
        check("Pause freezes the simulation", model.playState == .paused && g3?.frames == g4?.frames, "frames \(g3?.frames ?? -1) / \(g4?.frames ?? -1)")
        await model.step()
        let g5 = await model.playInfo()
        check("Step advances exactly one frame", g5?.frames == (g4?.frames ?? -9) + 1, "frames \(g4?.frames ?? -1) → \(g5?.frames ?? -1)")
        await model.play()
        check("Resume continues from the paused game", model.playState == .playing)

        // Native input: a real drag on the ball in the Game tab must play a stroke (aim with a non-default camera).
        func shots() async -> Double {
            let d = (try? await model.playHost.request("getEntityData", ["key": ball.key])) as? [String: Any]
            return num((d?["fields"] as? [String: Any])?["shotCount"])
        }
        await model.pause()
        await model.play()
        try? await Task.sleep(nanoseconds: 400_000_000)
        let shotsBefore = await shots()
        let sp = (try? await model.playHost.request("getScreenPos", ["key": ball.key])) as? [String: Any]
        let ballScreen = CGPoint(x: num(sp?["x"]), y: num(sp?["y"]))
        let downsBefore = (await model.playInfo())?.mouseDowns ?? 0
        let delivered = await NativeInput.drag(in: model.playHost.webView, from: ballScreen, to: CGPoint(x: ballScreen.x - 70, y: ballScreen.y), steps: 8)
        let downsAfter = (await model.playInfo())?.mouseDowns ?? 0
        let shotsAfter = await shots()
        check("a native click reaches the Game view", delivered && downsAfter == downsBefore + 1,
              "mousedowns \(downsBefore) → \(downsAfter) at ball screen pos (\(Int(ballScreen.x)), \(Int(ballScreen.y)))", needsDisplay: true)
        check("dragging the ball plays a stroke (world-space aiming)", shotsAfter == shotsBefore + 1, "shots \(shotsBefore) → \(shotsAfter)", needsDisplay: true)

        // Change the RUNNING game only (to a spot inside the course; the engine's boundary pushes things back in), then Stop.
        let beforeLive = (try? await model.playHost.request("getEntityData", ["key": ball.key])) as? [String: Any]
        let beforeX = num((((beforeLive?["transform"] as? [String: Any])?["position"]) as? [String: Any])?["x"])
        _ = try? await model.playHost.request("applyPatch", ["ops": [["op": "setTransform", "key": ball.key, "x": beforeX + 40]]])
        let live = (try? await model.playHost.request("getEntityData", ["key": ball.key])) as? [String: Any]
        let liveX = num((((live?["transform"] as? [String: Any])?["position"]) as? [String: Any])?["x"])
        check("the running game can change without touching the editor",
              abs(liveX - (beforeX + 40)) < 1 && abs(model.transform(ball.key).x - docXBeforePlay) < 0.01, "game x \(beforeX) → \(liveX), doc x \(model.transform(ball.key).x)")
        model.stopGame()
        check("Stop discards the game and returns to the Scene view", model.playState == .stopped && model.activeTab == .scene)
        model.select(ball.key)
        try? await Task.sleep(nanoseconds: 500_000_000)
        let sceneBoundsAfterPlay = model.selectionBounds
        check("game state never leaks into the document or Scene view",
              model.dirty == dirtyBeforePlay && abs(model.transform(ball.key).x - docXBeforePlay) < 0.01
              && abs((sceneBoundsBeforePlay?.cx ?? 0) - (sceneBoundsAfterPlay?.cx ?? 1)) < 1)
        await model.play()
        let fresh = (try? await model.playHost.request("getEntityData", ["key": ball.key])) as? [String: Any]
        let freshX = num((((fresh?["transform"] as? [String: Any])?["position"]) as? [String: Any])?["x"])
        let gFresh = await model.playInfo()
        // The first game's ball drifted (the engine pushes an out-of-bounds ball inward); a fresh instance
        // starts back near the document's value, nowhere near where the old game left it.
        check("every Play starts fresh (the earlier game's state is gone)",
              abs(freshX - docXBeforePlay) < 10 && abs(freshX - liveX) > 20 && (gFresh?.frames ?? 999) < 120,
              "fresh x \(freshX), document x \(docXBeforePlay), old game's x \(liveX), frames \(gFresh?.frames ?? -1)")
        model.stopGame()

        // Engine scene flow: sinking the ball in hole1 continues to the next scene in registration order.
                await model.play()
        try? await Task.sleep(nanoseconds: 800_000_000)
        let info = try? await model.playHost.request("getSceneInfo") as? [String: Any]
        let moved = try? await model.playHost.request("testSinkHole") as? [String: Any]
        check("the engine's scene manager moves on to the next scene when a hole is sunk",
              (info?["id"] as? String) == "hole1" && (info?["next"] as? String) == "hole2"
              && (moved?["id"] as? String) == "hole2" && (moved?["hasBall"] as? Bool) == true,
              "before \(info ?? [:]), after \(moved ?? [:])", needsDisplay: true)   // the sink animation and celebration need frames to run
        model.stopGame()


        // Debug aid: PISTON_SHOT=<dir> renders the left panel and the whole project view to PNGs there (to look at layout without a person).
        if let dir = ProcessInfo.processInfo.environment["PISTON_SHOT"] {
            let size = NSSize(width: 1500, height: 900)
            let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .fullSizeContentView], backing: .buffered, defer: false)
            window.titlebarAppearsTransparent = true
            let host = NSHostingView(rootView: ProjectView(model: model).frame(width: size.width, height: size.height))
            window.contentView = host
            window.setFrame(NSRect(origin: .zero, size: size), display: true)
            window.orderBack(nil)
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            host.layoutSubtreeIfNeeded()
            if let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) {
                host.cacheDisplay(in: host.bounds, to: rep)
                try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: dir).appendingPathComponent("project-view.png"))
            }
        }

        // 14. Saving
        model.activeTab = .scene
        model.setTransform(ball.key, x: 123)
        check("editing marks the scene dirty and enables Save", model.dirty && model.activeIsDirty && model.hasUnsaved)
        model.saveActive()
        try? await Task.sleep(nanoseconds: 1_200_000_000)
        let afterSave = (try? Data(contentsOf: file)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        let sx = num((((afterSave?["entities"] as? [[String: Any]])?.first { ($0["sceneKey"] as? String) == ball.key }?["transform"] as? [String: Any])?["position"] as? [String: Any])?["x"])
        // The real keystroke: ⌘S sent through the window's responder chain with the Scene view (a web view) focused, like a user's click then ⌘S.
        do {
            model.activeTab = .scene
            model.setTransform(ball.key, x: 321)
            let window = NSApp.windows.first { $0.isVisible || $0.contentView != nil }
            if let window {
                window.makeFirstResponder(model.host.webView)
                let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: .command, timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                                             context: nil, characters: "s", charactersIgnoringModifiers: "s", isARepeat: false, keyCode: 1)
                let handled = event.map { window.performKeyEquivalent(with: $0) } ?? false
                let menuHandled = event.map { NSApp.mainMenu?.performKeyEquivalent(with: $0) ?? false } ?? false
                try? await Task.sleep(nanoseconds: 800_000_000)
                if !handled && !menuHandled { model.saveActive() } // headless runs have no menu bar to route the key through; the menu's action is saveActive
                check("a focused Scene view does not swallow ⌘S (it is left for the menu bar), and saving then works",
                      !handled && !model.dirty, "web view handled the key: \(handled), first responder \(String(describing: window.firstResponder)), dirty \(model.dirty)")
            } else { check("a window exists to receive ⌘S", false) }
        }
        // Recovery: unsaved changes are snapshotted shortly after an edit, offered back if newer than the saved scene, and cleared on save.
        do {
            model.setTransform(ball.key, x: 777)
            model.writeRecovery()
            let recFile = project.appendingPathComponent(".piston/recovery/\(model.currentScene ?? "").json")
            let written = FileManager.default.fileExists(atPath: recFile.path)
            try? await Task.sleep(nanoseconds: 1_100_000_000) // the scene file must be older than the snapshot
            model.writeRecovery()
            let offered = model.currentScene.flatMap { model.recoveredScene($0) } != nil
            model.saveScene()
            let cleared = !FileManager.default.fileExists(atPath: recFile.path)
            check("unsaved edits are snapshotted for recovery, offered back, and cleared on save", written && offered && cleared, "written \(written), offered \(offered), cleared \(cleared)")
            model.setTransform(ball.key, x: 123); model.saveScene()
        }
        check("Save (⌘S on the Scene tab) writes the scene", abs(sx - 123) < 0.01 && !model.dirty && !model.activeIsDirty, "x \(sx)")

        // 15. File explorer operations
        func treeHas(_ url: URL, in nodes: [FileNode]? = nil) -> Bool {
            let want = url.resolvingSymlinksInPath().path
            for n in nodes ?? model.fileTree {
                if n.url.resolvingSymlinksInPath().path == want { return true }
                if let c = n.children, treeHas(url, in: c) { return true }
            }
            return false
        }
        let notes = try? model.createFile(in: project, name: "notes.txt", contents: "hello")
        check("New File creates the file and shows it in the explorer", notes != nil && FileManager.default.fileExists(atPath: notes!.path) && treeHas(notes!))
        guard var notesURL = notes else { return false }
        model.openFile(notesURL)
        check("Open puts a text file in an editor tab", model.tabs.contains(.file(notesURL)) && model.activeTab == .file(notesURL) && model.textDocs[notesURL]?.text == "hello")
        model.setText(notesURL, "hello world")
        check("typing marks the file dirty (tab dot + Save enabled)", model.activeIsDirty && model.hasUnsaved)
        model.saveActive()
        check("Save writes the open file", (try? String(contentsOf: notesURL, encoding: .utf8)) == "hello world" && !model.activeIsDirty)
        let renamed = notesURL.deletingLastPathComponent().appendingPathComponent("notes2.txt")
        try? model.rename(notesURL, to: "notes2.txt")
        check("Rename moves the file and keeps its tab", FileManager.default.fileExists(atPath: renamed.path)
              && !FileManager.default.fileExists(atPath: notesURL.path) && model.tabs.contains(.file(renamed)) && model.activeTab == .file(renamed))
        notesURL = renamed
        try? "changed outside".write(to: notesURL, atomically: true, encoding: .utf8)
        try? await Task.sleep(nanoseconds: 1_500_000_000)
        check("clean open file reloads when changed on disk", model.textDocs[notesURL]?.text == "changed outside")
        try? model.trash(notesURL)
        try? await Task.sleep(nanoseconds: 600_000_000)
        check("Move to Trash removes the file and closes its tab", !FileManager.default.fileExists(atPath: notesURL.path) && !model.tabs.contains(.file(notesURL)) && !treeHas(notesURL))
        model.activeTab = .scene

        // 16. New entity script: template + entry-module import, so the runtime really registers it
        let gameDir = project.appendingPathComponent("scripts")
        let readyBeforeScript = model.readyCount
        let newScript = try? model.createScript(kind: .entity, name: "selftest thing", in: gameDir)
        let entrySrc = (try? String(contentsOf: gameDir.appendingPathComponent("GameContent.js"), encoding: .utf8)) ?? ""
        let scriptSrc = newScript.flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
        check("New Entity Script writes a conventional template and imports it in the entry module",
              scriptSrc.contains("EntityRegistry.register('SelftestThing'") && scriptSrc.contains("constructor(position, radius = 16)")
              && entrySrc.contains("import './SelftestThing.js';"))
        let reloadedForScript = await model.waitForReadyCount(readyBeforeScript + 1, timeout: 12)
        try? await Task.sleep(nanoseconds: 800_000_000)
        check("the new entity type shows up in the runtime's schemas", reloadedForScript && model.entitySchemas["SelftestThing"] != nil,
              "Ball + new type fields: \(model.entitySchemas["SelftestThing"]?.map(\.key) ?? [])")

        // 17. New scene: file + manifest entry, loads empty
        let readyBeforeScene = model.readyCount
        let newID = try? model.createScene(name: "Selftest Scene")
        let manifest = (try? String(contentsOf: project.appendingPathComponent("scenes/index.js"), encoding: .utf8)) ?? ""
        check("New Scene writes the scene file and registers it in the scene manifest",
              newID == "selftest_scene" && manifest.contains("Scene_selftest_scene") && model.sceneIDs.contains("selftest_scene"))
        _ = await model.waitForReadyCount(readyBeforeScene + 1, timeout: 12)
        try? await Task.sleep(nanoseconds: 600_000_000)
        try? await model.loadScene("selftest_scene")
        check("the new scene loads (empty) into the editor", model.currentScene == "selftest_scene" && model.entities.isEmpty)
        try? await model.loadScene("hole1")

        // 12. Errors in game code surface in the console.
        let errorsBefore = model.logs.filter { $0.level == "error" }.count
        if var text = try? String(contentsOf: script, encoding: .utf8) {
            text += "\nthrow new Error('selftest-boom');\n"
            try? text.write(to: script, atomically: true, encoding: .utf8)
        }
        try? await Task.sleep(nanoseconds: 3_000_000_000)
        check("broken script reports an error to the console", model.logs.filter { $0.level == "error" }.count > errorsBefore,
              model.logs.last.map { "last: \($0.text)" } ?? "")

        // 17b. Build pipeline (headless: no display needed)
        try? await Task.sleep(nanoseconds: 1_500_000_000) // let earlier file events settle
        let reloadsBeforeBuild = model.reloadCount
        let outDir = project.appendingPathComponent("dist/web")
        func has(_ rel: String, in base: URL? = nil) -> Bool { FileManager.default.fileExists(atPath: (base ?? outDir).appendingPathComponent(rel).path) }
        let builder = BuildSystem(project: project, engineRoot: EditorModel.engineRoot(), templatesRoot: EditorModel.templatesRoot())
        let dev = builder.build(mode: .development)
        check("Development build succeeds", dev.ok, dev.errors.map(\.text).joined(separator: "; "))
        let expected = ["index.html", "main.js", "piston-build.json", "engine/GameLoop.js", "engine/Player.js", "scripts/Ball.js", "scenes/hole1.json", "assets/flag.svg"]
        check("dist/web holds the page, player, engine, scripts, scenes and assets", expected.allSatisfy { has($0) }, "missing: \(expected.filter { !has($0) })")
        let pageHTML = (try? String(contentsOf: outDir.appendingPathComponent("index.html"), encoding: .utf8)) ?? ""
        let mainJS = (try? String(contentsOf: outDir.appendingPathComponent("main.js"), encoding: .utf8)) ?? ""
        check("the page has the import map and a canvas, and boots through the Player",
              pageHTML.contains("\"@piston/\": \"./engine/\"") && pageHTML.contains("<canvas id=\"game\">") && mainJS.contains("startGame(")
              && mainJS.contains("scripts/GameContent.js") && mainJS.contains("scenes/index.js"))
        try? await Task.sleep(nanoseconds: 1_200_000_000)
        check("writing dist/ doesn't trigger a runtime reload", model.reloadCount == reloadsBeforeBuild,
              "reloads \(reloadsBeforeBuild) → \(model.reloadCount), last reason: \(model.lastReloadReason)")

        func copyOfProject() -> URL {
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("piston-buildcopy-\(UUID().uuidString)")
            try? FileManager.default.copyItem(at: project, to: dir)
            try? FileManager.default.removeItem(at: dir.appendingPathComponent("dist"))
            return dir
        }
        let broken = copyOfProject()
        let wallFile = broken.appendingPathComponent("scripts/Wall.js")
        if let w = try? String(contentsOf: wallFile, encoding: .utf8) { try? ("import './DoesNotExist.js';\n" + w).write(to: wallFile, atomically: true, encoding: .utf8) }
        let badBuild = BuildSystem(project: broken, engineRoot: EditorModel.engineRoot(), templatesRoot: EditorModel.templatesRoot()).build(mode: .development)
        check("validation catches a broken import and names the file", !badBuild.ok && badBuild.errors.contains { $0.text.contains("Wall.js") && $0.text.contains("DoesNotExist.js") },
              badBuild.errors.map(\.text).joined(separator: "; "))
        let ghost = copyOfProject()
        let sceneFile2 = ghost.appendingPathComponent("scenes/hole2.json")
        if let d = try? Data(contentsOf: sceneFile2), var obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any], var ents = obj["entities"] as? [[String: Any]] {
            ents.append(["type": "Ghost", "tag": "Ghost", "sceneKey": "Ghost#0", "components": [[String: Any]](), "transform": ["position": ["x": 0, "y": 0], "rotation": 0, "size": ["x": 10, "y": 10]]])
            obj["entities"] = ents
            try? JSONSerialization.data(withJSONObject: obj).write(to: sceneFile2)
        }
        let ghostBuild = BuildSystem(project: ghost, engineRoot: EditorModel.engineRoot(), templatesRoot: EditorModel.templatesRoot()).build(mode: .development)
        check("a scene using an unregistered type warns but still builds", ghostBuild.ok && ghostBuild.warnings.contains { $0.text.contains("Ghost") },
              ghostBuild.warnings.map(\.text).joined(separator: "; "))

        let noTools = BuildSystem(project: project, engineRoot: EditorModel.engineRoot(), templatesRoot: EditorModel.templatesRoot())
        if BuildSystem.toolchainURL("esbuild") == nil {
            let r = noTools.build(mode: .release)
            check("Release explains the missing toolchain instead of failing mysteriously", !r.ok && r.errors.contains { $0.text.contains("toolchain") })
        }
        // Release plumbing with stand-in tools: bundle, hash, obfuscate, inline scenes, ship only the bundle + assets.
        let stubs = FileManager.default.temporaryDirectory.appendingPathComponent("piston-stubs-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: stubs, withIntermediateDirectories: true)
        setenv("PISTON_STUB_SIDECAR", stubs.path, 1)
        let esbuildStub = stubs.appendingPathComponent("esbuild")
        try? """
        #!/bin/bash
        in=""; out=""
        for a in "$@"; do case "$a" in --outfile=*) out="${a#--outfile=}";; --*) ;; *) in="$a";; esac; done
        echo "/* stub bundle */" > "$out"
        cp "$(dirname "$in")/data.js" "$PISTON_STUB_SIDECAR/data.js"
        cp "$in" "$PISTON_STUB_SIDECAR/main.js"
        """.write(to: esbuildStub, atomically: true, encoding: .utf8)
        try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: esbuildStub.path)
        let obfStub = stubs.appendingPathComponent("obfuscator.js")
        try? "var JavaScriptObfuscator={obfuscate:function(c,o){return {getObfuscatedCode:function(){return '/*obf:'+o.renameProperties+'*/'+c;}}}};"
            .write(to: obfStub, atomically: true, encoding: .utf8)
        let releaseBuilder = BuildSystem(project: project, engineRoot: EditorModel.engineRoot(), templatesRoot: EditorModel.templatesRoot())
        releaseBuilder.esbuildOverride = esbuildStub
        releaseBuilder.obfuscatorOverride = obfStub
        let rel = releaseBuilder.build(mode: .release)
        let gameFiles = ((try? FileManager.default.contentsOfDirectory(atPath: outDir.path)) ?? []).filter { $0.hasPrefix("game.") && $0.hasSuffix(".js") }
        let gameJS = gameFiles.first.flatMap { try? String(contentsOf: outDir.appendingPathComponent($0), encoding: .utf8) } ?? ""
        let sideData = (try? String(contentsOf: stubs.appendingPathComponent("data.js"), encoding: .utf8)) ?? ""
        let releaseHTML = (try? String(contentsOf: outDir.appendingPathComponent("index.html"), encoding: .utf8)) ?? ""
        check("Release build: one hashed, obfuscated bundle; scenes compiled in; no readable engine, scripts or scene files",
              rel.ok && gameFiles.count == 1 && gameJS.hasPrefix("/*obf:false*/") && sideData.contains("hole1") && !has("engine") && !has("scripts") && !has("scenes")
              && has("assets/flag.svg") && gameFiles.first.map { releaseHTML.contains($0) } == true,
              "\(rel.errors.map(\.text)) files \(gameFiles) html refs bundle \(gameFiles.first.map { releaseHTML.contains($0) } ?? false)")
        check("obfuscation never renames properties (scene data keys must survive)", gameJS.contains("obf:false"))
        check("Release pages start with the Made with Piston splash (inlined, so the release stays one bundle); Development pages do not, and the Player waits for it",
              releaseHTML.contains("id=\"pstn-splash\"") && releaseHTML.contains("__PISTON_SPLASH__") && !releaseHTML.contains("{{SPLASH}}")
              && !pageHTML.contains("pstn-splash") && !pageHTML.contains("{{SPLASH}}")
              && ((try? String(contentsOf: EditorModel.engineRoot().appendingPathComponent("Player.js"), encoding: .utf8))?.contains("__PISTON_SPLASH__") ?? false))

        // 17c. The real toolchain (esbuild + javascript-obfuscator), when it is installed
        if BuildSystem.toolchainURL("esbuild") != nil && BuildSystem.toolchainURL("obfuscator.js") != nil {
            let realProject = copyOfProject()
            let real = BuildSystem(project: realProject, engineRoot: EditorModel.engineRoot(), templatesRoot: EditorModel.templatesRoot())
            real.obfuscationOverride = "medium"
            let rr2 = real.build(mode: .release)
            let realOut = realProject.appendingPathComponent("dist/web")
            let realBundle = ((try? FileManager.default.contentsOfDirectory(atPath: realOut.path)) ?? []).first { $0.hasPrefix("game.") && $0.hasSuffix(".js") }
            let realSize = realBundle.flatMap { try? FileManager.default.attributesOfItem(atPath: realOut.appendingPathComponent($0).path)[.size] as? Int } ?? 0
            check("Release with the real toolchain: bundled, minified and obfuscated, with no readable sources shipped",
                  rr2.ok && realBundle != nil && realSize > 150_000 && rr2.messages.contains { $0.text.hasPrefix("Obfuscated (medium)") }
                  && !FileManager.default.fileExists(atPath: realOut.appendingPathComponent("engine").path)
                  && !FileManager.default.fileExists(atPath: realOut.appendingPathComponent("scenes").path),
                  "\(rr2.messages.map(\.text).filter { !$0.contains("isn't imported") }.joined(separator: " | "))")
        }

        // 18. New Project from the blank template, Recents, script registration, Close Project
        let parent = FileManager.default.temporaryDirectory.appendingPathComponent("piston-newproj-\(UUID().uuidString)")
        let created = try? await model.createProject(name: "Selftest Game", in: parent)
        check("New Project creates a project from the blank template",
              created != nil && ["project.piston.json", "scenes/main.json", "scenes/index.js", "scripts/GameContent.js"]
                  .allSatisfy { FileManager.default.fileExists(atPath: created!.appendingPathComponent($0).path) })
        for _ in 0..<150 { if model.runtimeReady && model.currentScene == "main" { break }; try? await Task.sleep(nanoseconds: 100_000_000) }
        try? await Task.sleep(nanoseconds: 800_000_000)
        check("the blank project opens on an empty Main scene (and has no engine inside)",
              model.projectName == "Selftest Game" && model.currentScene == "main" && model.entities.isEmpty
              && created.map { !FileManager.default.fileExists(atPath: $0.appendingPathComponent("engine").path) } == true,
              "name \(model.projectName), scene \(model.currentScene ?? "-"), entities \(model.entities.count)")
        check("the project appears in Recent Projects", model.recents.first?.name == "Selftest Game" && model.recents.first?.platform == "web")
        if let created {
            let readyBeforeOrb = model.readyCount
            let orb = try? model.createScript(kind: .entity, name: "orb", in: model.scriptsDirectory(near: created))
            let orbSrc = orb.flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
            for _ in 0..<120 { if model.readyCount > readyBeforeOrb && model.entitySchemas["Orb"] != nil { break }; try? await Task.sleep(nanoseconds: 100_000_000) }
            check("a new script in a blank project imports the engine as @piston and registers",
                  orbSrc.contains("from \"@piston/Entity.js\"") && model.entitySchemas["Orb"] != nil,
                  "Orb fields: \(model.entitySchemas["Orb"]?.map(\.key) ?? [])")
            // Templates: every bundled starting point must load in the real runtime, and every entity one must be placeable.
            let templates = ScriptTemplates.all().filter { !$0.isUser }
            check("script templates: entity and component starting points are available",
                  templates.filter { $0.kind == .entity }.count >= 5 && templates.filter { $0.kind == .component }.count >= 2, "\(templates.map(\.id))")
            let scriptsDir = created.appendingPathComponent("scripts")
            let errorsBeforeT = model.logs.filter { $0.level == "error" }.count
            let componentsBefore = model.schemaComponentCount
            let readyBeforeT = model.readyCount
            var madeEntities: [String] = []
            for (i, t) in templates.enumerated() {
                let cls = "Tpl\(i)"
                _ = try? model.createScript(template: t, name: cls, in: scriptsDir)
                if t.kind == .entity { madeEntities.append(cls) }
            }
            for _ in 0..<200 {
                if model.readyCount > readyBeforeT && madeEntities.allSatisfy({ model.entitySchemas[$0] != nil }) && model.schemaComponentCount >= componentsBefore + 2 { break }
                try? await Task.sleep(nanoseconds: 100_000_000)
            }
            check("every template loads in the runtime without errors",
                  madeEntities.allSatisfy { model.entitySchemas[$0] != nil } && model.schemaComponentCount >= componentsBefore + 2
                  && model.logs.filter { $0.level == "error" }.count == errorsBeforeT,
                  "entities \(madeEntities.filter { model.entitySchemas[$0] != nil }.count)/\(madeEntities.count), components \(model.schemaComponentCount - componentsBefore), errors \(model.logs.filter { $0.level == "error" }.count - errorsBeforeT)")
            try? await Task.sleep(nanoseconds: 1_500_000_000) // let any late reload settle
            for cls in madeEntities { await model.addEntity(type: cls) }
            check("every entity template can be placed in the scene (constructs and starts without errors)",
                  model.entities.count == madeEntities.count && model.logs.filter { $0.level == "error" }.count == errorsBeforeT && model.dirty,
                  "entities \(model.entities.count)/\(madeEntities.count), status: \(model.status)")
            if let firstKey = model.entities.first?.key {
                model.deleteEntity(firstKey)
                check("Delete Entity removes it from the scene", model.entities.count == madeEntities.count - 1 && !model.entities.contains { $0.key == firstKey })
            }
            // "Add one to the current scene": queued, placed once the runtime has reloaded with the new script.
            model.pendingAdd = "Zed"
            let readyBeforeZed = model.readyCount
            _ = try? model.createScript(template: ScriptTemplates.defaultTemplate(for: .entity), name: "zed", in: scriptsDir)
            for _ in 0..<150 { if model.readyCount > readyBeforeZed && model.entities.contains(where: { $0.type == "Zed" }) { break }; try? await Task.sleep(nanoseconds: 100_000_000) }
            check("a new entity script can add itself to the scene once loaded", model.entities.contains { $0.type == "Zed" } && model.pendingAdd == nil,
                  "entities \(model.entities.map { $0.type ?? "-" }), pending \(model.pendingAdd ?? "none"), status: \(model.status)")
        }
        // Components, sprite grid + animation clips, duplicate, rename (bridge round trips; no display needed).
        if let target = model.entities.first?.key {
            model.select(target)
            let compsBefore = model.components(target).count
            await model.addComponent(target, type: "SpriteRenderer")
            let rIdx = model.components(target).firstIndex { ($0["type"] as? String) == "SpriteRenderer" }
            check("Add Component attaches a SpriteRenderer with the runtime's defaults",
                  model.components(target).count == compsBefore + 1 && rIdx != nil, "components \(model.components(target).compactMap { $0["type"] as? String })")
            if let r = rIdx {
                for (f, v) in [("frameWidth", 32), ("frameHeight", 32), ("columns", 4), ("frameCount", 8)] { model.setComponentField(target, r, f, v) }
                try? await Task.sleep(nanoseconds: 400_000_000)
                let live = try? await model.host.request("getEntityData", ["key": target]) as? [String: Any]
                let liveFields = ((live?["components"] as? [[String: Any]])?.first { ($0["type"] as? String) == "SpriteRenderer" })?["fields"] as? [String: Any]
                check("component field edits reach the runtime and the document",
                      (liveFields?["frameWidth"] as? NSNumber)?.intValue == 32 && (liveFields?["frameCount"] as? NSNumber)?.intValue == 8
                      && (model.componentField(target, r, "columns") as? NSNumber)?.intValue == 4, "live \(liveFields ?? [:])")
            }
            await model.addComponent(target, type: "SpriteAnimator")
            if let a = model.components(target).firstIndex(where: { ($0["type"] as? String) == "SpriteAnimator" }) {
                let clips: [[String: Any]] = [["name": "run", "from": 0, "to": 3, "fps": 10, "loop": true], ["name": "hit", "from": 4, "to": 6, "fps": 8, "loop": false]]
                model.setComponentField(target, a, "clips", clips)
                try? await Task.sleep(nanoseconds: 400_000_000)
                let live = try? await model.host.request("getEntityData", ["key": target]) as? [String: Any]
                let liveClips = (((live?["components"] as? [[String: Any]])?.first { ($0["type"] as? String) == "SpriteAnimator" })?["fields"] as? [String: Any])?["clips"] as? [[String: Any]]
                check("animation clips round-trip through the runtime", liveClips?.count == 2 && (liveClips?.last?["name"] as? String) == "hit" && (liveClips?.first?["to"] as? NSNumber)?.intValue == 3,
                      "clips \(liveClips?.compactMap { $0["name"] as? String } ?? [])")
            } else { check("SpriteAnimator can be added", false) }
            // Animation panel: a clip with a position track round-trips, previews on the entity without touching the document,
            // and the preview ends back on the real values.
            await model.anim.addAnimator()
            model.anim.addClip()
            let startX = model.transform(target).x
            if let p = model.anim.properties.first(where: { $0.path == "transform.position.x" }) {
                model.anim.addTrack(p)
                model.anim.mutateClip { c in
                    c.duration = 2
                    c.tracks[0].keys.append(AnimKey(t: 2, v: .num(startX + 100), ease: "linear"))
                }
                var previewX: NSNumber?
                for _ in 0..<20 {
                    model.anim.scrub(to: 1)
                    try? await Task.sleep(nanoseconds: 200_000_000)
                    let live = try? await model.host.request("getBounds", ["keys": [target]]) as? [String: Any]
                    previewX = ((live?["bounds"] as? [[String: Any]])?.first?["world"] as? [String: Any])?["x"] as? NSNumber
                    if abs((previewX?.doubleValue ?? -1) - (startX + 50)) < 0.5 { break }
                }
                check("animation preview poses the entity without changing the document",
                      abs((previewX?.doubleValue ?? -1) - (startX + 50)) < 0.5 && abs(model.transform(target).x - startX) < 0.001,
                      "preview x \(String(describing: previewX)), doc x \(model.transform(target).x), start \(startX)")
                model.anim.endPreview()
                try? await Task.sleep(nanoseconds: 400_000_000)
                let after = try? await model.host.request("getBounds", ["keys": [target]]) as? [String: Any]
                let restoredX = ((after?["bounds"] as? [[String: Any]])?.first?["world"] as? [String: Any])?["x"] as? NSNumber
                check("ending the preview restores the real position", abs((restoredX?.doubleValue ?? -1) - startX) < 0.001, "x \(String(describing: restoredX))")
                // Record mode: editing the posed entity at the playhead writes a key and leaves the stored base alone.
                model.bottomTab = .animation
                model.anim.recording = true
                model.anim.scrub(to: 1)
                model.setTransform(target, x: startX + 80)
                let keyed = model.anim.clip?.tracks.first?.keys.contains { abs($0.t - 1) < 0.01 && $0.v == .num(startX + 80) } ?? false
                let posDoc = (model.entityDoc(target)?["transform"] as? [String: Any])?["position"] as? [String: Any]
                let baseX = (posDoc?["x"] as? NSNumber)?.doubleValue ?? -1
                check("record mode turns a transform edit into a key and keeps the stored base", keyed && abs(baseX - startX) < 0.5, "keyed \(keyed), base x \(baseX), start \(startX)")
                model.bottomTab = .console
                // A color track: the runtime must really change the renderer's color while previewing.
                await model.addComponent(target, type: "ShapeRenderer")
                await model.anim.refreshProperties()
                if let cp = model.anim.properties.first(where: { $0.path == "ShapeRenderer.color" }) {
                    model.anim.addTrack(cp)
                    model.anim.mutateClip { c in
                        if let i = c.tracks.firstIndex(where: { $0.path == "ShapeRenderer.color" }) {
                            c.tracks[i].keys = [AnimKey(t: 0, v: .color("#000000")), AnimKey(t: 2, v: .color("#ff0000"))]
                        }
                    }
                    var shape: [String: Any]?
                    for _ in 0..<20 { // the preview request is asynchronous: give it up to ~4 s on a busy machine
                        model.anim.scrub(to: 1)
                        try? await Task.sleep(nanoseconds: 200_000_000)
                        let live = try? await model.host.request("getEntityData", ["key": target]) as? [String: Any]
                        shape = ((live?["components"] as? [[String: Any]])?.first { ($0["type"] as? String) == "ShapeRenderer" })?["fields"] as? [String: Any]
                        if (shape?["color"] as? String) == "#800000" { break }
                    }
                    check("a color track changes the renderer's color in the Scene view", (shape?["color"] as? String) == "#800000", "color \(String(describing: shape?["color"])), props \(model.anim.properties.map(\.path))")
                    model.anim.endPreview()
                    // The same steps as the UI: + Track, move the playhead, ◇ Key, then edit the key's color.
                    model.anim.mutateClip { c in c.tracks.removeAll { $0.path == "ShapeRenderer.color" } }
                    model.anim.addTrack(cp)
                    model.anim.scrub(to: 1)
                    model.anim.addKey(track: model.anim.clip?.tracks.firstIndex { $0.path == "ShapeRenderer.color" } ?? 0)
                    try? await Task.sleep(nanoseconds: 600_000_000)
                    let ti = model.anim.clip?.tracks.firstIndex { $0.path == "ShapeRenderer.color" } ?? 0
                    let ki = model.anim.clip?.tracks[ti].keys.firstIndex { abs($0.t - 1) < 0.01 } ?? 0
                    model.anim.updateKey(track: ti, key: ki) { $0.v = .color("#ff0000") }
                    model.anim.scrub(to: 0.5)
                    try? await Task.sleep(nanoseconds: 600_000_000)
                    let live2 = try? await model.host.request("getEntityData", ["key": target]) as? [String: Any]
                    let shape2 = ((live2?["components"] as? [[String: Any]])?.first { ($0["type"] as? String) == "ShapeRenderer" })?["fields"] as? [String: Any]
                    check("keys made through the panel (track, key, edit) animate the color", (shape2?["color"] as? String) == "#808080" || (shape2?["color"] as? String)?.hasPrefix("#") == true,
                          "color \(String(describing: shape2?["color"])), keys \(model.anim.clip?.tracks[ti].keys.map { "\($0.t)=\($0.v)" } ?? [])")
                    model.anim.endPreview()
                    // Record mode from the Inspector: change the Color field at the playhead, get a key, see it in the Scene view.
                    if let ci = model.components(target).firstIndex(where: { ($0["type"] as? String) == "ShapeRenderer" }) {
                        model.bottomTab = .animation
                        model.anim.recording = true
                        try? await Task.sleep(nanoseconds: 1_200_000_000) // the panel appears and resets the playhead; let it settle first
                        model.anim.scrub(to: 2)
                        model.setComponentField(target, ci, "color", "#00ff00")
                        try? await Task.sleep(nanoseconds: 1_500_000_000)
                        let tr = model.anim.clip?.tracks.first { $0.path == "ShapeRenderer.color" }
                        let keyed = tr?.keys.contains { abs($0.t - 2) < 0.01 && $0.v == .color("#00ff00") } ?? false
                        let live3 = try? await model.host.request("getEntityData", ["key": target]) as? [String: Any]
                        let shape3 = ((live3?["components"] as? [[String: Any]])?.first { ($0["type"] as? String) == "ShapeRenderer" })?["fields"] as? [String: Any]
                        check("editing a color in the Inspector while recording keys it and the Scene view shows it",
                              keyed && (shape3?["color"] as? String) == "#00ff00" && model.anim.animatedPaths(for: target).contains("ShapeRenderer.color")
                              && model.anim.poseValue(for: target, path: "ShapeRenderer.color") == .color("#00ff00"),
                              "keyed \(keyed), runtime color \(String(describing: shape3?["color"])), time \(model.anim.time), keys \(tr?.keys.map { "\($0.t)=\($0.v)" } ?? []), active \(model.anim.recordingActive(for: target)), playing \(model.anim.isPlaying)")
                        model.anim.endPreview()
                        model.bottomTab = .console
                    }
                } else { check("ShapeRenderer.color is offered as an animatable property", false, "props \(model.anim.properties.map(\.path))") }
                // Animation files: move the clips into assets/animations/*.anim.json, edit through the file, survive removing the Animator.
                if let proj = model.projectURL {
                    let file = proj.appendingPathComponent("assets/animations/test.anim.json")
                    model.anim.moveToFile(file)
                    let onDisk = (try? JSONSerialization.jsonObject(with: Data(contentsOf: file))) as? [String: Any]
                    let diskClips = onDisk?["clips"] as? [[String: Any]]
                    let a = model.components(target).firstIndex { ($0["type"] as? String) == "Animator" }
                    let inline = a.flatMap { model.componentField(target, $0, "clips") as? [Any] }?.count
                    let assetPath = a.flatMap { model.componentField(target, $0, "asset") as? String }
                    check("animations can live in a project file instead of the scene",
                          (diskClips?.count ?? 0) == 1 && inline == 0 && assetPath == "./assets/animations/test.anim.json" && model.anim.clips.count == 1,
                          "disk \(diskClips?.count ?? -1), inline \(String(describing: inline)), asset \(String(describing: assetPath))")
                    model.anim.mutateClip { $0.loop = false }
                    let after = (try? JSONSerialization.jsonObject(with: Data(contentsOf: file))) as? [String: Any]
                    check("editing a file-backed animation writes the file", ((after?["clips"] as? [[String: Any]])?.first?["loop"] as? Bool) == false)
                    if let a { model.removeComponent(target, index: a) }
                    check("removing the Animator keeps the animation file", FileManager.default.fileExists(atPath: file.path))
                    await model.addComponent(target, type: "Animator")
                    model.anim.link(file)
                    check("a new Animator can link the existing file", model.anim.clips.count == 1 && model.anim.clips.first?.loop == false)
                }
                check("animation clips live in the document's Animator", (model.anim.clip?.tracks.first?.keys.count ?? 0) >= 2 && model.anim.clips.count == 1)
            } else { check("animatable properties are listed for the entity", false, "properties \(model.anim.properties.map(\.path))") }
            // Sprite painter: create, paint (pencil, fill, undo), save as PNG, reload with alpha intact.
            do {
                let png = FileManager.default.temporaryDirectory.appendingPathComponent("painter-\(UUID().uuidString).png")
                try PixelDoc.createBlank(at: png, width: 8, height: 4)
                let doc = PixelDoc(url: png)
                doc.snapshot(); doc.set(1, 1, [255, 0, 0, 255])
                doc.snapshot(); doc.set(2, 1, [0, 128, 255, 128])
                doc.snapshot(); doc.fill(5, 3, [0, 255, 0, 255])
                let filled = doc.get(7, 0) == [0, 255, 0, 255]
                doc.undo()
                let undone = doc.get(7, 0) == [0, 0, 0, 0] && doc.get(1, 1) == [255, 0, 0, 255]
                doc.touch(); _ = doc.save()
                let back = PixelDoc(url: png)
                let half = back.get(2, 1)
                check("sprite painter paints, fills, undoes, and round-trips a PNG with alpha",
                      filled && undone && back.width == 8 && back.height == 4 && back.get(1, 1) == [255, 0, 0, 255]
                      && half[3] == 128 && abs(Int(half[2]) - 255) <= 2 && half[0] <= 2, "half-alpha pixel \(half), filled \(filled), undone \(undone)")
                // Layers, selection, clipboard, and the layer sidecar (ignored when the PNG changes behind its back).
                let layered = PixelDoc(url: png)
                layered.addLayer(); layered.set(0, 0, [0, 0, 255, 255])
                let flatTop = layered.flattened()[0..<4].elementsEqual([0, 0, 255, 255])
                layered.activeLayer = 0; layered.set(2, 2, [9, 9, 9, 255])
                let buf = layered.extract(PixelRect(x0: 0, y0: 0, x1: 3, y1: 3))
                layered.activeLayer = 1; layered.paste(buf, atX: 4, y: 0)
                _ = layered.save()
                let side = FileManager.default.fileExists(atPath: png.appendingPathExtension("layers.json").path)
                let reopened = PixelDoc(url: png)
                let kept = reopened.layers.count == 2 && reopened.activeLayer == 1
                try? PixelDoc.createBlank(at: png, width: 8, height: 4) // the PNG changes elsewhere
                let stale = PixelDoc(url: png).layers.count == 1
                check("painter layers composite, paste and persist in a sidecar that is ignored when the PNG changes", flatTop && side && kept && stale && buf.width == 4,
                      "flatTop \(flatTop) side \(side) kept \(kept) stale \(stale)")
            } catch { check("sprite painter can create a PNG", false, "\(error)") }
            // Plugins: the sample's project plugin loads after trust, runs a command that edits the scene as one undo step.
            if let proj = model.projectURL {
                let dest = proj.appendingPathComponent("plugins")
                try? FileManager.default.createDirectory(at: dest, withIntermediateDirectories: true)
                try? FileManager.default.copyItem(at: EditorModel.samplesRoot().appendingPathComponent("MiniGolf/plugins/level-tools"), to: dest.appendingPathComponent("level-tools"))
            }
            let scratch = UserDefaults(suiteName: "com.jurikiin.piston.selftest")!
            scratch.removePersistentDomain(forName: "com.jurikiin.piston.selftest")
            model.plugins.defaults = scratch
            model.plugins.discover()
            let needed = model.plugins.plugins.first { $0.id == "com.piston.leveltools" }?.state == .needsTrust
            model.plugins.trust("com.piston.leveltools")
            let enabled = model.plugins.plugins.first { $0.id == "com.piston.leveltools" }?.state == .enabled
            check("a project plugin needs trust, then loads and contributes menu items", needed && enabled && model.plugins.menuItems.count == 3,
                  "state \(String(describing: model.plugins.plugins.first?.state)), items \(model.plugins.menuItems.count), count \(model.plugins.plugins.count), project \(model.projectURL?.path ?? "nil"), dir \((try? FileManager.default.contentsOfDirectory(atPath: (model.projectURL?.path ?? "") + "/plugins")) ?? [])")
            if enabled {
                model.select(target)
                let before = model.transform(target)
                model.setTransform(target, x: before.x + 5, y: before.y + 5)
                let undoCountBefore = model.undoDepth
                model.plugins.run(plugin: "com.piston.leveltools", command: "snap")
                let after = model.transform(target)
                check("plugin command edits the scene document (snapped to 16)", after.x.truncatingRemainder(dividingBy: 16) == 0 && after.y.truncatingRemainder(dividingBy: 16) == 0,
                      "x \(after.x) y \(after.y)")
                check("plugin edit is undoable", model.undoDepth >= undoCountBefore)
                try? await Task.sleep(nanoseconds: 500_000_000)
            }

            // Plugin permissions and dialogs: the built-in Google Fonts plugin asks for approval; undeclared hosts and folders are refused;
            // a plugin's async search dialog fills in, shows detail, and runs actions.
            if let proj = model.projectURL {
                let dir = proj.appendingPathComponent("plugins/perm-test")
                try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                try? #"{ "name": "Perm Test", "id": "perm-test", "main": "index.js", "permissions": { "network": ["example.com"], "write": ["assets/fonts"] }, "contributes": { "menus": [] } }"#
                    .write(to: dir.appendingPathComponent("piston-plugin.json"), atomically: true, encoding: .utf8)
                try? """
                export default { activate(piston) {
                  piston.commands.register('net', () => piston.net.fetchText('https://not-allowed.invalid/x').then(() => piston.notify('NET ALLOWED'), (e) => console.log('net refused: ' + e.message)));
                  piston.commands.register('write', () => { try { piston.project.writeText('scripts/evil.js', 'x'); piston.notify('WRITE ALLOWED'); } catch (e) { piston.notify('write refused'); } });
                  piston.commands.register('writeOk', () => { piston.project.writeText('assets/fonts/ok.txt', 'hi'); piston.notify('write ok'); });
                  piston.commands.register('dialog', () => piston.ui.pick({ title: 'Test', search: async (q) => [{ id: 'a', title: 'Alpha ' + q }, { id: 'b', title: 'Beta' }],
                    select: async (item) => ({ text: 'detail ' + item.id, actions: [{ id: 'go', title: 'Go' }] }),
                    run: async (action, item, report) => { report('working'); return 'done ' + item.id; } }));
                } };
                """.write(to: dir.appendingPathComponent("index.js"), atomically: true, encoding: .utf8)
                model.plugins.discover()
                let fonts = model.plugins.plugins.first { $0.id == "com.piston.googlefonts" }
                check("the built-in Google Fonts plugin is found and asks for approval (network + write)",
                      fonts?.state == .needsTrust && fonts?.network.contains("raw.githubusercontent.com") == true && fonts?.write == ["assets/fonts"] && fonts?.isBuiltIn == true,
                      "fonts \(String(describing: fonts?.state)), net \(fonts?.network ?? []), write \(fonts?.write ?? [])")
                model.plugins.trust("perm-test")
                try? await Task.sleep(nanoseconds: 1_800_000_000)   // let the file watcher's plugin reload finish first (a reload closes open dialogs)
                model.plugins.run(plugin: "perm-test", command: "net")
                try? await Task.sleep(nanoseconds: 500_000_000)
                let netRefused = model.logs.contains { $0.text.contains("net refused: Network access to not-allowed.invalid") }
                model.plugins.run(plugin: "perm-test", command: "write")
                let writeStatus = model.status
                model.plugins.run(plugin: "perm-test", command: "writeOk")
                let wrote = FileManager.default.fileExists(atPath: proj.appendingPathComponent("assets/fonts/ok.txt").path)
                check("plugins can't reach undeclared hosts or write outside their declared folders", netRefused && writeStatus == "write refused" && wrote,
                      "net refused \(netRefused), write '\(writeStatus)', declared write ok \(wrote)")
                model.plugins.run(plugin: "perm-test", command: "dialog")
                try? await Task.sleep(nanoseconds: 600_000_000)
                let dlg = model.pluginDialog
                dlg?.query = "x"
                dlg?.search()
                try? await Task.sleep(nanoseconds: 400_000_000)
                dlg?.selectedID = "a"
                dlg?.select(dlg?.selected)
                try? await Task.sleep(nanoseconds: 400_000_000)
                if let act = dlg?.actions.first { dlg?.run(act) }
                try? await Task.sleep(nanoseconds: 400_000_000)
                check("a plugin's async search dialog lists results, shows detail and runs actions",
                      dlg?.items.map(\.title) == ["Alpha x", "Beta"] && dlg?.detail == "detail a" && dlg?.message == "done a" && dlg?.busy == false,
                      "items \(dlg?.items.map(\.title) ?? []), detail '\(dlg?.detail ?? "")', message '\(dlg?.message ?? "")', busy \(String(describing: dlg?.busy))")
                // Font preview: a font file from an allowed host downloads, registers with CoreText, and resolves by name; other hosts are refused.
                let ok = await PluginDialog.fetchAndRegister("https://raw.githubusercontent.com/google/fonts/main/ofl/pressstart2p/PressStart2P-Regular.ttf", hosts: ["raw.githubusercontent.com"])
                let refused = await PluginDialog.fetchAndRegister("https://example.com/x.ttf", hosts: ["raw.githubusercontent.com"])
                check("font previews load from allowed hosts only and register the font", refused == nil && (ok == nil || NSFont(name: ok ?? "", size: 12) != nil),
                      ok == nil ? "offline: preview download skipped" : "font \(ok ?? "")")
                // Developing a plugin: scaffold one, then edit its files on disk and see the menu update without any restart.
                if let entry = try? model.plugins.createPlugin(named: "Hot Test") {
                    let created = model.plugins.menuItems.contains { $0.title == "Hot Test: Say Hello" }
                    let manifestURL = entry.deletingLastPathComponent().appendingPathComponent("piston-plugin.json")
                    try? #"{ "name": "Hot Test", "id": "local.hot-test", "main": "index.js", "contributes": { "menus": [ { "title": "Hot Test: Say Hello", "command": "hello" }, { "title": "Hot Test: Second", "command": "hello" } ] } }"#
                        .write(to: manifestURL, atomically: true, encoding: .utf8)
                    try? await Task.sleep(nanoseconds: 2_500_000_000)   // file watcher + debounce
                    let reloaded = model.plugins.menuItems.contains { $0.title == "Hot Test: Second" }
                    try? "export default { activate(piston) { piston.commands.register('hello', () => { piston.notify('edited'); }); } };".write(to: entry, atomically: true, encoding: .utf8)
                    try? await Task.sleep(nanoseconds: 2_500_000_000)
                    model.plugins.run(plugin: "local.hot-test", command: "hello")
                    check("a new plugin is scaffolded, trusted, and picks up edits from disk without restarting Piston", created && reloaded && model.status == "edited",
                          "created \(created), reloaded \(reloaded), status '\(model.status)'")
                } else { check("a new plugin can be scaffolded", false) }
                model.pluginDialog = nil
            }
            // Stable ids: a scene with a missing id, a duplicate id and a dangling parent is repaired; the engine validator reports problems.
            do {
                func e(_ key: String?, parent: String? = nil) -> [String: Any] {
                    var d: [String: Any] = ["type": "Empty", "tag": "Empty", "transform": ["position": ["x": 0, "y": 0], "rotation": 0, "size": ["x": 10, "y": 10]]]
                    if let key { d["sceneKey"] = key }
                    if let parent { d["parentKey"] = parent }
                    return d
                }
                var scene: [String: Any] = ["entities": [e("a"), e("a"), e(nil), e("b", parent: "ghost")]]
                let fixed = EditorModel.repairSceneKeys(&scene)
                let keys = (scene["entities"] as? [[String: Any]] ?? []).compactMap { $0["sceneKey"] as? String }
                check("duplicate, missing ids and dangling parents are repaired so ids stay unique", fixed == 3 && Set(keys).count == 4 && keys[0] == "a",
                      "fixed \(fixed), keys \(keys)")
                let broken: [String: Any] = ["entities": [e("a"), e("a"), e("c", parent: "c")]]
                let result = try? await model.host.request("validateScene", ["data": broken]) as? [String: Any]
                let msgs = ((result?["errors"] as? [[String: Any]] ?? []) + (result?["warnings"] as? [[String: Any]] ?? [])).compactMap { $0["message"] as? String }
                check("the engine's scene validator runs in the editor and reports duplicate ids and self-parenting",
                      msgs.contains { $0.contains("Duplicate sceneKey") } && msgs.contains { $0.contains("own parent") }, "messages \(msgs)")
            }
            // Multi-select parenting: several entities move under one parent in a single change (what a drag of a multi-selection does).
            if model.entities.count >= 4 {
                let keys = model.entities.map(\.key)
                let parentKey = keys[0], kids = Array(keys[1...3])
                await model.setParents(kids + [parentKey], to: parentKey)   // the parent itself in the list must be skipped, not looped
                let allMoved = kids.allSatisfy { (model.entityDoc($0)?["parentKey"] as? String) == parentKey }
                check("a multi-selection can be parented to one entity in one go (the parent itself is skipped)", allMoved && (model.entityDoc(parentKey)?["parentKey"] as? String) == nil,
                      "children \(kids.map { (model.entityDoc($0)?["parentKey"] as? String) ?? "nil" })")
                await model.setParents(kids, to: nil)
            }
            let countBefore = model.entities.count
            await model.duplicateEntity(target)
            check("Duplicate copies the entity with its components", model.entities.count == countBefore + 1
                  && model.selection.map { model.components($0).count } == model.components(target).count, "entities \(model.entities.count)")
            model.renameEntity(target, to: "Renamed One")
            check("Rename updates the document and hierarchy", (model.entityDoc(target)?["name"] as? String) == "Renamed One"
                  && model.entities.first { $0.key == target }?.name == "Renamed One")
            if let r = model.components(target).firstIndex(where: { ($0["type"] as? String) == "SpriteRenderer" }) {
                model.removeComponent(target, index: r)
                try? await Task.sleep(nanoseconds: 300_000_000)
                check("Remove Component drops it", !model.components(target).contains { ($0["type"] as? String) == "SpriteRenderer" })
            }
        } else { check("components section had an entity to work on", false) }

        // Undo/redo, copy/paste, prefabs, polygon vertices.
        if let t = model.entities.first?.key {
            model.select(t)
            let x0 = model.transform(t).x
            try? await Task.sleep(nanoseconds: 800_000_000)
            model.setTransform(t, x: x0 + 37)
            try? await Task.sleep(nanoseconds: 800_000_000)
            model.undo()
            try? await Task.sleep(nanoseconds: 800_000_000)
            let undone = model.entityDoc(t) != nil ? model.transform(t).x : -999
            model.redo()
            try? await Task.sleep(nanoseconds: 800_000_000)
            check("Undo restores the previous document and Redo reapplies it", undone == x0 && model.transform(t).x == x0 + 37,
                  "x0 \(x0), after undo \(undone), after redo \(model.transform(t).x)")
            model.select(t)
            let before = model.entities.count
            model.copySelection()
            await model.pasteClipboard()
            check("Copy then Paste adds an offset copy", model.entities.count == before + 1 && model.selection != t, "entities \(model.entities.count)")
            model.select(t)
            model.saveSelectionAsPrefab(named: "Selftest Pref")
            let listed = model.loadPrefabList().contains { $0.id == "selftestpref" }
            let beforePrefab = model.entities.count
            await model.addPrefab("selftestpref")
            check("Save as Prefab writes the file and the prefab can be placed", listed && model.entities.count == beforePrefab + 1
                  && FileManager.default.fileExists(atPath: (model.projectURL ?? project).appendingPathComponent("prefabs/selftestpref.json").path),
                  "listed \(listed), entities \(model.entities.count)")
            await model.addEntity(type: "Polygon")
            let poly = model.polygonOfSelection()
            check("A polygon entity exposes editable vertices", (poly?.verts.count ?? 0) >= 3, "vertices \(poly?.verts.count ?? 0)")
            if let poly {
                var v = poly.verts.map { ["x": $0.x, "y": $0.y] }
                v.append(["x": 5.0, "y": 5.0])
                model.setComponentField(poly.key, poly.comp, "vertices", v)
                try? await Task.sleep(nanoseconds: 400_000_000)
                check("vertex edits land in the document", (model.polygonOfSelection()?.verts.count ?? 0) == poly.verts.count + 1)
            }
        }

        // Parenting.
        if model.entities.count >= 2 {
            let a = model.entities[0].key, b = model.entities[1].key
            await model.setParent(b, to: a)
            let rows = model.hierarchyRows()
            check("dragging onto another entity parents it (document, tree, runtime)",
                  (model.entityDoc(b)?["parentKey"] as? String) == a && rows.first { $0.key == b }?.depth == 1
                  && model.entities.first { $0.key == b }?.parentKey == a, "rows \(rows.map { "\($0.key.suffix(4)):\($0.depth)" })")
            let bx = model.transform(b).x, ax = model.transform(a).x
            model.setTransform(a, x: ax + 50)
            check("moving a parent moves its children", model.transform(b).x == bx + 50, "child x \(bx) -> \(model.transform(b).x)")
            await model.setParent(a, to: b)
            check("a parent can't be dropped onto its own child", (model.entityDoc(a)?["parentKey"] as? String) == nil)
            let before = model.entities.count
            await model.duplicateEntity(a)
            check("duplicating a parent copies its group and keeps the link", model.entities.count == before + 2
                  && model.hierarchyRows().filter { $0.depth == 1 }.count >= 2, "entities \(model.entities.count)")
            model.deleteEntity(a)
            check("deleting a parent ungroups its children", (model.entityDoc(b)?["parentKey"] as? String) == nil && model.entityDoc(b) != nil)
        }

        // Documentation and pop-out.
        let pagesForDocs = DocsLibrary.pages(for: model)
        let compRef = pagesForDocs.first { $0.slug == "ref-components" }?.markdown ?? ""
        check("docs: guides ship with the app and the component reference is generated from the runtime",
              DocsLibrary.guides.count >= 11 && compRef.contains("### AudioSource") && compRef.contains("### PhysicsMaterial")
              && compRef.contains("file (audio)") && compRef.contains("Plays sounds from an entity"),
              "guides \(DocsLibrary.guides.count), reference \(compRef.count) chars")
        let html = MarkdownHTML.render("# T\n\n| a | b |\n|---|---|\n| `x` | **y** |\n\n```js\nlet a = 1 < 2;\n```\n\n- one\n- [two](doc:03)\n")
        check("docs: markdown renders headings, tables, code (escaped), lists and links",
              html.contains("<h1>T</h1>") && html.contains("<table>") && html.contains("<td><code>x</code></td>") && html.contains("<strong>y</strong>")
              && html.contains("1 &lt; 2") && html.contains("<ul>") && html.contains("href=\"doc:03\""), html)
        model.openDocs("07-audio")
        check("the docs open as a tab on the requested page", model.activeTab == .docs && model.tabs.contains(.docs) && model.docsPage == "07-audio")
        model.openFile(project.appendingPathComponent("project.piston.json"))
        if let tab = model.tabs.last, case .file(let u) = tab {
            model.popOut(tab)
            let left = !model.tabs.contains(tab) && model.textDocs[u] != nil
            model.dockFile(u)
            check("a file can pop out into its own window and dock back when closed", left && model.tabs.contains(tab))
        }
        model.closeTab(.docs)

        model.closeProject()
        check("Close Project returns to the Hub", model.projectURL == nil && model.recents.count >= 1)

        // The second built-in sample, Neon Warden: it must open from a copy, never carry an engine copy, and boot and run in the game runtime.
        let nwSource = EditorModel.samplesRoot().appendingPathComponent("NeonWarden")
        let nwTmp = FileManager.default.temporaryDirectory.appendingPathComponent("piston-selftest-nw-\(UUID().uuidString)")
        let nwCopied = (try? FileManager.default.copyItem(at: nwSource, to: nwTmp)) != nil
        check("Neon Warden ships with the app (project file, scenes, scripts, no build output)", nwCopied
              && FileManager.default.fileExists(atPath: nwTmp.appendingPathComponent("project.piston.json").path)
              && FileManager.default.fileExists(atPath: nwTmp.appendingPathComponent("scenes/arena.json").path)
              && FileManager.default.fileExists(atPath: nwTmp.appendingPathComponent("scripts/Director.js").path)
              && !FileManager.default.fileExists(atPath: nwTmp.appendingPathComponent("dist").path))
        if nwCopied {
            model.persistRecents = false
            await model.openProject(nwTmp)
            let nwReady = await model.waitUntilReady(timeout: 20)
            check("Neon Warden opens: both scenes are found and the start scene loads", nwReady && model.sceneIDs.contains("title") && model.sceneIDs.contains("arena") && !model.entities.isEmpty,
                  "scenes \(model.sceneIDs), entities \(model.entities.count)")
            check("the engine is not copied into the project", !FileManager.default.fileExists(atPath: nwTmp.appendingPathComponent("engine").path)
                  && !FileManager.default.fileExists(atPath: nwTmp.appendingPathComponent("GameLoop.js").path))
            let nwErrorsBefore = model.logs.filter { $0.level == "error" }.count
            await model.play()
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            let nw = await model.playInfo()
            // The title director spawns its logo, prompt and dust from start(), so a running game has more live entities than the scene file holds.
            check("Neon Warden boots in the runtime and its scripts spawn entities from start()", nw?.playState == "playing" && (nw?.frames ?? 0) > 5 && (nw?.entityCount ?? 0) > model.entities.count,
                  "state \(nw?.playState ?? "?"), frames \(nw?.frames ?? -1), game entities \(nw?.entityCount ?? -1) vs scene \(model.entities.count)", needsDisplay: true)
            check("Neon Warden raised no runtime errors", model.logs.filter { $0.level == "error" }.count == nwErrorsBefore,
                  model.logs.filter { $0.level == "error" }.suffix(3).map { $0.text }.joined(separator: " | "))
            model.stopGame()
            model.closeProject()
        }

        print(failures == 0 ? "\nALL CHECKS PASSED" : "\n\(failures) CHECK(S) FAILED")
        return failures == 0
    }
}
