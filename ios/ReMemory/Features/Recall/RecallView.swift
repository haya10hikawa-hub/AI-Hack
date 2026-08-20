import SwiftUI

struct RecallView: View {
    @StateObject private var model: RecallViewModel
    @State private var path: [String] = []
    @Namespace private var transitionNamespace
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let configurationError: String?

    init(api: APIClient?, configurationError: String?) {
        _model = StateObject(wrappedValue: RecallViewModel(api: api)); self.configurationError = configurationError
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
                .searchable(text: $model.query, prompt: "いつ、どこで、何をした？")
                .onSubmit(of: .search) {
                    if PreviewFixtures.isEnabled { model.result = PreviewFixtures.recall(query: model.query) }
                    else { Task { await model.search() } }
                }
                .task {
                    switch PreviewFixtures.route {
                    case .recallStrong: model.result = PreviewFixtures.recall(query: "湖")
                    case .recallAmbiguous: model.result = PreviewFixtures.recall(query: "候補")
                    default: break
                    }
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch result.answerState {
        case .idle:
            ContentUnavailableView("思い出をたどる", systemImage: "sparkle.magnifyingglass",
                                   description: Text(idleDescription))
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .error:
            ContentUnavailableView("いま探せません", systemImage: "exclamationmark.triangle",
                                   description: Text(result.clarification ?? "もう一度お試しください"))
        case .unknown:
            ContentUnavailableView("まだ浮かんできません", systemImage: "questionmark",
                                   description: Text(result.clarification ?? "別の言葉でお試しください"))
        case .strong, .ambiguous:
            focus
        }
    }

    private var focus: some View {
        ZStack {
            RecallFocusBackground(photo: candidates.first?.heroPhotos.first)
            RecallFocusCard(candidates: candidates, namespace: transitionNamespace,
                            transitionEnabled: !reduceMotion) { path.append($0.id) }
                .padding(.vertical, 44)
        }
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .preferredColorScheme(.dark)
    }

    private var candidates: [MemoryPresentation] {
        result.answerState == .strong ? Array(result.candidates.prefix(1)) : Array(result.candidates.prefix(3))
    }

    private var idleDescription: String {
        PreviewFixtures.isEnabled ? "場所や出来事を入力してください" : configurationError ?? "場所や出来事を入力してください"
    }

    private var result: RecallPresentation { model.result }
}
