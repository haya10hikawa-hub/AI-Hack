import Foundation

enum TruthStateDTO: Decodable {
    case evidence, confirmed, inferred, unknown, disputed
    init(from decoder: Decoder) throws {
        switch try decoder.singleValueContainer().decode(String.self) {
        case "evidence": self = .evidence; case "confirmed": self = .confirmed
        case "inferred": self = .inferred; case "disputed": self = .disputed
        default: self = .unknown
        }
    }
}

enum ProcessingStateDTO: Decodable, Equatable {
    case ready, uploaded, processing, partial, failed, unknown
    init(from decoder: Decoder) throws {
        switch try decoder.singleValueContainer().decode(String.self) {
        case "ready": self = .ready; case "uploaded": self = .uploaded
        case "processing": self = .processing; case "partial": self = .partial
        case "failed": self = .failed; default: self = .unknown
        }
    }
}

struct MemoryThreadItemDTO: Decodable {
    let id, title: String
    let capturedAt, placeLabel: String?
    let photoCount: Int
    let representativeImageUrl, representativeImageAlt: String?
    let state: TruthStateDTO
    let processingState: ProcessingStateDTO?
    let summary: String?
    let hasOpenGap: Bool?
}

struct MemoryThreadDTO: Decodable {
    let memories: [MemoryThreadItemDTO]
    let pendingConfirmationCount: Int?
    let partial: Bool?
    let partialMessage: String?
}

struct RepresentativePhotoDTO: Decodable { let assetId: String; let imageUrl: String?; let alt: String }
struct MemoryRepresentativesDTO: Decodable {
    let identity, keyMoment, complement: RepresentativePhotoDTO?
}

struct RelatedMemoryDTO: Decodable {
    let memoryId, title: String
    let capturedAt: String?
    let relationType, relationState: String
    let representativeImageUrl: String?
}

struct ClaimDTO: Decodable {
    let id, text: String
    let state: TruthStateDTO
    let origin: String
    let evidenceIds: [String]
}
struct EvidenceDTO: Decodable {
    let id, label: String
    let detail, sourceLabel, imageUrl, capturedAt: String?
    let kind: String
}

struct MemoryDetailItemDTO: Decodable {
    let id, title: String
    let capturedAt, placeLabel: String?
    let photoCount: Int
    let representativeImageUrl, representativeImageAlt: String?
    let state: TruthStateDTO
    let processingState: ProcessingStateDTO?
    let summary, description, updatedAt: String?
    let hasOpenGap: Bool?
}

struct MemoryDetailDTO: Decodable {
    let memory: MemoryDetailItemDTO
    let representatives: MemoryRepresentativesDTO?
    let relatedMemories: [RelatedMemoryDTO]?
    let reconstruction: String?
    let claims: [ClaimDTO]
    let evidence: [EvidenceDTO]
    let partial: Bool?
}
