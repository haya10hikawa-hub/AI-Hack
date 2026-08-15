import SwiftUI

struct MemoryPhotoGrid: View {
    let photos: [MemoryPhotoPresentation]
    let close: () -> Void

    @State private var revealed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 3)

    var body: some View {
        ZStack(alignment: .topTrailing) {
            MemoryDepth.night.ignoresSafeArea()

            ScrollView {
                LazyVGrid(columns: columns, alignment: .leading, spacing: 8) {
                    ForEach(Array(photos.enumerated()), id: \.element.id) { index, photo in
                        // Color.clear sets the square cell; the photo fills it without growing it.
                        Color.clear
                            .aspectRatio(1, contentMode: .fit)
                            .overlay { RemotePhoto(photo: photo) }
                            .clipShape(RoundedRectangle(cornerRadius: MemoryDepth.tileRadius, style: .continuous))
                            .opacity(revealed ? 1 : 0)
                            .scaleEffect(revealed || reduceMotion ? 1 : 0.96)
                            .animation(tileAnimation(index), value: revealed)
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 54)
                .padding(.bottom, 28)
            }
            .scrollIndicators(.hidden)

            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.85))
                    .frame(width: 30, height: 30)
                    .background(MemoryDepth.nightTile, in: Circle())
            }
            .padding(.trailing, 18)
            .padding(.top, 12)
            .opacity(revealed ? 1 : 0)
            .animation(MemoryMotion.reveal, value: revealed)
            .accessibilityLabel("閉じる")
        }
        .preferredColorScheme(.dark)
        .onAppear { revealed = true }
    }

    private func tileAnimation(_ index: Int) -> Animation {
        guard !reduceMotion else { return .easeOut(duration: 0.2) }
        return .easeOut(duration: 0.28).delay(MemoryMotion.stagger(index))
    }
}
