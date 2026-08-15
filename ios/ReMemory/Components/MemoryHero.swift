import SwiftUI

struct MemoryHero: View {
    let photos: [MemoryPhotoPresentation]

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            ZStack(alignment: .bottomTrailing) {
                RemotePhoto(photo: photos.first)
                    .frame(width: photos.count > 1 ? width * 0.86 : width, height: proxy.size.height)
                    .clipShape(RoundedRectangle(cornerRadius: 3))
                    .frame(maxWidth: .infinity, alignment: .leading)
                if photos.count > 1 {
                    RemotePhoto(photo: photos[1])
                        .frame(width: width * 0.39, height: proxy.size.height * 0.39)
                        .clipShape(RoundedRectangle(cornerRadius: 2))
                        .shadow(color: .black.opacity(0.12), radius: 7, y: 3)
                        .offset(y: -proxy.size.height * 0.5)
                }
                if photos.count > 2 {
                    RemotePhoto(photo: photos[2])
                        .frame(width: width * 0.39, height: proxy.size.height * 0.39)
                        .clipShape(RoundedRectangle(cornerRadius: 2))
                        .shadow(color: .black.opacity(0.1), radius: 6, y: 2)
                }
            }
        }
        .aspectRatio(1.18, contentMode: .fit)
        .accessibilityElement(children: .contain)
    }
}
