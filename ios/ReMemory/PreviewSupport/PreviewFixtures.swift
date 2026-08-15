import Foundation

enum PreviewFixtures {
    static let memory = MemoryPresentation(
        id: "preview-memory", title: "静かな湖の朝", date: Date(), place: "山梨県",
        summary: "朝靄が晴れて、湖面に山の稜線が映った。", photoCount: 3, status: .ready,
        needsConfirmation: true,
        heroPhotos: [MemoryPhotoPresentation(id: "preview-photo", temporaryURL: nil, alt: "湖")],
        memoryContent: [MemoryContentPresentation(id: "preview-content", text: "ゆっくり湖畔を歩いた。")],
        supportingPhotos: [], relatedMemories: []
    )
}
