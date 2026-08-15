import SwiftUI

struct MemoryThumbnail: View {
    enum Style { case large, small, focus }
    let memory: MemoryPresentation
    var style: Style = .small

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            RemotePhoto(photo: memory.heroPhotos.first)
                .aspectRatio(imageRatio, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 3))
            Text(memory.title).font(style == .focus ? .title2 : .headline).lineLimit(2)
            HStack(spacing: 6) {
                if let date = memory.date { Text(date, style: .date) }
                if let place = memory.place { Text(place).lineLimit(1) }
            }.font(.caption).foregroundStyle(.secondary)
        }.accessibilityElement(children: .combine)
    }

    private var imageRatio: CGFloat { style == .small ? 0.82 : 1.35 }
}

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
            } else { placeholder }
        }.background(Color.secondary.opacity(0.08)).clipped()
    }
    private var placeholder: some View {
        Image(systemName: "photo").font(.title).foregroundStyle(.tertiary).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
