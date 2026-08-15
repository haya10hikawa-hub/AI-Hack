import SwiftUI

struct MemoryLayeredHero: View {
    let photos: [MemoryPhotoPresentation]
    /// False until the zoomed-in photograph has landed, so the Memory reads photo-first.
    var sidesRevealed: Bool = true
    let openGrid: () -> Void

    @State private var focused: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(photos: [MemoryPhotoPresentation], sidesRevealed: Bool = true, openGrid: @escaping () -> Void) {
        self.photos = photos
        self.sidesRevealed = sidesRevealed
        self.openGrid = openGrid
        // Seeded here rather than in onAppear: the scroll position must be known at first
        // layout, otherwise the deck rests on the leading plane and the left fragment is lost.
        _focused = State(initialValue: photos[safe: photos.count / 2]?.id)
    }

    var body: some View {
        GeometryReader { proxy in
            let width = min(proxy.size.width * 0.62, 300)
            let height = min(width * 1.34, proxy.size.height)
            let margin = max((proxy.size.width - width) / 2, 0)

            ScrollView(.horizontal) {
                // Eager: at most three planes, and a lazy stack has not realised the
                // middle one at first layout, so the initial centring would be dropped.
                HStack(spacing: 20) {
                    ForEach(photos) { photo in
                        plane(photo, width: width, height: height)
                    }
                }
                .scrollTargetLayout()
                // Padding inside the content rather than contentMargins: the resting offset
                // then falls out of the layout, so the middle plane is centred at first paint
                // instead of depending on a scroll command that is dropped before layout.
                .safeAreaPadding(.horizontal, margin)
            }
            .scrollTargetBehavior(.viewAligned)
            .scrollIndicators(.hidden)
            // Sole owner of the resting offset. A scrollPosition binding alongside it wrote
            // back the leading plane on some layout passes and fought the anchor, which made
            // the middle plane centre only intermittently.
            .defaultScrollAnchor(.center)
            .frame(height: proxy.size.height, alignment: .center)
        }
        .accessibilityElement(children: .contain)
    }

    /// Side fragments settle inward toward the landed centre.
    private func sideOffset(_ photo: MemoryPhotoPresentation) -> CGFloat {
        guard let focused, let here = photos.firstIndex(where: { $0.id == photo.id }),
              let centre = photos.firstIndex(where: { $0.id == focused }) else { return 0 }
        return here < centre ? 14 : -14
    }

    private var sideArrival: Animation {
        reduceMotion ? .easeOut(duration: 0.2) : .easeOut(duration: 0.3)
    }

    private func plane(_ photo: MemoryPhotoPresentation, width: CGFloat, height: CGFloat) -> some View {
        let isCenter = photo.id == focused
        let still = reduceMotion
        return Button(action: openGrid) {
            RemotePhoto(photo: photo)
                .frame(width: width, height: height)
                .clipShape(RoundedRectangle(cornerRadius: MemoryDepth.photoRadius, style: .continuous))
                .memoryPhotoShadow()
        }
        .buttonStyle(.plain)
        .opacity(isCenter || sidesRevealed ? 1 : 0)
        .scaleEffect(isCenter || sidesRevealed || reduceMotion ? 1 : 0.96)
        .offset(x: isCenter || sidesRevealed || reduceMotion ? 0 : sideOffset(photo))
        .animation(sideArrival, value: sidesRevealed)
        .scrollTransition { content, phase in
            // Resting side planes stay legible fragments (0.94 / 0.6), not blurred debris.
            content
                .scaleEffect(still ? 1 : (phase.isIdentity ? 1 : 0.94))
                .opacity(still ? 1 : (phase.isIdentity ? 1 : 0.6))
        }
    }
}

extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
