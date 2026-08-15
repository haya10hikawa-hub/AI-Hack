import SwiftUI

@main
struct ReMemoryApp: App {
    @StateObject private var router = AppRouter()
    var body: some Scene { WindowGroup { AppRouterView().environmentObject(router) } }
}
