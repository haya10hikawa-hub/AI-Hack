import Foundation
import XCTest
@testable import ReMemoryCore

final class APIClientTests: XCTestCase {
    func testClientRequestsAreInterceptedAndMatchContract() async throws {
        let cases: [(APIEndpoint, String, String, String)] = [
            (.memories, "GET", "/api/memories", Fixtures.memoryList),
            (.memory(Fixtures.memoryId), "GET", "/api/memories/\(Fixtures.memoryId)", Fixtures.memoryDetail),
            (.confirmations, "GET", "/api/gaps", Fixtures.confirmations)
        ]
        for (endpoint, method, path, fixture) in cases {
            MockURLProtocol.responder = response(method: method, path: path, fixture: fixture)
            let client = try makeClient()
            if case .memories = endpoint { _ = try await client.get(endpoint, as: MemoryThreadDTO.self) }
            else if case .confirmations = endpoint { _ = try await client.get(endpoint, as: ConfirmationQueueDTO.self) }
            else { _ = try await client.get(endpoint, as: MemoryDetailDTO.self) }
        }

        MockURLProtocol.responder = response(method: "POST", path: "/api/gaps/\(Fixtures.gapId)/confirm", fixture: Fixtures.confirmResult, bodyKey: "decision")
        _ = try await makeClient().post(.confirm(Fixtures.gapId), body: ConfirmationDecisionDTO.confirm, as: ConfirmationResultDTO.self)

        MockURLProtocol.responder = response(method: "POST", path: "/api/search", fixture: Fixtures.search, bodyKey: "query")
        let body = SearchRequestDTO(query: "徳島", timezone: "Asia/Tokyo", currentDate: "2026-08-15")
        _ = try await makeClient().post(.search, body: body, as: SearchDTO.self)
    }

    func testErrorEnvelopeIsPreserved() async throws {
        MockURLProtocol.responder = { request in (401, Data(Fixtures.error.utf8)) }
        do {
            _ = try await makeClient().get(.memories, as: MemoryThreadDTO.self)
            XCTFail("Expected server error")
        } catch let APIError.server(status, payload) {
            XCTAssertEqual(status, 401); XCTAssertEqual(payload?.code, "AUTH_TOKEN_INVALID")
        }
    }

    private func response(method: String, path: String, fixture: String, bodyKey: String? = nil) -> (URLRequest) throws -> (Int, Data) {
        { request in
            XCTAssertEqual(request.httpMethod, method); XCTAssertEqual(request.url?.path, path)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization")?.hasPrefix("Bearer "), true)
            if let bodyKey {
                let object = try JSONSerialization.jsonObject(with: request.bodyData) as? [String: Any]
                XCTAssertNotNil(object?[bodyKey])
            }
            return (200, Data(fixture.utf8))
        }
    }
}

struct TestAuth: AuthProviding {
    func accessToken() async throws -> String { ["unit", "test", "token"].joined(separator: "-") }
}

final class MockURLProtocol: URLProtocol {
    static var responder: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            guard let responder = Self.responder else { throw APIError.invalidConfiguration }
            let (status, data) = try responder(request)
            guard let url = request.url,
                  let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"]) else {
                throw APIError.invalidResponse
            }
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

func makeClient() throws -> APIClient {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [MockURLProtocol.self]
    return try APIClient(environment: ["REMEMORY_API_BASE_URL": "https://unit.invalid"], auth: TestAuth(), session: URLSession(configuration: config))
}

private extension URLRequest {
    var bodyData: Data {
        if let httpBody { return httpBody }
        guard let stream = httpBodyStream else { return Data() }
        stream.open(); defer { stream.close() }
        var result = Data(), buffer = [UInt8](repeating: 0, count: 1024)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            result.append(buffer, count: count)
        }
        return result
    }
}
