import MapKit
import SwiftUI

/// Where, as the third way into the same Memory. The map is the surface, not a
/// panel on one: photographs stand on it at the coarse cells their memories were
/// filed to, and a place opens into its events without ever leaving the map.
struct MapView: View {
    @StateObject private var model: MapViewModel
    @State private var camera: MapCameraPosition = .automatic
    @State private var region: MKCoordinateRegion?
    @State private var width: Double = 0
    @State private var path: [String] = []
    // Held here, not in the deck, so returning from a Memory keeps the same place.
    @State private var selectedCellID: String?
    /// What MapKit reports the user touched, before it is resolved to a place.
    @State private var tappedClusterID: String?
    @State private var selectedMemoryID: String?
    @Namespace private var transitionNamespace
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let configurationError: String?

    /// Beyond this the map stops being readable and starts being expensive.
    private let visibleClusterLimit = 40

    init(api: APIClient?, configurationError: String?) {
        _model = StateObject(wrappedValue: MapViewModel(api: api)); self.configurationError = configurationError
    }

    var body: some View {
        NavigationStack(path: $path) {
            content
                .navigationTitle("")
                .navigationBarTitleDisplayMode(.inline)
                .navigationDestination(for: String.self) {
                    MemoryView(memoryId: $0, api: model.api, transitionNamespace: transitionNamespace,
                               transitionEnabled: !reduceMotion)
                }
                .toolbar(selectedCluster == nil ? .visible : .hidden, for: .tabBar)
                .task { if !PreviewFixtures.isEnabled { await model.load() } }
        }
    }

    @ViewBuilder
    private var content: some View {
        ZStack(alignment: .bottom) {
            map

            if model.state == .loading && clusters.isEmpty {
                // Quiet: the map is already there, only the places are still coming.
                ProgressView().padding(14).background(.regularMaterial, in: Circle())
                    .frame(maxHeight: .infinity, alignment: .center)
            } else if let message = visibleError, clusters.isEmpty {
                notice(title: "地図を読み込めません", message: message, retry: true)
            } else if clusters.isEmpty {
                notice(title: "場所のあるMemoryはまだありません",
                       message: unplacedNote ?? "位置の記録があるMemoryが増えると、ここに現れます。", retry: false)
            }

            if let cluster = selectedCluster {
                PlaceEventDeck(cluster: cluster, selectedMemoryID: $selectedMemoryID,
                               namespace: transitionNamespace, transitionEnabled: !reduceMotion,
                               open: { open($0) }, dismiss: { select(nil) })
                    // The deck sits above the home indicator, never under it.
                    .padding(.bottom, 6)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .ignoresSafeArea(edges: .top)
        .animation(MemoryMotion.honoring(reduceMotion, MemoryMotion.settle), value: selectedCellID)
    }

    // MARK: - Map

    private var map: some View {
        Map(position: $camera, interactionModes: .all, selection: $tappedClusterID) {
            ForEach(visibleClusters) { cluster in
                Annotation(cluster.placeLine, coordinate: cluster.coordinate, anchor: .bottom) {
                    MapPhotoCluster(cluster: cluster, selected: cluster.id == selectedCluster?.id)
                }
                // MapKit resolves any residual overlap; nothing is nudged by hand.
                .annotationTitles(.hidden)
                .tag(cluster.id)
            }
        }
        .onChange(of: tappedClusterID) { _, value in
            select(value.flatMap { id in clusters.first { $0.id == id } })
        }
        .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
        .mapControls { MapCompass() }
        // The map stays legible behind the deck, just quieter.
        .overlay(Color.black.opacity(selectedCluster == nil ? 0 : 0.22).ignoresSafeArea().allowsHitTesting(false))
        .onMapCameraChange(frequency: .onEnd) { context in
            region = context.region
        }
        .background(GeometryReader { proxy in
            Color.clear.onAppear { width = proxy.size.width }
                .onChange(of: proxy.size.width) { _, value in width = value }
        })
    }

    @ViewBuilder
    private func notice(title: String, message: String, retry: Bool) -> some View {
        VStack(spacing: 10) {
            Text(title).font(.headline)
            Text(message).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            if retry {
                Button("再試行") { Task { await model.load() } }.buttonStyle(.bordered)
            }
        }
        .padding(22)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: MemoryDepth.popupRadius, style: .continuous))
        .padding(.horizontal, 34)
        .frame(maxHeight: .infinity, alignment: .center)
    }

    // MARK: - Selection

    private func select(_ cluster: MemoryMapClusterPresentation?) {
        selectedCellID = cluster?.cellIDs.first
        selectedMemoryID = cluster?.memories.first?.id
        // Kept in step so closing the deck lets the same place be tapped again.
        tappedClusterID = cluster?.id
        guard let cluster else { return }
        // Stay where we are and close in slightly: the surrounding places must not
        // disappear, or the map stops being the thing being explored.
        // A nudge closer, not a jump: whatever the user was looking at stays
        // recognisable around the place they picked.
        let span = region.map { max($0.span.latitudeDelta * 0.6, 0.006) } ?? 0.02
        withAnimation(MemoryMotion.honoring(reduceMotion, MemoryMotion.settle)) {
            camera = .region(MKCoordinateRegion(center: cluster.coordinate,
                                                span: MKCoordinateSpan(latitudeDelta: span, longitudeDelta: span)))
        }
    }

    private func open(_ memory: MemoryPresentation) {
        selectedMemoryID = memory.id
        path.append(memory.id)
    }

    // MARK: - Data

    private var clusters: [MemoryMapClusterPresentation] {
        let base = PreviewFixtures.isEnabled ? PreviewFixtures.mapClusters : model.map.clusters
        guard let region, width > 0 else { return base }
        let metres = region.span.latitudeDelta * 111_000
        return MemoryMapClusterBuilder.merging(
            base, within: MemoryMapClusterBuilder.mergeDistance(spanMetres: metres, widthPoints: width)
        )
    }

    /// Only what the camera can show, and only as many as stay readable. A place
    /// that is currently selected is never dropped from under the deck.
    private var visibleClusters: [MemoryMapClusterPresentation] {
        let all = clusters
        guard let region else { return Array(all.prefix(visibleClusterLimit)) }
        let latitude = region.span.latitudeDelta * 0.75
        let longitude = region.span.longitudeDelta * 0.75
        let inside = all.filter {
            abs($0.coordinate.latitude - region.center.latitude) <= latitude
                && abs($0.coordinate.longitude - region.center.longitude) <= longitude
        }
        var shown = Array(inside.sorted { $0.memoryCount > $1.memoryCount }.prefix(visibleClusterLimit))
        if let selected = selectedCluster, !shown.contains(where: { $0.id == selected.id }) {
            shown.append(selected)
        }
        return shown
    }

    /// The selected H3 cell remains the spatial identity across navigation.
    private var selectedCluster: MemoryMapClusterPresentation? {
        guard let selectedCellID else { return nil }
        return clusters.first { $0.cellIDs.contains(selectedCellID) }
    }

    private var unplacedNote: String? {
        let count = PreviewFixtures.isEnabled ? 0 : model.map.unplacedMemoryCount
        return count == 0 ? nil : "\(count)件のMemoryは場所の記録がないため、地図には置いていません。"
    }

    private var visibleError: String? { PreviewFixtures.isEnabled ? nil : model.error ?? configurationError }
}
