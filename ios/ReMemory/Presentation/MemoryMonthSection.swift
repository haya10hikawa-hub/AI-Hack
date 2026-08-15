import Foundation

/// One month of the timeline: the fixed context the events underneath belong to.
struct MemoryMonthSection: Identifiable {
    let id: String
    let title: String
    let year: Int
    let month: Int
    let memories: [MemoryPresentation]

    var count: Int { memories.count }
}

enum MemoryMonthBuilder {
    static func sections(from memories: [MemoryPresentation]) -> [MemoryMonthSection] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current

        var order: [String] = []
        var grouped: [String: [MemoryPresentation]] = [:]
        var stamps: [String: (year: Int, month: Int)] = [:]

        for memory in memories {
            let parts = memory.date.map { calendar.dateComponents([.year, .month], from: $0) }
            let year = parts?.year ?? 0
            let month = parts?.month ?? 0
            let key = memory.date == nil ? "undated" : "\(year)-\(month)"
            if grouped[key] == nil {
                order.append(key)
                stamps[key] = (year, month)
            }
            grouped[key, default: []].append(memory)
        }

        return order.map { key in
            let bucket = grouped[key] ?? []
            let stamp = stamps[key] ?? (0, 0)
            return MemoryMonthSection(id: key, title: title(for: bucket.first?.date),
                                      year: stamp.year, month: stamp.month, memories: bucket)
        }
    }

    private static func title(for date: Date?) -> String {
        guard let date else { return "日付なし" }
        return date.formatted(.dateTime.year().month(.wide))
    }
}

extension MemoryPresentation {
    /// Day and place only — the month already sits fixed above the deck.
    var eventContextLine: String {
        [date.map { $0.formatted(.dateTime.month(.abbreviated).day()) }, place]
            .compactMap { $0 }
            .joined(separator: " · ")
    }
}
