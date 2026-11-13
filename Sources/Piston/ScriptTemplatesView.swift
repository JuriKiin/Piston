import SwiftUI

struct ScriptSheetRequest: Identifiable {
    let id = UUID()
    let kind: ScriptKind
    let directory: URL
}

/// New Entity / Component Script: pick a template, name it, and Piston writes the class, registers it with the engine
/// (an import in your entry module, so exported builds include it) and can drop an instance into the scene.
struct NewScriptSheet: View {
    @ObservedObject var model: EditorModel
    let request: ScriptSheetRequest
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var selected: String
    @State private var addToScene = true
    @State private var error: String?

    init(model: EditorModel, request: ScriptSheetRequest) {
        self.model = model
        self.request = request
        _selected = State(initialValue: ScriptTemplates.defaultTemplate(for: request.kind).id)
        _name = State(initialValue: request.kind == .entity ? "MyEntity" : "MyComponent")
    }

    private var templates: [ScriptTemplate] { ScriptTemplates.templates(for: request.kind) }
    private var className: String { EditorModel.identifier(from: name) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(request.kind == .entity ? "New Entity Script" : "New Component Script").font(.title2.weight(.semibold))

            VStack(alignment: .leading, spacing: 6) {
                Text("Template").font(.caption).foregroundStyle(.secondary)
                ForEach(templates) { t in
                    Button { selected = t.id } label: {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: selected == t.id ? "largecircle.fill.circle" : "circle")
                                .foregroundStyle(selected == t.id ? Color.accentColor : .secondary)
                            VStack(alignment: .leading, spacing: 1) {
                                HStack(spacing: 6) {
                                    Text(t.name).font(.callout.weight(.semibold))
                                    if t.isUser { Text("yours").font(.caption2).foregroundStyle(.orange) }
                                }
                                Text(t.summary).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(8)
                        .background(selected == t.id ? Color.accentColor.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Name").font(.caption).foregroundStyle(.secondary)
                TextField("Name", text: $name).textFieldStyle(.roundedBorder)
                Text("Class \(className) in \((request.directory.path as NSString).lastPathComponent)/ · imported by your entry module so builds include it")
                    .font(.caption2).foregroundStyle(.tertiary)
            }

            if request.kind == .entity {
                Toggle("Add one to the current scene", isOn: $addToScene)
            }
            if let error { Text(error).font(.caption).foregroundStyle(.red) }

            HStack {
                Text("Add your own templates in ~/Library/Application Support/Piston/Templates/Scripts")
                    .font(.caption2).foregroundStyle(.tertiary)
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Create") { create() }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(22)
        .frame(width: 520)
    }

    private func create() {
        guard let template = templates.first(where: { $0.id == selected }) else { return }
        do {
            let url = try model.createScript(template: template, name: name, in: request.directory)
            if request.kind == .entity && addToScene { model.pendingAdd = url.deletingPathExtension().lastPathComponent }
            model.openFile(url)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// The "+" menu in the Hierarchy header: adds a prefab or an instance of any registered entity type to the scene.
struct HierarchyAddMenu: View {
    @ObservedObject var model: EditorModel

    var body: some View {
        Menu {
            let prefabs = model.loadPrefabList()
            if !prefabs.isEmpty {
                Section("Prefabs") {
                    ForEach(prefabs) { p in Button(p.name) { Task { await model.addPrefab(p.id) } } }
                }
            }
            let groups = Dictionary(grouping: model.entityTypes, by: \.group)
            ForEach(groups.keys.sorted { ($0 == "engine" ? 1 : 0, $0) < ($1 == "engine" ? 1 : 0, $1) }, id: \.self) { group in
                Section(group == "engine" ? "Engine" : group) {
                    ForEach((groups[group] ?? []).sorted { $0.name < $1.name }, id: \.self) { type in
                        Button(type.name) { Task { await model.addEntity(type: type.name) } }
                    }
                }
            }
        } label: {
            Image(systemName: "plus")
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .disabled(model.entityTypes.isEmpty)
        .help("Add an entity to the scene")
    }
}
