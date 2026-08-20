import SwiftUI

struct MemoriesView: View {
    @StateObject private var model: MemoriesViewModel
    @State private var showingUpload = false
    @State private var path: [String] = []
    // Held here, not in the deck, so coming back from a Memory lands on the same month and event.
    @State private var selectedMonthID = ""
    @State private var selectedMemoryID: String?
    @Namespace private var transitionNamespace
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let configurationError: String?

    init(api: APIClient?, configurationError: String?) {
        _model = StateObject(wrappedValue: MemoriesViewModel(api: api)); self.configurationError = configurationError
    }

    var body: some View {
        NavigationStack(path: $path) {
            content
                .navigationTitle("")
                .navigationBarTitleDisplayMode(.inline)
                .navigationDestination(for: String.self) {
                    MemoryView(memoryId: $0, api: model.api, transitionNamespace: transitionNamespace,
                               transitionEnabled: !reduceMotion)
                }
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Add Photos", systemImage: "plus") { showingUpload = true }
                            .labelStyle(.iconOnly)
                            .disabled(model.api == nil)
                    }
                }
                .sheet(isPresented: $showingUpload, onDismiss: { Task { await model.load() } }) { UploadView(api: model.api) }
                .task {
                    if !PreviewFixtures.isEnabled { await model.load() }
                    if let route = PreviewFixtures.route, route != .stacks, !route.isRecall {
                        path = [PreviewFixtures.memory.id]
                    }
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        if model.state == .loading && memories.isEmpty {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).background(MemoryDepth.canvas)
        } else if let message = visibleError, memories.isEmpty {
            ContentUnavailableView("読み込めません", systemImage: "exclamationmark.triangle", description: Text(message))
        } else if memories.isEmpty {
            ContentUnavailableView("まだMemoryがありません", systemImage: "photo.on.rectangle")
        } else {
            MonthEventDeck(sections: sections,
                           selectedMonthID: $selectedMonthID,
                           selectedMemoryID: $selectedMemoryID,
                           namespace: transitionNamespace,
                           transitionEnabled: !reduceMotion) { memory in
                selectedMemoryID = memory.id
                path.append(memory.id)
            }
            .onAppear { alignSelection() }
            .onChange(of: sections.map(\.id)) { _, _ in alignSelection() }
            .refreshable { if !PreviewFixtures.isEnabled { await model.load() } }
        }
    }

    /// Keep the stored selection pointing at rows that still exist once data arrives or refreshes.
    private func alignSelection() {
        guard let current = sections.first(where: { $0.id == selectedMonthID }) ?? sections.first else { return }
        if selectedMonthID != current.id { selectedMonthID = current.id }
        if selectedMemoryID == nil || !current.memories.contains(where: { $0.id == selectedMemoryID }) {
            selectedMemoryID = current.memories.first?.id
        }
    }

    private var memories: [MemoryPresentation] { PreviewFixtures.isEnabled ? PreviewFixtures.memories : model.memories }
    private var sections: [MemoryMonthSection] { MemoryMonthBuilder.sections(from: memories) }
    private var visibleError: String? { PreviewFixtures.isEnabled ? nil : model.error ?? configurationError }
}
