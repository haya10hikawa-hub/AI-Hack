import SwiftUI

extension View {
    @ViewBuilder
    func memoryTransitionSource(id: String, in namespace: Namespace.ID, enabled: Bool) -> some View {
        if #available(iOS 18.0, *), enabled { matchedTransitionSource(id: id, in: namespace) }
        else { self }
    }

    @ViewBuilder
    func memoryNavigationTransition(id: String, in namespace: Namespace.ID, enabled: Bool) -> some View {
        if #available(iOS 18.0, *), enabled { navigationTransition(.zoom(sourceID: id, in: namespace)) }
        else { self }
    }
}
