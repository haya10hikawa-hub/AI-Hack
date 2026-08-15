import SwiftUI

/// Vertical = month, horizontal = event, depth = memory.
/// The month label is pinned: swiping events never moves the time you are standing in.
struct MonthEventDeck: View {
    let sections: [MemoryMonthSection]
    @Binding var selectedMonthID: String
    @Binding var selectedMemoryID: String?
    var namespace: Namespace.ID
    var transitionEnabled: Bool
    let open: (MemoryPresentation) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var section: MemoryMonthSection? {
        sections.first { $0.id == selectedMonthID } ?? sections.first
    }

    var body: some View {
        VStack(spacing: 0) {
            monthHeader
            eventPager
        }
        .background(MemoryDepth.canvas)
    }

    // MARK: - Fixed month

    private var monthHeader: some View {
        VStack(spacing: 16) {
            // Vertical scroller: one row per month, snapped. The selection drives the deck below.
            ScrollView(.vertical) {
                LazyVStack(spacing: 0) {
                    ForEach(sections) { candidate in
                        monthRow(candidate)
                            .frame(height: MemoryDepth.monthRowHeight)
                            .id(candidate.id)
                    }
                }
                .scrollTargetLayout()
            }
            // Taller than one row so the neighbouring months peek — the vertical axis
            // announces itself the same way the partially visible next event does.
            .frame(height: MemoryDepth.monthRowHeight * 1.42)
            .scrollTargetBehavior(.viewAligned)
            .scrollIndicators(.hidden)
            // Lets the first and last month settle in the centre rather than against an edge.
            .contentMargins(.vertical, MemoryDepth.monthRowHeight * 0.36, for: .scrollContent)
            .scrollPosition(id: monthBinding, anchor: .center)
            .mask(
                // Neighbouring months fade at the edges instead of colliding with the dots below.
                LinearGradient(stops: [
                    .init(color: .clear, location: 0.04),
                    .init(color: .black, location: 0.36),
                    .init(color: .black, location: 0.64),
                    .init(color: .clear, location: 0.96)
                ], startPoint: .top, endPoint: .bottom)
            )

            monthProgress
        }
        .padding(.top, 4)
        .padding(.bottom, 14)
    }

    private func monthRow(_ candidate: MemoryMonthSection) -> some View {
        let active = candidate.id == section?.id
        return VStack(spacing: 2) {
            Text(candidate.title)
                .font(.title2.weight(.semibold))
                .monospacedDigit()
            Text("\(candidate.count) Memories")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .opacity(active ? 1 : 0.28)
        .animation(MemoryMotion.honoring(reduceMotion, MemoryMotion.reveal), value: active)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(candidate.title)、\(candidate.count)件")
    }

    /// A month is a place in a list, not a page number — show position without words.
    private var monthProgress: some View {
        HStack(spacing: 4) {
            ForEach(sections) { candidate in
                Capsule()
                    .fill(Color.primary.opacity(candidate.id == section?.id ? 0.45 : 0.14))
                    .frame(width: candidate.id == section?.id ? 14 : 5, height: 3)
            }
        }
        .animation(MemoryMotion.honoring(reduceMotion, MemoryMotion.settle), value: section?.id)
        .accessibilityHidden(true)
    }

    private var monthBinding: Binding<String?> {
        Binding(
            get: { section?.id },
            set: { if let value = $0, value != selectedMonthID { selectMonth(value) } }
        )
    }

    private func selectMonth(_ id: String) {
        selectedMonthID = id
        // Entering a month starts at its first event; within a month the position is preserved.
        selectedMemoryID = sections.first { $0.id == id }?.memories.first?.id
    }

    // MARK: - Horizontal events

    private var eventPager: some View {
        GeometryReader { proxy in
            let width = min(proxy.size.width * 0.68, 320)
            let height = min(width * 1.24, proxy.size.height - 96)
            let margin = max((proxy.size.width - width) / 2, 0)
            let memories = section?.memories ?? []
            let still = reduceMotion

            ScrollView(.horizontal) {
                LazyHStack(spacing: 18) {
                    ForEach(memories) { memory in
                        EventCard(memory: memory, width: width, height: height,
                                  namespace: namespace, transitionEnabled: transitionEnabled) {
                            open(memory)
                        }
                        .scrollTransition { content, phase in
                            content
                                .scaleEffect(still ? 1 : (phase.isIdentity ? 1 : 0.93))
                                .opacity(still ? 1 : (phase.isIdentity ? 1 : 0.62))
                        }
                        .id(memory.id)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
            .scrollIndicators(.hidden)
            .contentMargins(.horizontal, margin, for: .scrollContent)
            // The anchor must match where a page rests, or the binding never commits
            // and the deck snaps back to the stored event.
            .scrollPosition(id: $selectedMemoryID, anchor: .center)
            .frame(height: proxy.size.height, alignment: .center)
            // Rebuild on month change: the old content offset would otherwise survive
            // the swap and leave the first event of the new month off-centre.
            .id(section?.id)
        }
    }
}
