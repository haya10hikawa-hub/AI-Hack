struct SearchRequestDTO: Encodable {
    let query, timezone, currentDate: String
    let cellId: String?
    init(query: String, timezone: String, currentDate: String, cellId: String? = nil) {
        self.query = query; self.timezone = timezone; self.currentDate = currentDate; self.cellId = cellId
    }
}
struct SearchCandidateDTO: Decodable { let memory: MemoryThreadItemDTO }
struct SearchInterpretationDTO: Decodable {
    let time, place: String?
    let people, activities, keywords: [String]?
}
struct SearchDTO: Decodable {
    let interpretation: SearchInterpretationDTO
    let answer, answerState: String?
    let candidates: [SearchCandidateDTO]
    let clarification: String?
    let partial: Bool?
    let partialMessage: String?
    let feedbackEnabled: Bool?
}
