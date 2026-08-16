import SwiftUI

struct ConfirmationView: View {
    let item: ConfirmationPresentation
    let api: APIClient?
    let completed: () -> Void
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: ConfirmationViewModel

    init(item: ConfirmationPresentation, api: APIClient?, completed: @escaping () -> Void) {
        self.item = item; self.api = api; self.completed = completed
        _model = StateObject(wrappedValue: ConfirmationViewModel(item: item, api: api))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(item.memoryTitle) { Text(item.question).font(.title3); if let suggestion = item.suggestion { Text(suggestion).foregroundStyle(.secondary) } }
                Toggle("内容を修正する", isOn: $model.correcting)
                if model.correcting { TextField("正しい内容", text: $model.correction, axis: .vertical).lineLimit(2...5) }
                if let error = model.error { Text(error).foregroundStyle(.red) }
            }
            .navigationTitle("Confirmation").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Dismiss") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Complete") { Task { if await model.save() { completed(); dismiss() } } }
                        .disabled(model.state == .saving || model.correcting && model.correction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}
