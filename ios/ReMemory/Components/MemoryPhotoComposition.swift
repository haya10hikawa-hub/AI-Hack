import SwiftUI

struct MemoryPhotoComposition: View {
    let photos: [MemoryPhotoPresentation]
    var body: some View { MemoryHero(photos: Array(photos.prefix(3))) }
}
