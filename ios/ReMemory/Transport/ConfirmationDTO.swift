struct ConfirmationDTO: Decodable {
    let id, memoryId, memoryTitle, question: String
    let candidateLabel, evidenceSummary: String?
    let state: String
}

struct ConfirmationQueueDTO: Decodable { let gaps: [ConfirmationDTO] }

enum ConfirmationDecisionDTO: Encodable {
    case confirm, later, correct(String)
    func encode(to encoder: Encoder) throws {
        var value = encoder.container(keyedBy: Keys.self)
        switch self {
        case .confirm: try value.encode("confirm", forKey: .decision)
        case .later: try value.encode("later", forKey: .decision)
        case let .correct(text):
            try value.encode("correct", forKey: .decision)
            try value.encode(text, forKey: .correctionText)
        }
    }
    private enum Keys: String, CodingKey { case decision, correctionText }
}

struct ConfirmationResultDTO: Decodable {
    let saved: Bool
    let deferred: Bool?
    let deferredUntil: String?
    let createdClaimId: String?
}
