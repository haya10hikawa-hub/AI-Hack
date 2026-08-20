import Foundation

struct APIClient {
    let baseURL: URL
    let auth: any AuthProviding
    private let session: URLSession

    init(environment: [String: String] = ProcessInfo.processInfo.environment,
         auth: any AuthProviding = EnvironmentAuthProvider(), session: URLSession = .shared) throws {
        guard let raw = environment["REMEMORY_API_BASE_URL"], let url = URL(string: raw),
              url.scheme == "https" || url.scheme == "http" else {
            throw APIError.invalidConfiguration
        }
        baseURL = url; self.auth = auth; self.session = session
    }

    func get<T: Decodable>(_ endpoint: APIEndpoint, as type: T.Type = T.self) async throws -> T {
        try await request(endpoint, method: "GET", body: nil)
    }

    func post<T: Decodable, Body: Encodable>(_ endpoint: APIEndpoint, body: Body, as type: T.Type = T.self) async throws -> T {
        try await request(endpoint, method: "POST", body: try JSONEncoder().encode(body))
    }

    private func request<T: Decodable>(_ endpoint: APIEndpoint, method: String, body: Data?) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(endpoint.path), cachePolicy: .reloadIgnoringLocalCacheData)
        request.httpMethod = method; request.httpBody = body; request.timeoutInterval = endpoint.timeout
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(try await auth.accessToken())", forHTTPHeaderField: "Authorization")
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
            guard (200..<300).contains(http.statusCode) else {
                throw APIError.server(status: http.statusCode, payload: try? JSONDecoder().decode(APIErrorEnvelope.self, from: data).error)
            }
            do { return try JSONDecoder().decode(APIEnvelope<T>.self, from: data).data }
            catch { throw APIError.decoding(error) }
        } catch let error as APIError { throw error }
        catch { throw APIError.transport(error) }
    }
}
