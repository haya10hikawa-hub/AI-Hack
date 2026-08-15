import SwiftUI

struct MemoryView: View {
    @StateObject private var model: MemoryViewModel
    @State private var showingConfirmation = false
    private let memoryId: String
    private let transitionNamespace: Namespace.ID
    private let transitionEnabled: Bool
    init(memoryId: String, api: APIClient?, transitionNamespace: Namespace.ID, transitionEnabled: Bool) {
        self.memoryId = memoryId; self.transitionNamespace = transitionNamespace; self.transitionEnabled = transitionEnabled
        _model = StateObject(wrappedValue: MemoryViewModel(memoryId: memoryId, api: api))
    }

    var body: some View {
        Group {
            if let memory = model.memory {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        MemoryPhotoComposition(photos: memory.heroPhotos)
                        VStack(alignment: .leading, spacing: 7) {
                            Text(memory.title).font(.largeTitle.bold())
                            HStack { if let date = memory.date { Text(date, style: .date) }; if let place = memory.place { Text(place) } }
                                .font(.subheadline).foregroundStyle(.secondary)
                        }.padding(.horizontal).padding(.top, 22)
                        VStack(alignment: .leading, spacing: 20) {
                            if let summary = memory.summary { Text(summary).font(.title3).lineSpacing(5) }
                            if let opening = memory.memoryContent.first { Text(opening.text).lineSpacing(4) }
                        }.padding(.horizontal).padding(.top, 24)
                        if !memory.supportingPhotos.isEmpty {
                            SupportingPhotoGrid(photos: memory.supportingPhotos).padding(.top, 26)
                        }
                        if memory.memoryContent.count > 1 || !memory.relatedMemories.isEmpty {
                            VStack(alignment: .leading, spacing: 22) {
                                ForEach(memory.memoryContent.dropFirst()) { content in Text(content.text).lineSpacing(4) }
                                if !memory.relatedMemories.isEmpty {
                                    Text("Continue remembering").font(.headline).padding(.top, 8)
                                    ForEach(memory.relatedMemories) { related in
                                        NavigationLink(value: related.id) {
                                            HStack(spacing: 12) { RemotePhoto(photo: related.photo).frame(width: 96, height: 72); Text(related.title).font(.headline) }
                                        }.buttonStyle(.plain)
                                    }
                                }
                            }.padding(.horizontal).padding(.vertical, 26)
                        }
                    }
                }
                .toolbar { if model.confirmation != nil { ToolbarItem(placement: .topBarTrailing) { Button("Confirm") { showingConfirmation = true } } } }
            } else if let error = model.error { ContentUnavailableView("読み込めません", systemImage: "exclamationmark.triangle", description: Text(error)) }
            else { ProgressView() }
        }
        .navigationBarTitleDisplayMode(.inline)
        .memoryNavigationTransition(id: memoryId, in: transitionNamespace, enabled: transitionEnabled)
        .sheet(isPresented: $showingConfirmation) {
            if let confirmation = model.confirmation { ConfirmationView(item: confirmation, api: model.api) { Task { await model.load() } } }
        }
        .task { await model.load() }
    }
}
