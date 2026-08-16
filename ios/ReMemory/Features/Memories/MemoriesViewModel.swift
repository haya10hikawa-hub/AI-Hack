import Combine
import Foundation

@MainActor
final class MemoriesViewModel: ObservableObject {
    @Published var memories: [MemoryPresentation] = []
    @Published var state: MemoriesViewState = .idle
    @Published var error: String?
    let api: APIClient?
    init(api: APIClient?) { self.api = api }

    func load() async {
        guard let api else { state = .error; return }
        state = .loading
        do {
            memories = try await api.get(.memories, as: MemoryThreadDTO.self).memories.map(PresentationMapper.memory)
            state = memories.isEmpty ? .empty : .success; error = nil
        } catch { state = .error; self.error = error.localizedDescription }
    }
}
