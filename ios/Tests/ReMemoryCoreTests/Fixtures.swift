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
    static let confirmResult = "{\"data\":{\"saved\":true,\"createdClaimId\":null}}"
    static let error = "{\"error\":{\"code\":\"AUTH_TOKEN_INVALID\",\"message\":\"test\",\"requestId\":\"test-request\"}}"
    static let resolved = "{\"error\":{\"code\":\"GAP_NOT_ANSWERABLE\",\"message\":\"resolved\",\"requestId\":\"test-request\"}}"
    static let emptyList = "{\"data\":{\"memories\":[],\"pendingConfirmationCount\":0,\"partial\":false,\"partialMessage\":null}}"
    static let uploadComplete = "{\"data\":{\"accepted\":[{\"id\":\"\(photoId)\",\"slotId\":\"\(assetId)\",\"name\":\"photo.jpg\",\"capturedAt\":null,\"state\":\"uploaded\"}],\"rejected\":[],\"sequenceIds\":[],\"processingState\":\"uploaded\",\"message\":null}}"
}
