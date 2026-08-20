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

/// A specific photo the model could not read with confidence, together with its
/// own "what is this?" question. The user can settle it on the photo itself.
struct UncertainPhotoPresentation: Identifiable {
    let id: String
    let photo: MemoryPhotoPresentation
    let question: String
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
    let uncertainPhotos: [UncertainPhotoPresentation]

    init(
        id: String, title: String, date: Date?, place: String?, summary: String?,
        photoCount: Int, status: MemoryStatus, needsConfirmation: Bool,
        heroPhotos: [MemoryPhotoPresentation], memoryContent: [MemoryContentPresentation],
        supportingPhotos: [MemoryPhotoPresentation], relatedMemories: [RelatedMemoryPresentation],
        uncertainPhotos: [UncertainPhotoPresentation] = []
    ) {
        self.id = id; self.title = title; self.date = date; self.place = place
        self.summary = summary; self.photoCount = photoCount; self.status = status
        self.needsConfirmation = needsConfirmation; self.heroPhotos = heroPhotos
        self.memoryContent = memoryContent; self.supportingPhotos = supportingPhotos
        self.relatedMemories = relatedMemories; self.uncertainPhotos = uncertainPhotos
    }
}
