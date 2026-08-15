struct UploadFileDTO: Encodable { let name, mimeType: String; let bytes: Int }
struct UploadPrepareRequestDTO: Encodable { let files: [UploadFileDTO] }
struct UploadSlotDTO: Decodable { let clientIndex: Int; let slotId, path, token: String }
struct UploadPrepareDTO: Decodable { let manifest: String; let uploads: [UploadSlotDTO] }

struct UploadCompleteRequestDTO: Encodable {
    let manifest: String
    let timezoneOffsetMinutes: Int?
    let timezone: String?
    let coarsePlace: String?

    private enum Keys: String, CodingKey { case manifest, timezoneOffsetMinutes, timezone, coarsePlace }
    func encode(to encoder: Encoder) throws {
        var value = encoder.container(keyedBy: Keys.self)
        try value.encode(manifest, forKey: .manifest)
        if let timezoneOffsetMinutes { try value.encode(timezoneOffsetMinutes, forKey: .timezoneOffsetMinutes) }
        else { try value.encodeNil(forKey: .timezoneOffsetMinutes) }
        try value.encodeIfPresent(timezone, forKey: .timezone)
        try value.encodeIfPresent(coarsePlace, forKey: .coarsePlace)
    }
}
struct UploadedPhotoDTO: Decodable {
    let id, name: String
    let slotId, capturedAt: String?
    let state: String
}
struct RejectedPhotoDTO: Decodable { let name, reason: String; let slotId: String? }
struct UploadCompleteDTO: Decodable {
    let accepted: [UploadedPhotoDTO]
    let rejected: [RejectedPhotoDTO]
    let sequenceIds: [String]?
    let processingState: ProcessingStateDTO
    let message: String?
}
