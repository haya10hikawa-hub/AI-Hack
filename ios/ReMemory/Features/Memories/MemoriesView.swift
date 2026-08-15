import SwiftUI

struct MemoriesView: View {
    @StateObject private var model: MemoriesViewModel
    @State private var showingUpload = false
    @Namespace private var transitionNamespace
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let configurationError: String?

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
                    LazyVStack(alignment: .leading, spacing: 28) {
                        ForEach(Array(stride(from: 0, to: model.memories.count, by: 3)), id: \.self) { index in
                            memoryLink(model.memories[index], style: .large)
                            if index + 1 < model.memories.count {
                                HStack(alignment: .top, spacing: 12) {
                                    memoryLink(model.memories[index + 1], style: .small)
                                    if index + 2 < model.memories.count { memoryLink(model.memories[index + 2], style: .small) }
                                    else { Spacer(minLength: 0) }
                                }
                            }
                        }
                    }.padding(.horizontal).padding(.bottom)
                }.refreshable { await model.load() }
            }
        }
        .navigationTitle("Memories")
        .navigationDestination(for: String.self) {
            MemoryView(memoryId: $0, api: model.api, transitionNamespace: transitionNamespace, transitionEnabled: !reduceMotion)
        }
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Add Photos", systemImage: "plus") { showingUpload = true }.disabled(model.api == nil) } }
        .sheet(isPresented: $showingUpload, onDismiss: { Task { await model.load() } }) { UploadView(api: model.api) }
        .task { await model.load() }
    }

    private func memoryLink(_ memory: MemoryPresentation, style: MemoryThumbnail.Style) -> some View {
        NavigationLink(value: memory.id) { MemoryThumbnail(memory: memory, style: style) }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity, alignment: .leading)
            .memoryTransitionSource(id: memory.id, in: transitionNamespace, enabled: !reduceMotion)
    }
}
