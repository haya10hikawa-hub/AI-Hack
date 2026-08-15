import SwiftUI

struct RecallFocusCard: View {
    let candidates: [MemoryPresentation]
    var namespace: Namespace.ID
    var transitionEnabled: Bool
    let open: (MemoryPresentation) -> Void

    @State private var arrived = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var single: Bool { candidates.count == 1 }

    var body: some View {
        GeometryReader { proxy in
            let width = min(proxy.size.width * (single ? 0.72 : 0.6), 340)
            let height = width * 1.2
            let margin = max((proxy.size.width - width) / 2, 0)

            ScrollView(.horizontal) {
                LazyHStack(spacing: 16) {
                    ForEach(candidates) { memory in
                        plane(memory, width: width, height: height)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
            .scrollIndicators(.hidden)
            .scrollDisabled(single)
            .contentMargins(.horizontal, margin, for: .scrollContent)
            .frame(height: proxy.size.height, alignment: .center)
            .overlay { if !single { edgeAffordances } }
        }
        .onAppear { arrived = true }
    }

    private func plane(_ memory: MemoryPresentation, width: CGFloat, height: CGFloat) -> some View {
        let still = reduceMotion
        return Button { open(memory) } label: {
            VStack(spacing: 14) {
                // Only the photograph is the zoom source; chrome and title stay behind.
                RemotePhoto(photo: memory.heroPhotos.first)
                    .frame(width: width, height: height)
                    .clipShape(RoundedRectangle(cornerRadius: MemoryDepth.photoRadius, style: .continuous))
                    .shadow(color: .black.opacity(0.4), radius: 24, y: 12)
                    .opacity(arrived ? 1 : 0)
                    .scaleEffect(arrived || reduceMotion ? 1 : 0.94)
                    .animation(photoArrival, value: arrived)
                    .memoryTransitionSource(id: memory.id, in: namespace, enabled: transitionEnabled)

                context(memory)
                    .opacity(arrived ? 1 : 0)
                    .animation(textArrival, value: arrived)
            }
        }
        .buttonStyle(.plain)
        .scrollTransition { content, phase in
            content
                .scaleEffect(still ? 1 : (phase.isIdentity ? 1 : 0.88))
                .opacity(still ? 1 : (phase.isIdentity ? 1 : 0.45))
        }
    }

    private func context(_ memory: MemoryPresentation) -> some View {
        VStack(spacing: 3) {
            Text(memory.title)
                .font(.headline)
                .foregroundStyle(.white.opacity(0.95))
                .lineLimit(1)
            Text(subtitle(memory))
                .font(.caption)
                .foregroundStyle(.white.opacity(0.55))
                .lineLimit(1)
        }
    }

    private func subtitle(_ memory: MemoryPresentation) -> String {
        [memory.date.map { $0.formatted(.dateTime.year().month(.abbreviated).day()) }, memory.place]
            .compactMap { $0 }
            .joined(separator: " · ")
    }

    private var photoArrival: Animation {
        reduceMotion ? .easeOut(duration: 0.2) : .easeOut(duration: 0.4)
    }

    private var textArrival: Animation {
        reduceMotion ? .easeOut(duration: 0.2) : .easeOut(duration: 0.3).delay(0.12)
    }

    private var edgeAffordances: some View {
        HStack {
            Image(systemName: "chevron.left")
            Spacer()
            Image(systemName: "chevron.right")
        }
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(.white.opacity(0.35))
        .padding(.horizontal, 12)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
