import Foundation

protocol AuthProviding { func accessToken() async throws -> String }

struct EnvironmentAuthProvider: AuthProviding {
    func accessToken() async throws -> String {
        guard let token = ProcessInfo.processInfo.environment["REMEMORY_OAUTH_TOKEN"], !token.isEmpty else {
            throw APIError.invalidConfiguration
        }
        return token
    }
}
