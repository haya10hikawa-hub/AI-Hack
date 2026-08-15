import SwiftUI

struct RecallView: View {
    @StateObject private var model: RecallViewModel
    @Namespace private var transitionNamespace
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let configurationError: String?
    init(api: APIClient?, configurationError: String?) { _model = StateObject(wrappedValue: RecallViewModel(api: api)); self.configurationError = configurationError }

    var body: some View {
        Group {
            switch model.result.answerState {
            case .idle: ContentUnavailableView("思い出を探す", systemImage: "sparkle.magnifyingglass", description: Text(configurationError ?? "場所や出来事を入力してください"))
            case .loading: ProgressView("探しています")
            case .error: ContentUnavailableView("検索できません", systemImage: "exclamationmark.triangle", description: Text(model.result.clarification ?? "もう一度お試しください"))
            case .unknown: ContentUnavailableView("見つかりませんでした", systemImage: "questionmark", description: Text(model.result.clarification ?? "別の言葉でお試しください"))
            case .strong:
                ScrollView { LazyVStack(alignment: .leading, spacing: 20) {
                    if let answer = model.result.answer { Text(answer).font(.title3) }
                    if let clarification = model.result.clarification { Text(clarification).foregroundStyle(.secondary) }
                    if let memory = model.result.candidates.first {
                        NavigationLink(value: memory.id) { MemoryThumbnail(memory: memory, style: .focus) }
                            .buttonStyle(.plain)
                            .memoryTransitionSource(id: memory.id, in: transitionNamespace, enabled: !reduceMotion)
                            .frame(maxWidth: 520).frame(maxWidth: .infinity)
                    }
                }.padding(.horizontal).padding(.bottom) }
            case .ambiguous:
                ScrollView { LazyVStack(alignment: .leading, spacing: 18) {
                    if let prompt = model.result.clarification ?? model.result.answer { Text(prompt).font(.title3) }
                    ForEach(model.result.candidates.prefix(3)) { memory in
                        NavigationLink(value: memory.id) {
                            HStack(spacing: 14) {
                                RemotePhoto(photo: memory.heroPhotos.first).frame(width: 112, height: 88).clipShape(RoundedRectangle(cornerRadius: 3))
                                VStack(alignment: .leading, spacing: 5) { Text(memory.title).font(.headline); if let date = memory.date { Text(date, style: .date).font(.caption).foregroundStyle(.secondary) } }
                                Spacer(minLength: 0)
                            }
                        }.buttonStyle(.plain)
                    }
                }.padding() }
            }
        }
        .navigationTitle("Recall")
        .navigationDestination(for: String.self) {
            MemoryView(memoryId: $0, api: model.api, transitionNamespace: transitionNamespace,
                       transitionEnabled: !reduceMotion && model.result.answerState == .strong)
        }
        .searchable(text: $model.query, prompt: "いつ、どこで、何をした？")
        .onSubmit(of: .search) { Task { await model.search() } }
    }
}
