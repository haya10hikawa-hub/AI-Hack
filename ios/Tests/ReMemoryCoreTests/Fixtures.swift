enum Fixtures {
    static let memoryId = "11111111-1111-4111-8111-111111111111"
    static let assetId = "22222222-2222-4222-8222-222222222222"
    static let photoId = "33333333-3333-4333-8333-333333333333"
    static let claimId = "44444444-4444-4444-8444-444444444444"
    static let gapId = "55555555-5555-4555-8555-555555555555"

    static let item = """
    {"id":"\(memoryId)","title":"神山でのロボット制作","capturedAt":"2026-05-01T09:00:00Z","placeLabel":"徳島","photoCount":2,"representativeImageUrl":"https://images.invalid/a","representativeImageAlt":"湖","state":"confirmed","processingState":"ready","summary":"一日の記録","hasOpenGap":true}
    """
    static let memoryList = "{\"data\":{\"memories\":[\(item)],\"pendingConfirmationCount\":1,\"partial\":false,\"partialMessage\":null}}"
    static let memoryDetail = """
    {"data":{"memory":\(item),"representatives":{"identity":{"assetId":"\(assetId)","imageUrl":"https://images.invalid/hero","alt":"湖"},"keyMoment":null,"complement":null},"relatedMemories":[],"reconstruction":"朝の記憶","claims":[{"id":"\(claimId)","text":"目的: FTCの練習","state":"confirmed","origin":"user","evidenceIds":["\(photoId)"]}],"evidence":[{"id":"\(photoId)","label":"photo","detail":"湖","kind":"photo","sourceLabel":null,"imageUrl":"https://images.invalid/support","capturedAt":null}],"partial":false,"partialMessage":null}}
    """
    static let confirmations = """
    {"data":{"gaps":[{"id":"\(gapId)","memoryId":"\(memoryId)","memoryTitle":"神山","question":"FTCの練習でしたか？","candidateLabel":"FTCの練習","evidenceSummary":null,"state":"open"}],"partial":false,"partialMessage":null}}
    """
    static let search = """
    {"data":{"interpretation":{"time":null,"place":"徳島","people":[],"activities":["robotics"],"keywords":[]},"answer":"見つかりました","answerState":"grounded","candidates":[{"memory":\(item)}],"clarification":null,"partial":false,"partialMessage":null,"feedbackEnabled":false}}
    """
    static let unknownSearch = """
    {"data":{"interpretation":{"time":null,"place":null,"people":[],"activities":[],"keywords":[]},"answer":null,"answerState":"unknown","candidates":[],"clarification":"見つかりません","partial":false,"partialMessage":null,"feedbackEnabled":false}}
    """
    // MARK: - Memory Map

    static let placedCellId = "8a3095a4f0affff"
    static let neighbourCellId = "8a3095a4f0b7fff"
    static let unresolvedCellId = "8a3095a4f0c7fff"
    static let secondMemoryId = "66666666-6666-4666-8666-666666666666"
    static let thirdMemoryId = "77777777-7777-4777-8777-777777777777"

    static let mapMemoryList = """
    {"data":{"memories":[
    {"id":"\(memoryId)","title":"大塚美術館を歩いた日","capturedAt":"2026-05-05T01:00:00Z","placeLabel":"徳島県 鳴門","photoCount":6,"representativeImageUrl":"https://images.invalid/museum","representativeImageAlt":"展示室","state":"confirmed","processingState":"ready"},
    {"id":"\(secondMemoryId)","title":"睡蓮の池のまえで","capturedAt":"2026-05-05T03:00:00Z","placeLabel":"徳島県 鳴門","photoCount":4,"representativeImageUrl":"https://images.invalid/lily","representativeImageAlt":"睡蓮","state":"confirmed","processingState":"ready"},
    {"id":"\(thirdMemoryId)","title":"浅瀬の光","capturedAt":"2026-04-18T02:00:00Z","placeLabel":"徳島県 鳴門","photoCount":3,"representativeImageUrl":null,"representativeImageAlt":null,"state":"evidence","processingState":"ready"}
    ],"partial":false,"partialMessage":null}}
    """

    static let map = """
    {"data":{"enabled":true,"cells":[
    {"cellId":"\(placedCellId)","center":{"latitude":34.238,"longitude":134.556},"state":"memory","firstSeenAt":"2026-05-05T01:00:00Z","lastSeenAt":"2026-05-05T03:00:00Z","visitCount":2,"dwellBucket":"long","evidenceCount":10,"memoryCount":2,"coarsePlace":"徳島県 鳴門","memories":[
    {"id":"\(memoryId)","title":"大塚美術館を歩いた日","updatedAt":"2026-05-05T01:00:00Z"},
    {"id":"\(secondMemoryId)","title":"睡蓮の池のまえで","updatedAt":"2026-05-05T03:00:00Z"}]},
    {"cellId":"\(neighbourCellId)","center":{"latitude":34.2398,"longitude":134.5578},"state":"future-state","firstSeenAt":"2026-04-18T02:00:00Z","lastSeenAt":"2026-04-18T02:00:00Z","visitCount":1,"dwellBucket":null,"evidenceCount":3,"memoryCount":1,"coarsePlace":"徳島県 鳴門","memories":[
    {"id":"\(thirdMemoryId)","title":"浅瀬の光","updatedAt":"2026-04-18T02:00:00Z"}]},
    {"cellId":"\(unresolvedCellId)","center":null,"state":"memory","firstSeenAt":"2026-01-01T00:00:00Z","lastSeenAt":"2026-01-01T00:00:00Z","visitCount":1,"dwellBucket":null,"evidenceCount":1,"memoryCount":1,"coarsePlace":"grid:34.0:134.5","memories":[
    {"id":"\(gapId)","title":"場所のないMemory","updatedAt":"2026-01-01T00:00:00Z"}]}
    ],"coarseAreas":[],"partial":false,"partialMessage":null}}
    """
    static let emptyMap = "{\"data\":{\"enabled\":false,\"cells\":[],\"coarseAreas\":[],\"partial\":false,\"partialMessage\":null}}"

    static let confirmResult = "{\"data\":{\"saved\":true,\"createdClaimId\":null}}"
    static let error = "{\"error\":{\"code\":\"AUTH_TOKEN_INVALID\",\"message\":\"test\",\"requestId\":\"test-request\"}}"
    static let resolved = "{\"error\":{\"code\":\"GAP_NOT_ANSWERABLE\",\"message\":\"resolved\",\"requestId\":\"test-request\"}}"
    static let emptyList = "{\"data\":{\"memories\":[],\"pendingConfirmationCount\":0,\"partial\":false,\"partialMessage\":null}}"
    static let uploadComplete = "{\"data\":{\"accepted\":[{\"id\":\"\(photoId)\",\"slotId\":\"\(assetId)\",\"name\":\"photo.jpg\",\"capturedAt\":null,\"state\":\"uploaded\"}],\"rejected\":[],\"sequenceIds\":[],\"processingState\":\"uploaded\",\"message\":null}}"
}
