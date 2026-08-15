import SwiftUI

struct SupportingPhotoGrid: View {
    let photos: [MemoryPhotoPresentation]
    private let columns = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 8) {
            ForEach(photos) { photo in
                RemotePhoto(photo: photo).aspectRatio(1, contentMode: .fill).clipShape(RoundedRectangle(cornerRadius: 3))
            }
        }.padding(10).background(.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 6))
    }
}
