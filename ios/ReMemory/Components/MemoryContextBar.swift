import SwiftUI

enum MemoryContextFacet: String, CaseIterable, Identifiable {
    case place, time, photos

    var id: String { rawValue }

    var symbol: String {
        switch self {
        case .place: "mappin"
        case .time: "calendar"
        case .photos: "square.grid.3x3"
        }
    }

    var label: String {
        switch self {
        case .place: "場所"
        case .time: "時期"
        case .photos: "写真"
        }
    }
}

struct MemoryContextBar: View {
    @Binding var selection: MemoryContextFacet
    let openPhotos: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(MemoryContextFacet.allCases.enumerated()), id: \.element.id) { index, facet in
                if index > 0 {
                    Divider().frame(height: 26).opacity(0.4)
                }
                facetButton(facet)
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color.primary.opacity(0.06), lineWidth: 1)
        )
    }

    private func facetButton(_ facet: MemoryContextFacet) -> some View {
        Button {
            if facet == .photos { openPhotos() } else { selection = facet }
        } label: {
            VStack(spacing: 7) {
                Image(systemName: facet.symbol).font(.system(size: 17, weight: .medium))
                Capsule()
                    .fill(Color.primary.opacity(selection == facet ? 0.35 : 0.1))
                    .frame(width: 26, height: 3)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 5)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(selection == facet ? Color.primary : Color.secondary)
        .accessibilityLabel(facet.label)
    }
}
