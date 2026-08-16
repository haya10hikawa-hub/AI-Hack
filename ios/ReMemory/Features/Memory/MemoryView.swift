import SwiftUI

struct MemoryView: View {
    @StateObject private var model: MemoryViewModel
    @State private var showingConfirmation = false
    init(memoryId: String, api: APIClient?) { _model = StateObject(wrappedValue: MemoryViewModel(memoryId: memoryId, api: api)) }

    var body: some View {
        Group {
            if let memory = model.memory {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 26) {
                        MemoryPhotoComposition(photos: memory.heroPhotos)
                        VStack(alignment: .leading, spacing: 7) {
                            Text(memory.title).font(.largeTitle.bold())
                            HStack { if let date = memory.date { Text(date, style: .date) }; if let place = memory.place { Text(place) } }
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                        if let summary = memory.summary { Text(summary).font(.title3).lineSpacing(5) }
                        ForEach(memory.memoryContent) { content in Text(content.text).lineSpacing(4) }
                        if !memory.supportingPhotos.isEmpty { SupportingPhotoGrid(photos: memory.supportingPhotos) }
                        if !memory.relatedMemories.isEmpty {
                            Text("Continue remembering").font(.headline)
                            ForEach(memory.relatedMemories) { related in
                                NavigationLink(value: related.id) { HStack { RemotePhoto(photo: related.photo).frame(width: 90, height: 70); Text(related.title) } }.buttonStyle(.plain)
                            }
                        }
                    }.padding()
                }
                .toolbar { if model.confirmation != nil { ToolbarItem(placement: .topBarTrailing) { Button("Confirm") { showingConfirmation = true } } } }
            } else if let error = model.error { ContentUnavailableView("読み込めません", systemImage: "exclamationmark.triangle", description: Text(error)) }
            else { ProgressView() }
        }
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showingConfirmation) {
            if let confirmation = model.confirmation { ConfirmationView(item: confirmation, api: model.api) { Task { await model.load() } } }
        }
        .task { await model.load() }
    }
}
