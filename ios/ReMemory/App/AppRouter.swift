import SwiftUI

@MainActor
final class AppRouter: ObservableObject {
    let api: APIClient?
    @Published var configurationError: String?

    init() {
        do { api = try APIClient(); configurationError = nil }
        catch { api = nil; configurationError = error.localizedDescription }
    }
}

struct AppRouterView: View {
    @EnvironmentObject private var router: AppRouter
    @State private var tab = Tab.memories

    private enum Tab { case memories, recall }

    var body: some View {
        TabView(selection: $tab) {
            MemoriesView(api: router.api, configurationError: router.configurationError)
                .tabItem { Label("Memories", systemImage: "photo.on.rectangle.angled") }
                .tag(Tab.memories)
            RecallView(api: router.api, configurationError: router.configurationError)
                .tabItem { Label("Recall", systemImage: "sparkle.magnifyingglass") }
                .tag(Tab.recall)
        }
        .onAppear { if PreviewFixtures.route?.isRecall == true { tab = .recall } }
    }
}
