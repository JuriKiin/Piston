import SwiftUI
import AppKit

/// Play / Pause / Step / Stop. The game runs in its OWN runtime instance (`playHost`), built from a
/// snapshot of the editor's current document; Stop throws it away. Nothing the game does can reach the
/// document or the Scene view (PISTON_SPEC §4).
extension EditorModel {
    func handlePlayEvent(_ event: [String: Any]) {
        switch event["type"] as? String {
        case "ready":
            playReady = true
        case "log":
            logs.append(LogLine(level: event["level"] as? String ?? "log", text: event["text"] as? String ?? "", source: "game"))
        case "error":
            let src = (event["source"] as? String).map { " (\($0):\(event["line"] ?? "?"))" } ?? ""
            logs.append(LogLine(level: "error", text: (event["message"] as? String ?? "error") + src, source: "game"))
        default:
            break
        }
        if logs.count > 500 { logs.removeFirst(logs.count - 500) }
    }

    private func waitPlayReady(timeout: Double) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if playReady { return true }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        return playReady
    }

    /// Starts a fresh game instance (from Stopped) or resumes (from Paused).
    func play() async {
        switch playState {
        case .playing:
            return
        case .paused:
            do { try await playHost.request("play"); playState = .playing; status = "Playing" } catch { status = "Play failed: \(error.localizedDescription)" }
        case .stopped:
            guard await launchGame() else { return }
            do {
                try await playHost.request("play")
                playState = .playing
                status = "Playing \(currentScene ?? "")"
                focusGame()
            } catch { status = "Play failed: \(error.localizedDescription)" }
        }
    }

    func pause() async {
        guard playState == .playing else { return }
        do { try await playHost.request("pause"); playState = .paused; status = "Paused" } catch { status = "Pause failed: \(error.localizedDescription)" }
    }

    /// Advances exactly one simulation frame. From Stopped it starts a game paused at frame 0 first.
    func step() async {
        if playState == .stopped {
            guard await launchGame() else { return }
            try? await playHost.request("pause") // paused before any simulation runs
            playState = .paused
        }
        if playState == .playing { await pause() }
        if playState == .paused {
            do { try await playHost.request("step"); status = "Stepped one frame" } catch { status = "Step failed: \(error.localizedDescription)" }
        }
    }

    /// Discards the game instance entirely: a fresh Play starts from the document again.
    func stopGame() {
        guard playState != .stopped || playReady else { return }
        playState = .stopped
        playReady = false
        playHost.webView.load(URLRequest(url: URL(string: "about:blank")!))
        if activeTab == .game { activeTab = .scene }
        status = "Stopped"
    }

    /// Loads the game page, waits for it, and builds the scene from the editor's current document.
    private func launchGame() async -> Bool {
        guard !doc.isEmpty, let url = pageURL("play.html") else { status = "Open a scene first"; return false }
        playReady = false
        playHost.load(url)
        guard await waitPlayReady(timeout: 15) else { status = "Game runtime failed to start"; return false }
        do {
            try await playHost.request("loadScene", ["data": doc, "sceneId": currentScene ?? ""])
        } catch {
            status = "Couldn't load scene into game: \(error.localizedDescription)"
            return false
        }
        activeTab = .game
        return true
    }

    func focusGame() {
        Task {
            try? await Task.sleep(nanoseconds: 150_000_000)
            playHost.webView.window?.makeFirstResponder(playHost.webView)
        }
    }

    func playInfo() async -> PlayInfo? {
        guard let r = try? await playHost.request("getPlayInfo") as? [String: Any] else { return nil }
        return PlayInfo(playState: r["playState"] as? String ?? "?",
                        frames: (r["frames"] as? NSNumber)?.intValue ?? -1,
                        entityCount: (r["entityCount"] as? NSNumber)?.intValue ?? -1,
                        scene: r["scene"] as? String,
                        mouseDowns: (r["mouseDowns"] as? NSNumber)?.intValue ?? -1)
    }
}
