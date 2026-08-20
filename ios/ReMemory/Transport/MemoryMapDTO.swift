import Foundation

enum MemoryMapState: Decodable {
    case passed, experienced, memory, unknown

    init(from decoder: Decoder) throws {
        switch try decoder.singleValueContainer().decode(String.self) {
        case "passed": self = .passed
        case "experienced": self = .experienced
        case "memory": self = .memory
        default: self = .unknown
        }
    }
}

struct MemoryMapCellCenterDTO: Decodable { let latitude, longitude: Double }
struct MemoryMapMemoryReferenceDTO: Decodable { let id, title, updatedAt: String }
struct MemoryMapAreaMemoryDTO: Decodable { let id, title: String }
struct MemoryMapAreaDTO: Decodable { let coarsePlace: String; let memories: [MemoryMapAreaMemoryDTO] }

struct MemoryMapCellDTO: Decodable {
    let cellId: String
    let center: MemoryMapCellCenterDTO?
    let state: MemoryMapState
    let firstSeenAt, lastSeenAt: String
    let visitCount: Int
    let dwellBucket: String?
    let evidenceCount, memoryCount: Int
    let coarsePlace: String?
    let memories: [MemoryMapMemoryReferenceDTO]
}

struct MemoryMapDTO: Decodable {
    let enabled: Bool
    let cells: [MemoryMapCellDTO]
    let coarseAreas: [MemoryMapAreaDTO]
    let partial: Bool
    let partialMessage: String?
}
