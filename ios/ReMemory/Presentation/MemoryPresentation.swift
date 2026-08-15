import Foundation

enum MemoryStatus { case ready, working, partial, failed, unknown }

struct MemoryPhotoPresentation: Identifiable, Hashable {
    let id: String
    let temporaryURL: URL?
    let alt: String
}

struct MemoryContentPresentation: Identifiable { let id: String; let text: String }

struct RelatedMemoryPresentation: Identifiable {
    let id, title: String
    let date: Date?
    let photo: MemoryPhotoPresentation?
}

struct MemoryPresentation: Identifiable {
    let id, title: String
    let date: Date?
    let place: String?
    let summary: String?
    let photoCount: Int
    let status: MemoryStatus
    let needsConfirmation: Bool
    let heroPhotos: [MemoryPhotoPresentation]
    let memoryContent: [MemoryContentPresentation]
    let supportingPhotos: [MemoryPhotoPresentation]
    let relatedMemories: [RelatedMemoryPresentation]
}
