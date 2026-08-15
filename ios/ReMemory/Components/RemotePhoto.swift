import SwiftUI

struct RemotePhoto: View {
    let photo: MemoryPhotoPresentation?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if let url = photo?.temporaryURL {
                AsyncImage(url: url, transaction: .init(animation: reduceMotion ? nil : .easeInOut)) { phase in
                    switch phase {
                    case let .success(image): image.resizable().scaledToFill()
                    case .failure: placeholder
                    default: ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
            } else {
                placeholder
            }
        }
        .background(Color.secondary.opacity(0.08))
        .clipped()
        .accessibilityLabel(photo?.alt ?? "写真")
    }

    @ViewBuilder
    private var placeholder: some View {
        if PreviewFixtures.isEnabled, let photo, let image = FixturePhotoLibrary.image(photo.id) {
            Image(uiImage: image).resizable().scaledToFill()
        } else if PreviewFixtures.isEnabled, let photo {
            FixturePhotoSurface(seed: photo.id)
        } else {
            Image(systemName: "photo").font(.title).foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

/// Loads the DEBUG-only fixture photographs bundled under PreviewSupport/FixturePhotos.
enum FixturePhotoLibrary {
    private static let cache = NSCache<NSString, UIImage>()

    static func image(_ id: String) -> UIImage? {
        guard PreviewFixtures.isEnabled else { return nil }
        let name = id.split(separator: "#").first.map(String.init) ?? id
        if let cached = cache.object(forKey: name as NSString) { return cached }
        guard let url = Bundle.main.url(forResource: name, withExtension: "jpg"),
              let image = UIImage(contentsOfFile: url.path) else { return nil }
        cache.setObject(image, forKey: name as NSString)
        return image
    }
}

/// Stands in for real photography while running on fixtures so composition and depth stay evaluable.
struct FixturePhotoSurface: View {
    let seed: String

    var body: some View {
        let hue = Double(Self.hash(seed) % 360) / 360
        ZStack {
            LinearGradient(
                colors: [
                    Color(hue: hue, saturation: 0.30, brightness: 0.93),
                    Color(hue: wrap(hue + 0.05), saturation: 0.48, brightness: 0.70),
                    Color(hue: wrap(hue + 0.11), saturation: 0.62, brightness: 0.36)
                ],
                startPoint: .top, endPoint: .bottom
            )
            RadialGradient(
                colors: [.white.opacity(0.55), .clear],
                center: UnitPoint(x: 0.32, y: 0.22), startRadius: 0, endRadius: 260
            )
            Ellipse()
                .fill(Color.black.opacity(0.16))
                .blur(radius: 34)
                .offset(y: 90)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func wrap(_ value: Double) -> Double { value.truncatingRemainder(dividingBy: 1) }

    private static func hash(_ value: String) -> UInt64 {
        var result: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in value.utf8 {
            result ^= UInt64(byte)
            result = result &* 0x0000_0100_0000_01b3
        }
        return result
    }
}
