import Foundation

struct APIErrorPayload: Decodable {
    let code: String
    let message: String
    let requestId: String?
}

enum APIError: LocalizedError {
    case invalidConfiguration
    case invalidResponse
    case server(status: Int, payload: APIErrorPayload?)
    case transport(Error)
    case decoding(Error)

    var errorDescription: String? {
        switch self {
        case .invalidConfiguration: "API設定を確認してください。"
        case .invalidResponse: "サーバーから不正な応答が届きました。"
        case let .server(_, payload): payload?.message ?? "通信に失敗しました。"
        case .transport: "ネットワークに接続できませんでした。"
        case .decoding: "受信したデータを読み取れませんでした。"
        }
    }
}
