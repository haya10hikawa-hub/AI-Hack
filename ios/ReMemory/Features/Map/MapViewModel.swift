import Combine
import Foundation

@MainActor
final class MapViewModel: ObservableObject {
    @Published var map = MemoryMapPresentation()
    @Published var state: MemoriesViewState = .idle
    @Published var error: String?
    let api: APIClient?

    init(api: APIClient?) { self.api = api }

    func load() async {
        guard let api else { state = .error; return }
        state = .loading
        async let mapRequest = Self.fetchMap(api)
        async let memoriesRequest = Self.fetchMemories(api)
        let (mapResult, memoriesResult) = await (mapRequest, memoriesRequest)
        switch mapResult {
        case let .success(response):
            let memories = (try? memoriesResult.get())?.memories ?? []
            map = PresentationMapper.memoryMap(response, memories: memories)
            state = map.isEmpty ? .empty : .success
            error = memoriesResult.failure?.localizedDescription
        case let .failure(failure):
            state = .error
            error = failure.localizedDescription
        }
    }

    private static func fetchMap(_ api: APIClient) async -> Result<MemoryMapDTO, Error> {
        do { return .success(try await api.get(.map)) } catch { return .failure(error) }
    }

    private static func fetchMemories(_ api: APIClient) async -> Result<MemoryThreadDTO, Error> {
        do { return .success(try await api.get(.memories)) } catch { return .failure(error) }
    }
}

private extension Result {
    var failure: Failure? { if case let .failure(error) = self { error } else { nil } }
}
