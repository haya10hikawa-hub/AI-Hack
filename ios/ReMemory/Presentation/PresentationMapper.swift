import Foundation

enum PresentationMapper {
    private static let iso = ISO8601DateFormatter()

    static func memory(_ item: MemoryThreadItemDTO) -> MemoryPresentation {
        let photo = MemoryPhotoPresentation(
            id: "\(item.id)-representative",
            temporaryURL: item.representativeImageUrl.flatMap(URL.init(string:)),
            alt: item.representativeImageAlt ?? item.title
        )
        return MemoryPresentation(
            id: item.id, title: item.title, date: item.capturedAt.flatMap(iso.date), place: item.placeLabel,
            summary: item.summary, photoCount: item.photoCount, status: status(item.processingState),
            needsConfirmation: item.hasOpenGap ?? false,
            heroPhotos: item.representativeImageUrl == nil ? [] : [photo],
            memoryContent: [], supportingPhotos: [], relatedMemories: []
        )
    }

    static func memory(_ detail: MemoryDetailDTO) -> MemoryPresentation {
        let photos = [detail.representatives?.identity, detail.representatives?.keyMoment, detail.representatives?.complement]
            .compactMap { $0 }
            .map { MemoryPhotoPresentation(id: $0.assetId, temporaryURL: $0.imageUrl.flatMap(URL.init(string:)), alt: $0.alt) }
        let supporting = detail.evidence.filter { $0.kind == "photo" }.map {
            MemoryPhotoPresentation(id: $0.id, temporaryURL: $0.imageUrl.flatMap(URL.init(string:)), alt: $0.detail ?? detail.memory.title)
        }
        let uncertain = detail.evidence.filter { $0.kind == "photo" && $0.uncertainty != nil }.map { entry in
            UncertainPhotoPresentation(
                id: entry.id,
                photo: MemoryPhotoPresentation(id: entry.id, temporaryURL: entry.imageUrl.flatMap(URL.init(string:)), alt: entry.detail ?? detail.memory.title),
                question: entry.uncertainty ?? "この写真の内容を確認できますか？"
            )
        }
        let related = (detail.relatedMemories ?? []).map { item in
            RelatedMemoryPresentation(id: item.memoryId, title: item.title, date: item.capturedAt.flatMap(iso.date),
                photo: item.representativeImageUrl.map { MemoryPhotoPresentation(id: "\(item.memoryId)-representative", temporaryURL: URL(string: $0), alt: item.title) })
        }
        return MemoryPresentation(
            id: detail.memory.id, title: detail.memory.title, date: detail.memory.capturedAt.flatMap(iso.date),
            place: detail.memory.placeLabel, summary: detail.reconstruction ?? detail.memory.description ?? detail.memory.summary,
            photoCount: detail.memory.photoCount, status: status(detail.memory.processingState),
            needsConfirmation: detail.memory.hasOpenGap ?? false, heroPhotos: Array(photos.prefix(3)),
            memoryContent: detail.claims.map { MemoryContentPresentation(id: $0.id, text: $0.text) },
            supportingPhotos: supporting, relatedMemories: related, uncertainPhotos: uncertain
        )
    }

    static func memoryMap(_ response: MemoryMapDTO, memories: [MemoryThreadItemDTO]) -> MemoryMapPresentation {
        MemoryMapPresentation(
            clusters: MemoryMapClusterBuilder.clusters(
                from: response.cells,
                memories: memories.map(memory)
            ),
            unplacedMemoryCount: MemoryMapClusterBuilder.unplacedMemoryCount(in: response.cells),
            partialMessage: response.partialMessage
        )
    }

    static func confirmations(_ queue: ConfirmationQueueDTO) -> [ConfirmationPresentation] {
        queue.gaps.filter { $0.state == "open" }.map {
            ConfirmationPresentation(id: $0.id, memoryId: $0.memoryId, memoryTitle: $0.memoryTitle, question: $0.question, suggestion: $0.candidateLabel)
        }
    }

    static func recall(_ response: SearchDTO) -> RecallPresentation {
        let candidates = Array(response.candidates.prefix(3)).map { memory($0.memory) }
        let state: RecallAnswerState = response.answerState == "unknown" ? .unknown
            : response.answerState == "clarification" || candidates.count > 1 ? .ambiguous
            : candidates.isEmpty ? .unknown : .strong
        return RecallPresentation(answerState: state, candidates: candidates, answer: response.answer, clarification: response.clarification)
    }

    private static func status(_ value: ProcessingStateDTO?) -> MemoryStatus {
        switch value { case .ready: .ready; case .uploaded, .processing: .working; case .partial: .partial; case .failed: .failed; default: .unknown }
    }
}
