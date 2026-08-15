import CoreLocation
import Foundation

struct MemoryMapClusterPresentation: Identifiable {
    let id: String
    let cellIDs: [String]
    let coordinate: CLLocationCoordinate2D
    let coarsePlace: String?
    let state: MemoryMapState
    let memoryCount: Int
    let memories: [MemoryPresentation]
    let representativePhoto: MemoryPhotoPresentation?

    var placeLine: String { coarsePlace ?? "この地域" }
}

struct MemoryMapPresentation {
    var clusters: [MemoryMapClusterPresentation] = []
    var unplacedMemoryCount = 0
    var partialMessage: String?
    var isEmpty: Bool { clusters.isEmpty }
}

enum MemoryMapClusterBuilder {
    static func clusters(from cells: [MemoryMapCellDTO], memories: [MemoryPresentation]) -> [MemoryMapClusterPresentation] {
        let byID = Dictionary(uniqueKeysWithValues: memories.map { ($0.id, $0) })
        return cells.compactMap { cell in
            guard let center = cell.center, cell.memoryCount > 0 else { return nil }
            let joined = cell.memories.compactMap { byID[$0.id] }
            return MemoryMapClusterPresentation(
                id: cell.cellId,
                cellIDs: [cell.cellId],
                coordinate: .init(latitude: center.latitude, longitude: center.longitude),
                coarsePlace: place(cell.coarsePlace, memories: joined),
                state: cell.state,
                memoryCount: cell.memoryCount,
                memories: joined,
                representativePhoto: joined.lazy.compactMap { $0.heroPhotos.first }.first
            )
        }
    }

    static func unplacedMemoryCount(in cells: [MemoryMapCellDTO]) -> Int {
        cells.filter { $0.center == nil }.reduce(0) { $0 + $1.memoryCount }
    }

    static func merging(_ clusters: [MemoryMapClusterPresentation], within distance: CLLocationDistance)
        -> [MemoryMapClusterPresentation]
    {
        guard distance > 0, clusters.count > 1 else { return clusters }
        var groups: [[MemoryMapClusterPresentation]] = []
        for cluster in clusters {
            if let index = groups.firstIndex(where: { group in
                group.contains { metres(from: $0.coordinate, to: cluster.coordinate) <= distance }
            }) { groups[index].append(cluster) } else { groups.append([cluster]) }
        }
        return groups.map(merge)
    }

    static func mergeDistance(spanMetres: CLLocationDistance, widthPoints: Double) -> CLLocationDistance {
        guard spanMetres > 0, widthPoints > 0 else { return 0 }
        return spanMetres / widthPoints * 116
    }

    private static func merge(_ group: [MemoryMapClusterPresentation]) -> MemoryMapClusterPresentation {
        guard group.count > 1 else { return group[0] }
        let anchor = group[0]
        let memories = group.flatMap(\.memories).sorted { ($0.date ?? .distantPast) > ($1.date ?? .distantPast) }
        return MemoryMapClusterPresentation(
            id: anchor.id, cellIDs: group.flatMap(\.cellIDs), coordinate: mean(group.map(\.coordinate)),
            coarsePlace: Set(group.map(\.coarsePlace)).count == 1 ? anchor.coarsePlace : nil,
            state: anchor.state, memoryCount: group.reduce(0) { $0 + $1.memoryCount }, memories: memories,
            representativePhoto: memories.lazy.compactMap { $0.heroPhotos.first }.first
        )
    }

    private static func place(_ cellPlace: String?, memories: [MemoryPresentation]) -> String? {
        ([cellPlace] + memories.map(\.place)).compactMap { $0 }.first { !$0.hasPrefix("grid:") }
    }

    private static func metres(from lhs: CLLocationCoordinate2D, to rhs: CLLocationCoordinate2D) -> CLLocationDistance {
        CLLocation(latitude: lhs.latitude, longitude: lhs.longitude)
            .distance(from: CLLocation(latitude: rhs.latitude, longitude: rhs.longitude))
    }

    private static func mean(_ values: [CLLocationCoordinate2D]) -> CLLocationCoordinate2D {
        let count = Double(values.count)
        return .init(latitude: values.reduce(0) { $0 + $1.latitude } / count,
                     longitude: values.reduce(0) { $0 + $1.longitude } / count)
    }
}
