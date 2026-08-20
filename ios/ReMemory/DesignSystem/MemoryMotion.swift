import SwiftUI

enum MemoryMotion {
    static let settle = Animation.spring(response: 0.4, dampingFraction: 0.88)
    static let reveal = Animation.easeOut(duration: 0.3)
    /// Dark surface expanding over the Memory, and collapsing back to it.
    static let surface = Animation.easeInOut(duration: 0.38)
    /// Popups arriving on top of a Memory the user is already looking at.
    static let popup = Animation.spring(response: 0.28, dampingFraction: 0.9)

    /// Per-tile delay for the flipped grid; kept small so the grid reads as one surface.
    static func stagger(_ index: Int, step: Double = 0.025, cap: Int = 12) -> Double {
        Double(min(index, cap)) * step
    }

    static func honoring(_ reduceMotion: Bool, _ animation: Animation) -> Animation? {
        reduceMotion ? nil : animation
    }
}
