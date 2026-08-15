import CoreLocation
import Foundation

enum PreviewFixtures {
    static var isEnabled: Bool {
#if DEBUG
        ProcessInfo.processInfo.environment["REMEMORY_USE_FIXTURES"] == "1"
#else
        false
#endif
    }

    /// Lets a fixture launch land directly on any of the five signature screens without tap injection.
    enum Route: String {
        case stacks, memory, grid, confirm, recallStrong = "recall-strong", recallAmbiguous = "recall-ambiguous"
        case map

        var isRecall: Bool { self == .recallStrong || self == .recallAmbiguous }
        var isMap: Bool { self == .map }
    }

    static var route: Route? {
        guard isEnabled else { return nil }
        return ProcessInfo.processInfo.environment["REMEMORY_FIXTURE_ROUTE"].flatMap(Route.init(rawValue:))
    }

    // MARK: - Memories

    /// The Memory the confirmation attaches to: the photos show the robot, the place and the date,
    /// but not why the day mattered — exactly the one gap worth asking about.
    static let memory = MemoryPresentation(
        id: "robot-afternoon", title: "ロボットに向き合った午後", date: date(2026, 7, 10), place: "工房",
        summary: "机の上には配線と工具。誰も口を開かないまま、時間だけが進んでいった。",
        photoCount: 12, status: .ready, needsConfirmation: true,
        heroPhotos: [asset("robotics-laptop", 1), asset("vr-headset", 1), asset("craft-table", 1)],
        memoryContent: [
            MemoryContentPresentation(id: "robot-opening", text: "画面とロボットのあいだを、視線が何度も往復していた。"),
            MemoryContentPresentation(id: "robot-ending", text: "うまく動いた瞬間だけ、部屋の空気がゆるんだ。")
        ],
        supportingPhotos: [
            asset("tent-shade", 1), asset("portrait-peace", 1), asset("field-green", 1),
            asset("insect-fan", 1), asset("red-ball-grass", 1), asset("festival-stage", 1),
            asset("cafe-window", 1), asset("sea-shallows", 1), asset("museum-throne", 1),
            asset("lily-pond", 1), asset("sea-headland", 1)
        ],
        relatedMemories: [
            RelatedMemoryPresentation(id: "festival-night", title: "夏祭りの夜", date: date(2026, 7, 10),
                                      photo: asset("festival-stage", 2))
        ]
    )

    /// Ordered so the deck opens on 2026年7月; each month carries several events, each event ≥3 hero photos.
    static let memories: [MemoryPresentation] = [memory] + [
        item("festival-night", "夏祭りの夜", "会場", date(2026, 7, 10),
             heroes: ["festival-stage", "portrait-peace", "tent-shade"],
             supporting: ["field-green", "red-ball-grass", "insect-fan", "craft-table", "vr-headset",
                          "robotics-laptop", "cafe-window", "sea-headland"]),
        item("fan-visitor", "扇風機にとまった虫", "自室", date(2026, 7, 10),
             heroes: ["insect-fan", "red-ball-grass", "field-green"],
             supporting: ["museum-sign", "craft-table", "tent-shade", "portrait-peace", "cafe-window",
                          "sea-shallows", "lily-pond", "chapel-gold"]),

        item("workshop-night", "夜の作業台", "工房", date(2026, 6, 25),
             heroes: ["craft-table", "robotics-laptop", "vr-headset"],
             supporting: ["lily-pond", "tent-shade", "field-green", "portrait-peace", "red-ball-grass",
                          "insect-fan", "festival-stage", "cafe-window", "museum-sign"]),
        item("green-field", "草の匂いのする道", "河川敷", date(2026, 6, 25),
             heroes: ["field-green", "tent-shade", "red-ball-grass"],
             supporting: ["chapel-gold", "insect-fan", "portrait-peace", "sea-shallows", "sea-headland",
                          "lily-pond", "cafe-window", "craft-table"]),
        item("tent-afternoon", "テントの影で待つ", "河川敷", date(2026, 6, 25),
             heroes: ["tent-shade", "portrait-peace", "field-green"],
             supporting: ["painting-cafe", "festival-stage", "red-ball-grass", "insect-fan", "craft-table",
                          "robotics-laptop", "sea-shallows", "museum-throne"]),

        item("museum-day", "大塚美術館を歩いた日", "徳島県 鳴門", date(2026, 5, 5),
             heroes: ["museum-throne", "fresco-ceiling", "museum-sign"],
             supporting: ["painting-babel", "painting-cafe", "chapel-gold", "lily-pond", "sea-shallows",
                          "sea-headland", "cafe-window", "portrait-window", "field-green", "red-ball-grass"]),
        item("lily-water", "睡蓮の池のまえで", "徳島県 鳴門", date(2026, 5, 5),
             heroes: ["lily-pond", "chapel-gold", "fresco-ceiling"],
             supporting: ["museum-sign", "painting-cafe", "painting-babel", "museum-throne", "sea-shallows",
                          "sea-headland", "cafe-window", "portrait-window"]),
        item("shore-walk", "浅瀬の光", "徳島県 鳴門", date(2026, 5, 5),
             heroes: ["sea-shallows", "sea-headland", "cafe-window"],
             supporting: ["lily-pond", "portrait-window", "museum-sign", "field-green", "red-ball-grass",
                          "painting-cafe", "chapel-gold", "tent-shade"]),
        item("morning-window", "窓ぎわのコーヒー", "喫茶店", date(2026, 5, 5),
             heroes: ["cafe-window", "portrait-window", "sea-shallows"],
             supporting: ["lily-pond", "museum-throne", "chapel-gold", "sea-headland", "field-green",
                          "craft-table", "painting-babel", "red-ball-grass"]),

        item("spring-frescoes", "壁画のある部屋", "徳島県 鳴門", date(2026, 4, 18),
             heroes: ["fresco-ceiling", "chapel-gold", "painting-babel"],
             supporting: ["painting-cafe", "museum-sign", "museum-throne", "lily-pond", "cafe-window",
                          "portrait-window", "sea-shallows"]),
        item("spring-shore", "風の強い海岸", "神奈川県", date(2026, 4, 12),
             heroes: ["sea-headland", "sea-shallows", "field-green"],
             supporting: ["red-ball-grass", "tent-shade", "cafe-window", "lily-pond", "portrait-peace",
                          "insect-fan", "craft-table"]),
        item("spring-table", "はじめての配線", "工房", date(2026, 4, 3),
             heroes: ["craft-table", "vr-headset", "robotics-laptop"],
             supporting: ["portrait-peace", "tent-shade", "festival-stage", "field-green", "insect-fan",
                          "museum-sign", "red-ball-grass"])
    ]

    static let confirmation = ConfirmationPresentation(
        id: "robot-confirmation", memoryId: memory.id, memoryTitle: memory.title,
        question: "この時、何をしていましたか？", suggestion: nil
    )

    static func memory(id: String) -> MemoryPresentation? { memories.first { $0.id == id } }

    static func recall(query: String) -> RecallPresentation {
        let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return RecallPresentation() }
        if value.contains("曖昧") || value.contains("候補") {
            return RecallPresentation(answerState: .ambiguous,
                                      candidates: [memories[6], memory, memories[8]],
                                      clarification: "近いMemoryが複数あります。")
        }
        if value.contains("不明") || value.contains("ない") {
            return RecallPresentation(answerState: .unknown, clarification: "この記憶はまだ見つけられませんでした。")
        }
        return RecallPresentation(answerState: .strong, candidates: [memory])
    }

    // MARK: - Map

    /// Coarse cell centres, the same thing the server derives from an H3 cell.
    static let mapClusters: [MemoryMapClusterPresentation] = [
        cluster("8a3095a4f0affff", "徳島県 鳴門", 34.2380, 134.5560, ["museum-day", "spring-frescoes"]),
        cluster("8a3095a4f0b7fff", "徳島県 鳴門", 34.2398, 134.5578, ["lily-water", "shore-walk"]),
        cluster("8a3095b1a54ffff", "工房", 34.0703, 134.5548, ["robot-afternoon", "workshop-night", "spring-table"]),
        cluster("8a3095b1a56ffff", "河川敷", 34.0790, 134.5410, ["green-field", "tent-afternoon"]),
        cluster("8a3095b1a44ffff", "会場", 34.0745, 134.5595, ["festival-night"]),
        cluster("8a3095b1a40ffff", "喫茶店", 34.0690, 134.5500, ["morning-window"]),
        cluster("8a3095b1a42ffff", "自室", 34.0710, 134.5530, ["fan-visitor"]),
        cluster("8a2f5a2c8a0ffff", "神奈川県", 35.3080, 139.4830, ["spring-shore"])
    ]

    private static func cluster(_ cellId: String, _ place: String, _ latitude: Double, _ longitude: Double,
                                _ memoryIDs: [String]) -> MemoryMapClusterPresentation {
        let memories = memoryIDs.compactMap(memory)
        return MemoryMapClusterPresentation(
            id: cellId, cellIDs: [cellId],
            coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude), coarsePlace: place,
            state: .memory, memoryCount: memories.count, memories: memories,
            representativePhoto: memories.first?.heroPhotos.first
        )
    }

    // MARK: - Builders

    private static func item(_ id: String, _ title: String, _ place: String, _ when: Date,
                             heroes: [String], supporting: [String]) -> MemoryPresentation {
        MemoryPresentation(
            id: id, title: title, date: when, place: place,
            summary: "その日の空気が、写真のはしに残っている。",
            photoCount: heroes.count + supporting.count, status: .ready, needsConfirmation: false,
            heroPhotos: heroes.enumerated().map { asset($1, $0 + 1, alt: title) },
            memoryContent: [MemoryContentPresentation(id: "\(id)-content", text: "その日の出来事を静かに振り返った。")],
            supportingPhotos: supporting.enumerated().map { asset($1, $0 + 20, alt: title) },
            relatedMemories: []
        )
    }

    /// `name#n` keeps every entry uniquely Identifiable while resolving to one bundled photograph.
    private static func asset(_ name: String, _ index: Int, alt: String? = nil) -> MemoryPhotoPresentation {
        MemoryPhotoPresentation(id: "\(name)#\(index)", temporaryURL: nil, alt: alt ?? name)
    }

    private static func date(_ year: Int, _ month: Int, _ day: Int) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .current
        return calendar.date(from: DateComponents(year: year, month: month, day: day)) ?? Date(timeIntervalSince1970: 0)
    }
}
