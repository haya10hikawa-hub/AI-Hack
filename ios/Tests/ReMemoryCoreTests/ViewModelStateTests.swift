import Foundation
import XCTest
@testable import ReMemoryCore

@MainActor
final class ViewModelStateTests: XCTestCase {
    func testMemoriesLoadingSuccessEmptyAndError() async throws {
        let model = MemoriesViewModel(api: try makeClient())
        XCTAssertEqual(model.state, .idle)
        MockURLProtocol.responder = { request in Thread.sleep(forTimeInterval: 0.05); return (200, Data(Fixtures.memoryList.utf8)) }
        let task = Task { await model.load() }
        await Task.yield(); XCTAssertEqual(model.state, .loading)
        await task.value; XCTAssertEqual(model.state, .success)

        MockURLProtocol.responder = { _ in (200, Data(Fixtures.emptyList.utf8)) }
        await model.load(); XCTAssertEqual(model.state, .empty)
        MockURLProtocol.responder = { _ in (500, Data(Fixtures.error.utf8)) }
        await model.load(); XCTAssertEqual(model.state, .error)
    }

    func testMemoryLoadingSuccessPartialAndError() async throws {
        let model = MemoryViewModel(memoryId: Fixtures.memoryId, api: try makeClient())
        XCTAssertEqual(model.state, .loading)
        MockURLProtocol.responder = memoryResponse(detail: Fixtures.memoryDetail)
        await model.load(); XCTAssertEqual(model.state, .success)
        MockURLProtocol.responder = memoryResponse(detail: Fixtures.memoryDetail.replacingOccurrences(of: "\"partial\":false", with: "\"partial\":true"))
        await model.load(); XCTAssertEqual(model.state, .partial)
        MockURLProtocol.responder = { _ in (500, Data(Fixtures.error.utf8)) }
        await model.load(); XCTAssertEqual(model.state, .error)
    }

    func testConfirmationSavedResolvedAndError() async throws {
        let item = ConfirmationPresentation(id: Fixtures.gapId, memoryId: Fixtures.memoryId, memoryTitle: "神山", question: "確認", suggestion: nil)
        let model = ConfirmationViewModel(item: item, api: try makeClient())
        XCTAssertEqual(model.state, .idle)
        MockURLProtocol.responder = { _ in (200, Data(Fixtures.confirmResult.utf8)) }
        let saved = await model.save(); XCTAssertTrue(saved); XCTAssertEqual(model.state, .saved)
        MockURLProtocol.responder = { _ in (409, Data(Fixtures.resolved.utf8)) }
        let resolved = await model.save(); XCTAssertTrue(resolved); XCTAssertEqual(model.state, .resolved)
        MockURLProtocol.responder = { _ in (500, Data(Fixtures.error.utf8)) }
        let failed = await model.save(); XCTAssertFalse(failed); XCTAssertEqual(model.state, .error)
    }

    func testRecallIdleLoadingGroundedUnknownAndError() async throws {
        let model = RecallViewModel(api: try makeClient())
        XCTAssertEqual(model.result.answerState, .idle); model.query = "徳島"
        MockURLProtocol.responder = { request in Thread.sleep(forTimeInterval: 0.05); return (200, Data(Fixtures.search.utf8)) }
        let task = Task { await model.search() }
        await Task.yield(); XCTAssertEqual(model.result.answerState, .loading)
        await task.value; XCTAssertEqual(model.result.answerState, .strong)
        MockURLProtocol.responder = { _ in (200, Data(Fixtures.unknownSearch.utf8)) }
        await model.search(); XCTAssertEqual(model.result.answerState, .unknown)
        MockURLProtocol.responder = { _ in (500, Data(Fixtures.error.utf8)) }
        await model.search(); XCTAssertEqual(model.result.answerState, .error)
    }

    func testUploadStateSurfaceIsComplete() {
        let states: [UploadViewState] = [.selected, .uploading, .processing, .completed, .partial, .failed]
        XCTAssertEqual(Set(states.map(String.init(describing:))).count, states.count)
    }

    private func memoryResponse(detail: String) -> (URLRequest) throws -> (Int, Data) {
        { request in
            request.url?.path == "/api/gaps" ? (200, Data(Fixtures.confirmations.utf8)) : (200, Data(detail.utf8))
        }
    }
}
