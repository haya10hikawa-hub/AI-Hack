import SwiftUI

struct MemoriesView: View {
    @StateObject private var model: MemoriesViewModel
    @State private var showingUpload = false
    private let configurationError: String?
    private let columns = [GridItem(.adaptive(minimum: 150), spacing: 14)]

    init(api: APIClient?, configurationError: String?) {
        _model = StateObject(wrappedValue: MemoriesViewModel(api: api)); self.configurationError = configurationError
    }

    var body: some View {
        Group {
            if model.state == .loading && model.memories.isEmpty { ProgressView("Memoriesを読み込み中") }
            else if let message = model.error ?? configurationError, model.memories.isEmpty { ContentUnavailableView("読み込めません", systemImage: "exclamationmark.triangle", description: Text(message)) }
            else if model.memories.isEmpty { ContentUnavailableView("まだMemoryがありません", systemImage: "photo.on.rectangle") }
            else {
                ScrollView {
                    LazyVGrid(columns: columns, alignment: .leading, spacing: 22) {
                        ForEach(model.memories) { memory in
                            NavigationLink(value: memory.id) { MemoryThumbnail(memory: memory) }.buttonStyle(.plain)
                        }
                    }.padding()
                }.refreshable { await model.load() }
            }
        }
        .navigationTitle("Memories")
        .navigationDestination(for: String.self) { MemoryView(memoryId: $0, api: model.api) }
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Add Photos", systemImage: "plus") { showingUpload = true }.disabled(model.api == nil) } }
        .sheet(isPresented: $showingUpload, onDismiss: { Task { await model.load() } }) { UploadView(api: model.api) }
        .task { await model.load() }
    }
}
