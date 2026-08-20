import SwiftUI

enum MemoryDepth {
    static let stackRadius: CGFloat = 26
    /// Height of one month row in the fixed header; also its snap interval.
    static let monthRowHeight: CGFloat = 54
    static let photoRadius: CGFloat = 14
    static let tileRadius: CGFloat = 10
    static let popupRadius: CGFloat = 22

    static let canvas = Color(uiColor: .secondarySystemBackground)
    static let card = Color(uiColor: .systemBackground)

    static let night = Color(red: 0.07, green: 0.07, blue: 0.075)
    static let nightTile = Color(red: 0.17, green: 0.17, blue: 0.18)

    static func layerScale(_ depth: Int) -> CGFloat { max(0.72, 1 - 0.07 * CGFloat(depth)) }
    static func layerOpacity(_ depth: Int) -> Double { max(0.3, 1 - 0.2 * Double(depth)) }
}

extension View {
    /// Photographs carry their own weight; they get separation, not a drop-shadowed card look.
    func memoryPhotoShadow() -> some View {
        shadow(color: .black.opacity(0.1), radius: 14, y: 6)
    }

    func memoryCardShadow(depth: Int = 0) -> some View {
        shadow(color: .black.opacity(depth == 0 ? 0.14 : 0.07),
               radius: depth == 0 ? 22 : 10,
               y: depth == 0 ? 12 : 5)
    }
}
