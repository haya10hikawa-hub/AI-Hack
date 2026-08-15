import SwiftUI

struct RecallFocusBackground: View {
    let photo: MemoryPhotoPresentation?

    @State private var arrived = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            MemoryDepth.night
            RemotePhoto(photo: photo)
                .scaleEffect(1.6)
                .blur(radius: 55, opaque: true)
                .opacity(0.8)
            LinearGradient(
                colors: [.black.opacity(0.62), .black.opacity(0.12), .black.opacity(0.72)],
                startPoint: .top, endPoint: .bottom
            )
        }
        .ignoresSafeArea()
        .opacity(arrived ? 1 : 0)
        .animation(.easeOut(duration: reduceMotion ? 0.2 : 0.26), value: arrived)
        .onAppear { arrived = true }
        .accessibilityHidden(true)
    }
}
