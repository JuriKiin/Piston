import SwiftUI
import AppKit

/// The first thing you see: start a project or pick up where you left off (Unity Hub / Godot's project list).
struct HubView: View {
    @ObservedObject var model: EditorModel

    var body: some View {
        HStack(spacing: 0) {
            brand
                .frame(width: 330)
            Divider()
            recents
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var brand: some View {
        VStack(alignment: .leading, spacing: 14) {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .frame(width: 84, height: 84)
            Text("Piston")
                .font(.system(size: 38, weight: .bold, design: .rounded))
            Text("Build 2D games and ship them to the web.")
                .foregroundStyle(.secondary)
            Spacer().frame(height: 10)
            Button { model.showNewProject = true } label: {
                Label("New Project", systemImage: "plus.square.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .keyboardShortcut("n")
            Button { model.chooseAndOpenProject() } label: {
                Label("Open Project…", systemImage: "folder").frame(maxWidth: .infinity)
            }
            .controlSize(.large)
            Button { Task { await model.openSample("MiniGolf") } } label: {
                Label("Open Sample: Mini Golf", systemImage: "flag")
            }
            .buttonStyle(.link)
            .padding(.top, 4)
            Spacer()
            Text("Engine \(model.engineVersion) · Web")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(32)
        .frame(maxHeight: .infinity, alignment: .topLeading)
    }

    private var recents: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Recent Projects").font(.headline)
            if model.recents.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "tray").font(.system(size: 34)).foregroundStyle(.tertiary)
                    Text("No projects yet").foregroundStyle(.secondary)
                    Text("Create one, or open the Mini Golf sample to look around.")
                        .font(.caption).foregroundStyle(.tertiary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(model.recents) { r in
                        RecentRow(recent: r, model: model)
                    }
                }
                .listStyle(.inset)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct RecentRow: View {
    let recent: RecentProject
    @ObservedObject var model: EditorModel

    private var exists: Bool { FileManager.default.fileExists(atPath: recent.path) }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "shippingbox.fill")
                .font(.title2)
                .foregroundStyle(exists ? Color.accentColor : Color.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(recent.name).font(.body.weight(.semibold))
                Text((recent.path as NSString).abbreviatingWithTildeInPath)
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
            }
            Spacer()
            if !exists { Text("Missing").font(.caption2).foregroundStyle(.red) }
            Text(recent.platform.capitalized)
                .font(.caption2.weight(.semibold))
                .padding(.horizontal, 7).padding(.vertical, 2)
                .background(Color.accentColor.opacity(0.15), in: Capsule())
            Text(recent.opened, style: .relative)
                .font(.caption).foregroundStyle(.tertiary).frame(width: 90, alignment: .trailing)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { model.open(recent) }
        .contextMenu {
            Button("Open") { model.open(recent) }.disabled(!exists)
            Button("Reveal in Finder") { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: recent.path)]) }.disabled(!exists)
            Divider()
            Button("Remove from List") { model.removeRecent(recent) }
        }
    }
}

/// New Project: name, location, platform. (Android joins the list when its runtime exists.)
struct NewProjectSheet: View {
    @ObservedObject var model: EditorModel
    @State private var name = "My Game"
    @State private var location = EditorModel.defaultProjectsDirectory
    @State private var platform = "web"
    @State private var error: String?
    @State private var creating = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("New Project").font(.title2.weight(.semibold))

            VStack(alignment: .leading, spacing: 4) {
                Text("Name").font(.caption).foregroundStyle(.secondary)
                TextField("My Game", text: $name).textFieldStyle(.roundedBorder)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Location").font(.caption).foregroundStyle(.secondary)
                HStack {
                    Text((location.path as NSString).abbreviatingWithTildeInPath)
                        .lineLimit(1).truncationMode(.middle)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(6)
                        .glassCard(cornerRadius: 6)
                    Button("Choose…") { choose() }
                }
                Text("Creates \((location.appendingPathComponent(name.isEmpty ? "…" : name).path as NSString).abbreviatingWithTildeInPath)")
                    .font(.caption2).foregroundStyle(.tertiary).lineLimit(1).truncationMode(.middle)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Platform").font(.caption).foregroundStyle(.secondary)
                HStack(spacing: 10) {
                    PlatformChip(title: "Web", subtitle: "HTML5 canvas", icon: "globe", selected: platform == "web", enabled: true) { platform = "web" }
                    PlatformChip(title: "Android", subtitle: "Coming soon", icon: "iphone.gen3", selected: false, enabled: false) {}
                }
            }

            if let error { Text(error).font(.caption).foregroundStyle(.red) }

            HStack {
                Spacer()
                Button("Cancel") { model.showNewProject = false }.keyboardShortcut(.cancelAction)
                Button("Create") { create() }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || creating)
            }
        }
        .padding(24)
        .frame(width: 460)
    }

    private func choose() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.directoryURL = location
        if panel.runModal() == .OK, let url = panel.url { location = url }
    }

    private func create() {
        creating = true
        error = nil
        Task {
            do {
                try await model.createProject(name: name, in: location)
                model.showNewProject = false
            } catch {
                self.error = error.localizedDescription
            }
            creating = false
        }
    }
}

struct PlatformChip: View {
    let title: String
    let subtitle: String
    let icon: String
    let selected: Bool
    let enabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.title3)
                VStack(alignment: .leading, spacing: 0) {
                    Text(title).font(.callout.weight(.semibold))
                    Text(subtitle).font(.caption2).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .padding(10)
            .frame(maxWidth: .infinity)
            .glassCard(cornerRadius: 8, tint: selected ? Color.accentColor.opacity(0.25) : nil)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected ? Color.accentColor : Color.secondary.opacity(0.3), lineWidth: selected ? 2 : 1))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.5)
    }
}
