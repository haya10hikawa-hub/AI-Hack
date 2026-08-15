import Foundation
import XCTest
@testable import ReMemoryCore

final class FixtureDecodeTests: XCTestCase {
    func testSuccessAndErrorEnvelopesDecode() throws {
        let list = try decode(MemoryThreadDTO.self, json: Fixtures.memoryList)
        XCTAssertEqual(list.memories.first?.id, Fixtures.memoryId)

        let detail = try decode(MemoryDetailDTO.self, json: Fixtures.memoryDetail)
        XCTAssertEqual(detail.representatives?.identity?.assetId, Fixtures.assetId)
        XCTAssertEqual(detail.claims.first?.origin, "user")

        let queue = try decode(ConfirmationQueueDTO.self, json: Fixtures.confirmations)
        XCTAssertEqual(queue.gaps.first?.state, "open")

        let search = try decode(SearchDTO.self, json: Fixtures.search)
        XCTAssertEqual(search.answerState, "grounded")
        XCTAssertEqual(search.interpretation.place, "徳島")

        let error = try JSONDecoder().decode(APIErrorEnvelope.self, from: Data(Fixtures.error.utf8))
        XCTAssertEqual(error.error.code, "AUTH_TOKEN_INVALID")
        XCTAssertEqual(error.error.requestId, "test-request")

        let upload = try decode(UploadCompleteDTO.self, json: Fixtures.uploadComplete)
        XCTAssertEqual(upload.accepted.first?.state, "uploaded")
        let request = UploadCompleteRequestDTO(manifest: "opaque", timezoneOffsetMinutes: nil, timezone: nil, coarsePlace: nil)
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any]
        XCTAssertTrue(object?["timezoneOffsetMinutes"] is NSNull)
    }

    func testPresentationBoundaryUsesStablePhotoIdentity() throws {
        let detail = try decode(MemoryDetailDTO.self, json: Fixtures.memoryDetail)
        let memory = PresentationMapper.memory(detail)
        XCTAssertEqual(memory.heroPhotos.first?.id, Fixtures.assetId)
        XCTAssertEqual(memory.memoryContent.count, 1)
        XCTAssertEqual(memory.supportingPhotos.first?.id, Fixtures.photoId)
    }

    func testRecallStates() throws {
        let grounded = PresentationMapper.recall(try decode(SearchDTO.self, json: Fixtures.search))
        XCTAssertEqual(grounded.answerState, .strong)
        let unknown = PresentationMapper.recall(try decode(SearchDTO.self, json: Fixtures.unknownSearch))
        XCTAssertEqual(unknown.answerState, .unknown)
    }

    private func decode<T: Decodable>(_ type: T.Type, json: String) throws -> T {
        try JSONDecoder().decode(APIEnvelope<T>.self, from: Data(json.utf8)).data
    }
}
