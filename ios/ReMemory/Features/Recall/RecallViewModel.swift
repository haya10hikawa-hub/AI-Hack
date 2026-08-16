import Combine
import Foundation

@MainActor
final class RecallViewModel: ObservableObject {
    @Published var query = ""
    @Published var result = RecallPresentation()
    let api: APIClient?
    init(api: APIClient?) { self.api = api }

    func search() async {
        let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, let api else { return }
        result = RecallPresentation(answerState: .loading)
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyy-MM-dd"
        do {
            let body = SearchRequestDTO(query: value, timezone: TimeZone.current.identifier, currentDate: formatter.string(from: Date()))
            result = PresentationMapper.recall(try await api.post(.search, body: body, as: SearchDTO.self))
        } catch { result = RecallPresentation(answerState: .error, clarification: error.localizedDescription) }
    }
}
