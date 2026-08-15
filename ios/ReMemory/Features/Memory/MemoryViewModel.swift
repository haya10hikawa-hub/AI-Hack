import Combine
import Foundation

@MainActor
final class MemoryViewModel: ObservableObject {
    @Published var memory: MemoryPresentation?
    @Published var confirmation: ConfirmationPresentation?
    @Published var state: MemoryViewState = .loading
    @Published var error: String?
    private let memoryId: String
    let api: APIClient?
    init(memoryId: String, api: APIClient?) { self.memoryId = memoryId; self.api = api }

    func load() async {
        guard let api else { state = .error; return }
        state = .loading
        do {
            async let detail: MemoryDetailDTO = api.get(.memory(memoryId))
            async let queue: ConfirmationQueueDTO = api.get(.confirmations)
            let value = try await detail
            memory = PresentationMapper.memory(value)
            confirmation = PresentationMapper.confirmations(try await queue).first { $0.memoryId == memoryId }
            state = value.partial == true ? .partial : .success; error = nil
        } catch { state = .error; self.error = error.localizedDescription }
    }
}
