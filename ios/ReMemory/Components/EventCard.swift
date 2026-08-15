import SwiftUI

/// One event inside the fixed month: its representative photograph, then the least text that identifies it.
struct EventCard: View {
    let memory: MemoryPresentation
    let width: CGFloat
    let height: CGFloat
    var namespace: Namespace.ID
    var transitionEnabled: Bool
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            VStack(spacing: 14) {
                RemotePhoto(photo: memory.heroPhotos.first)
                    .frame(width: width, height: height)
                    .clipShape(RoundedRectangle(cornerRadius: MemoryDepth.photoRadius, style: .continuous))
                    .memoryPhotoShadow()
                    .memoryTransitionSource(id: memory.id, in: namespace, enabled: transitionEnabled)

                VStack(spacing: 3) {
                    Text(memory.title)
                        .font(.headline)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                    Text(memory.eventContextLine)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .frame(width: width)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(memory.title)、\(memory.eventContextLine)")
    }
}
