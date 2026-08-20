import SwiftUI

/// The events standing at one place, paged horizontally over the map that is
/// still visible behind them. Same gesture as the month deck: the axis changed,
/// the deck did not.
struct PlaceEventDeck: View {
    let cluster: MemoryMapClusterPresentation
    @Binding var selectedMemoryID: String?
    var namespace: Namespace.ID
    var transitionEnabled: Bool
    let open: (MemoryPresentation) -> Void
    let dismiss: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 12) {
            header
            pager.frame(height: 236)
        }
        .padding(.top, 14)
        .padding(.bottom, 10)
        .background(.regularMaterial)
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: MemoryDepth.stackRadius,
                                          topTrailingRadius: MemoryDepth.stackRadius,
                                          style: .continuous))
        .shadow(color: .black.opacity(0.18), radius: 24, y: -6)
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 1) {
                Text(cluster.placeLine).font(.headline)
                Text("\(cluster.memoryCount) Memories").font(.caption2).foregroundStyle(.secondary)
            }
            Spacer()
            Button("閉じる", systemImage: "xmark") { dismiss() }
                .labelStyle(.iconOnly)
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 22)
    }

    private var pager: some View {
        GeometryReader { proxy in
            let width = min(proxy.size.width * 0.52, 200)
            let still = reduceMotion

            ScrollView(.horizontal) {
                LazyHStack(spacing: 16) {
                    ForEach(cluster.memories) { memory in
                        card(memory, width: width)
                            .scrollTransition { content, phase in
                                content
                                    .scaleEffect(still ? 1 : (phase.isIdentity ? 1 : 0.94))
                                    .opacity(still ? 1 : (phase.isIdentity ? 1 : 0.6))
                            }
                            .id(memory.id)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
            .scrollIndicators(.hidden)
            .contentMargins(.horizontal, max((proxy.size.width - width) / 2, 0), for: .scrollContent)
            .scrollPosition(id: $selectedMemoryID, anchor: .center)
        }
    }

    private func card(_ memory: MemoryPresentation, width: CGFloat) -> some View {
        Button { open(memory) } label: {
            VStack(spacing: 10) {
                RemotePhoto(photo: memory.heroPhotos.first)
                    .frame(width: width, height: width * 0.70)
                    .clipShape(RoundedRectangle(cornerRadius: MemoryDepth.photoRadius, style: .continuous))
                    .memoryPhotoShadow()
                    // Continues into the Memory's first plane, the same way the
                    // month deck's event photograph does.
                    .memoryTransitionSource(id: memory.id, in: namespace, enabled: transitionEnabled)

                VStack(spacing: 2) {
                    Text(memory.title).font(.subheadline.weight(.medium)).lineLimit(1)
                    // Where must not cost the user When: the date stays on the card.
                    Text(memory.date?.formatted(.dateTime.year().month(.abbreviated).day()) ?? "日付なし")
                        .font(.caption).foregroundStyle(.primary.opacity(0.62))
                }
                .frame(width: width)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(memory.title)
    }
}
