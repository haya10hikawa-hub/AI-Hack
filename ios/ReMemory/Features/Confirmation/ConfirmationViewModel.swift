import Combine
import Foundation

@MainActor
final class ConfirmationViewModel: ObservableObject {
    @Published var correcting = false
    @Published var correction = ""
    @Published var state: ConfirmationViewState = .idle
    @Published var error: String?
    private let item: ConfirmationPresentation
    private let api: APIClient?

    init(item: ConfirmationPresentation, api: APIClient?) { self.item = item; self.api = api }

    func save() async -> Bool {
        guard let api else { state = .error; error = "API設定を確認してください。"; return false }
        let text = correction.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !correcting || !text.isEmpty, text.count <= 500 else {
            state = .error; error = "修正内容は1〜500文字で入力してください。"; return false
        }
        state = .saving
        do {
            let decision: ConfirmationDecisionDTO = correcting ? .correct(text) : .confirm
            _ = try await api.post(.confirm(item.id), body: decision, as: ConfirmationResultDTO.self)
            state = .saved; error = nil; return true
        } catch let APIError.server(status, payload) where status == 409 && payload?.code == "GAP_NOT_ANSWERABLE" {
            state = .resolved; error = nil; return true
        } catch {
            state = .error; self.error = error.localizedDescription; return false
        }
    }
}
