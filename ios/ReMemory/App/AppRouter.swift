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

    var body: some View {
        TabView {
            NavigationStack { MemoriesView(api: router.api, configurationError: router.configurationError) }
                .tabItem { Label("Memories", systemImage: "photo.on.rectangle.angled") }
            NavigationStack { RecallView(api: router.api, configurationError: router.configurationError) }
                .tabItem { Label("Recall", systemImage: "sparkle.magnifyingglass") }
        }
    }
}
