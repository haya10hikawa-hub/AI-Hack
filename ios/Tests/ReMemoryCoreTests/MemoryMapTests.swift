import CoreLocation
import Foundation
import XCTest
@testable import ReMemoryCore

final class MemoryMapTests: XCTestCase {
    func testMapCellsJoinOnlyMatchingMemorySummaries() throws {
        let map = PresentationMapper.memoryMap(try decodeMap(), memories: try decodeMemories())
        let cluster = try XCTUnwrap(map.clusters.first { $0.id == Fixtures.placedCellId })

        XCTAssertEqual(cluster.memories.map(\.id), [Fixtures.memoryId, Fixtures.secondMemoryId])
        XCTAssertFalse(cluster.memories.contains { $0.id == Fixtures.thirdMemoryId })
        XCTAssertEqual(cluster.representativePhoto?.temporaryURL?.absoluteString,
                       "https://images.invalid/museum")
    }

    func testMissingSummaryIsNeverFabricated() throws {
        let map = PresentationMapper.memoryMap(try decodeMap(), memories: try decodeMemories())

        XCTAssertEqual(map.unplacedMemoryCount, 1)
        XCTAssertFalse(map.clusters.flatMap(\.memories).contains { $0.id == Fixtures.gapId })
    }

    func testUnknownStateDecodesSafelyAndCoordinatesComeOnlyFromMap() throws {
        let response = try decodeMap()
        let map = PresentationMapper.memoryMap(response, memories: try decodeMemories())
        let unknown = try XCTUnwrap(map.clusters.first { $0.id == Fixtures.neighbourCellId })

        if case .unknown = unknown.state {} else { XCTFail("Expected safe unknown state") }
        XCTAssertEqual(unknown.coordinate.latitude, 34.2398, accuracy: 0.00001)
        XCTAssertEqual(unknown.coordinate.longitude, 134.5578, accuracy: 0.00001)
    }

    func testNeighbouringCellsMergeDeterministically() throws {
        let clusters = PresentationMapper.memoryMap(try decodeMap(), memories: try decodeMemories()).clusters
        let first = MemoryMapClusterBuilder.merging(clusters, within: 600)
        let second = MemoryMapClusterBuilder.merging(clusters, within: 600)

        XCTAssertEqual(first.count, 1)
        XCTAssertEqual(first[0].cellIDs, second[0].cellIDs)
        XCTAssertEqual(first[0].memoryCount, 3)
        XCTAssertEqual(first[0].memories.count, 3)
        XCTAssertEqual(first[0].coordinate.latitude, (34.238 + 34.2398) / 2, accuracy: 0.00001)
        XCTAssertEqual(MemoryMapClusterBuilder.merging(clusters, within: 50).count, 2)
    }

    @MainActor
    func testPartialMapResponseKeepsServerMessage() async throws {
        let model = MapViewModel(api: try makeClient())
        let partial = Fixtures.map.replacingOccurrences(
            of: "\"partial\":false,\"partialMessage\":null",
            with: "\"partial\":true,\"partialMessage\":\"recent cells only\""
        )
        MockURLProtocol.responder = { request in
            request.url?.path == "/api/map" ? (200, Data(partial.utf8)) : (200, Data(Fixtures.mapMemoryList.utf8))
        }

        await model.load()
        XCTAssertEqual(model.state, .success)
        XCTAssertEqual(model.map.partialMessage, "recent cells only")
    }

    @MainActor
    func testMapFailureDoesNotFallBackToMemoryList() async throws {
        let model = MapViewModel(api: try makeClient())
        MockURLProtocol.responder = { request in
            request.url?.path == "/api/map" ? (500, Data(Fixtures.error.utf8)) : (200, Data(Fixtures.mapMemoryList.utf8))
        }

        await model.load()
        XCTAssertEqual(model.state, .error)
        XCTAssertTrue(model.map.isEmpty)
        XCTAssertNotNil(model.error)
    }

    @MainActor
    func testMapAndMemoriesLoadInParallelWithPartialFallback() async throws {
        let model = MapViewModel(api: try makeClient())
        MockURLProtocol.responder = mapResponse
        await model.load()
        XCTAssertEqual(model.state, .success)
        XCTAssertEqual(model.map.clusters.first?.memories.count, 2)

        MockURLProtocol.responder = { request in
            request.url?.path == "/api/map" ? (200, Data(Fixtures.map.utf8)) : (500, Data(Fixtures.error.utf8))
        }
        await model.load()
        XCTAssertEqual(model.state, .success)
        XCTAssertEqual(model.map.clusters.count, 2)
        XCTAssertTrue(model.map.clusters.allSatisfy { $0.memories.isEmpty })
        XCTAssertNotNil(model.error)
    }

    private func decodeMap() throws -> MemoryMapDTO {
        try JSONDecoder().decode(APIEnvelope<MemoryMapDTO>.self, from: Data(Fixtures.map.utf8)).data
    }

    private func decodeMemories() throws -> [MemoryThreadItemDTO] {
        try JSONDecoder().decode(APIEnvelope<MemoryThreadDTO>.self,
                                 from: Data(Fixtures.mapMemoryList.utf8)).data.memories
    }

    private func mapResponse(_ request: URLRequest) -> (Int, Data) {
        request.url?.path == "/api/map"
            ? (200, Data(Fixtures.map.utf8))
            : (200, Data(Fixtures.mapMemoryList.utf8))
    }
}
