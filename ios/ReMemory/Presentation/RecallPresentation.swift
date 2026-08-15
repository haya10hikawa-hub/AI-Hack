enum RecallAnswerState { case idle, loading, strong, ambiguous, unknown, error }

struct RecallPresentation {
    var answerState: RecallAnswerState = .idle
    var candidates: [MemoryPresentation] = []
    var answer: String?
    var clarification: String?
}
