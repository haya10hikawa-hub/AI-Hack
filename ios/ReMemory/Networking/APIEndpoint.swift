import Foundation

enum APIEndpoint {
    case memories, memory(String), confirmations, confirm(String), search, uploadPrepare, uploadComplete

    var path: String {
        switch self {
        case .memories: "/api/memories"
        case let .memory(id): "/api/memories/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)"
        case .confirmations: "/api/gaps"
        case let .confirm(id): "/api/gaps/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)/confirm"
        case .search: "/api/search"
        case .uploadPrepare: "/api/upload/prepare"
        case .uploadComplete: "/api/upload/complete"
        }
    }

    var timeout: TimeInterval {
        switch self { case .search: 60; case .uploadComplete: 300; default: 30 }
    }
}
