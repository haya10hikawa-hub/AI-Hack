import SwiftUI

struct MemoryHero: View {
    let photos: [MemoryPhotoPresentation]

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            ZStack(alignment: .bottomTrailing) {
                RemotePhoto(photo: photos.first).frame(width: width * 0.84, height: proxy.size.height).clipShape(RoundedRectangle(cornerRadius: 4))
                    .frame(maxWidth: .infinity, alignment: .leading)
                if photos.count > 1 {
                    RemotePhoto(photo: photos[1]).frame(width: width * 0.38, height: proxy.size.height * 0.42).clipShape(RoundedRectangle(cornerRadius: 3))
                        .offset(y: -proxy.size.height * 0.48)
                }
                if photos.count > 2 {
                    RemotePhoto(photo: photos[2]).frame(width: width * 0.38, height: proxy.size.height * 0.42).clipShape(RoundedRectangle(cornerRadius: 3))
                }
            }
        }.frame(height: 310).accessibilityElement(children: .contain)
    }
}
