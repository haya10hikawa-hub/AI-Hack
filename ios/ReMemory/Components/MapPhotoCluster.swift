import SwiftUI

/// A place as it stands on the map: the photograph, and only enough text to say
/// where and how much. No card, no pin — the photograph is the marker.
/// The map owns the tap: this is the annotation's face, not a control. A button
/// here would be fighting MapKit's own gesture recognisers for it.
struct MapPhotoCluster: View {
    let cluster: MemoryMapClusterPresentation
    let selected: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var side: CGFloat { selected ? 92 : 78 }

    var body: some View {
        VStack(spacing: 5) {
            RemotePhoto(photo: cluster.representativePhoto)
                .frame(width: side, height: side)
                .clipShape(RoundedRectangle(cornerRadius: MemoryDepth.photoRadius, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: MemoryDepth.photoRadius, style: .continuous)
                        .strokeBorder(.white.opacity(selected ? 0.95 : 0.7), lineWidth: selected ? 2.5 : 1.5)
                )
                .memoryPhotoShadow()

            VStack(spacing: 1) {
                // A merged group of differently-named places has no name of its
                // own; it shows only what is true — how much is standing there.
                if let place = cluster.coarsePlace {
                    Text(place)
                        .font(.caption2.weight(.medium))
                        .lineLimit(1)
                }
                Text("\(cluster.memoryCount) Memories")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            // The map underneath is busy; the label needs a ground of its own
            // to stay readable without becoming a card.
            .background(.regularMaterial, in: Capsule())
            .frame(maxWidth: side + 34)
        }
        // Selection lifts the place slightly rather than announcing itself.
        .scaleEffect(selected ? 1 : 0.96)
        .animation(MemoryMotion.honoring(reduceMotion, MemoryMotion.settle), value: selected)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(cluster.placeLine)、\(cluster.memoryCount)件のMemory")
        .accessibilityAddTraits(.isButton)
    }
}
