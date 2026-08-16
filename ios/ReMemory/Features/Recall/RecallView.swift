import SwiftUI

struct RecallView: View {
    @StateObject private var model: RecallViewModel
    private let configurationError: String?
    init(api: APIClient?, configurationError: String?) { _model = StateObject(wrappedValue: RecallViewModel(api: api)); self.configurationError = configurationError }

    var body: some View {
        Group {
            switch model.result.answerState {
            case .idle: ContentUnavailableView("思い出を探す", systemImage: "sparkle.magnifyingglass", description: Text(configurationError ?? "場所や出来事を入力してください"))
            case .loading: ProgressView("探しています")
            case .error: ContentUnavailableView("検索できません", systemImage: "exclamationmark.triangle", description: Text(model.result.clarification ?? "もう一度お試しください"))
            case .unknown: ContentUnavailableView("見つかりませんでした", systemImage: "questionmark", description: Text(model.result.clarification ?? "別の言葉でお試しください"))
            case .strong, .ambiguous:
                ScrollView { LazyVStack(alignment: .leading, spacing: 20) {
                    if let answer = model.result.answer { Text(answer).font(.title3) }
                    if let clarification = model.result.clarification { Text(clarification).foregroundStyle(.secondary) }
                    ForEach(model.result.candidates) { memory in NavigationLink(value: memory.id) { MemoryThumbnail(memory: memory) }.buttonStyle(.plain) }
                }.padding() }
            }
        }
        .navigationTitle("Recall")
        .navigationDestination(for: String.self) { MemoryView(memoryId: $0, api: model.api) }
        .searchable(text: $model.query, prompt: "いつ、どこで、何をした？")
        .onSubmit(of: .search) { Task { await model.search() } }
    }
}
