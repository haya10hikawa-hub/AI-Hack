import SwiftUI

/// A photo the model could not read with confidence, shown together with the
/// model's own question so the user can settle it on the picture itself.
struct UncertainPhotoPrompt: View {
    let prompt: UncertainPhotoPresentation
    let onDone: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .bottom) {
                RemotePhoto(photo: prompt.photo)
                    .frame(height: 320)
                    .clipped()
                LinearGradient(
                    colors: [.clear, .black.opacity(0.55)],
                    startPoint: .center, endPoint: .bottom
                )
                .frame(height: 130)
                .allowsHitTesting(false)
                Text(prompt.question)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 18)
            }
            HStack(spacing: 12) {
                Button("あとで", action: onDone)
                    .buttonStyle(.plain)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                Button("そう", action: onDone)
                    .buttonStyle(.borderedProminent)
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .padding(16)
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: MemoryDepth.popupRadius, style: .continuous))
        .memoryCardShadow()
        .padding(.horizontal, 24)
    }
}
