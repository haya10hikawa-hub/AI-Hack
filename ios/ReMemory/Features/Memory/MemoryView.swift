import SwiftUI

struct MemoryView: View {
    @StateObject private var model: MemoryViewModel
    @State private var facet: MemoryContextFacet = .place
    @State private var showingGrid = false
    @State private var showingConfirmation = false
    @State private var correcting = false
    @State private var correction = ""
    @State private var confirming = false
    @State private var confirmationError: String?
    @State private var acknowledged = false
    @State private var sidesRevealed = false
    @State private var contextRevealed = false
    @State private var uncertainPrompt: UncertainPhotoPresentation?
    private let memoryId: String
    private let transitionNamespace: Namespace.ID
    private let transitionEnabled: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(memoryId: String, api: APIClient?, transitionNamespace: Namespace.ID, transitionEnabled: Bool) {
        self.memoryId = memoryId; self.transitionNamespace = transitionNamespace; self.transitionEnabled = transitionEnabled
        _model = StateObject(wrappedValue: MemoryViewModel(memoryId: memoryId, api: api))
    }

    var body: some View {
        Group {
            if let memory {
                layered(memory)
            } else if let error = model.error {
                ContentUnavailableView("読み込めません", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                ProgressView()
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar(showingGrid ? .hidden : .visible, for: .navigationBar)
        .memoryNavigationTransition(id: memoryId, in: transitionNamespace, enabled: transitionEnabled)
        .overlay { gridOverlay }
        .sheet(item: $uncertainPrompt) { prompt in
            UncertainPhotoPrompt(prompt: prompt) { uncertainPrompt = nil }
        }
        .task {
            if !PreviewFixtures.isEnabled { await model.load() }
            if let route = PreviewFixtures.route {
                showingGrid = route == .grid
                showingConfirmation = route == .confirm
            } else {
                showingConfirmation = confirmation != nil
            }
            await arrive()
        }
    }

    /// LOOK → REMEMBER → READ: the photograph lands alone, then its fragments, then the words.
    private func arrive() async {
        guard !reduceMotion else { sidesRevealed = true; contextRevealed = true; return }
        try? await Task.sleep(nanoseconds: 140_000_000)
        sidesRevealed = true
        try? await Task.sleep(nanoseconds: 110_000_000)
        contextRevealed = true
    }

    private func layered(_ memory: MemoryPresentation) -> some View {
        VStack(spacing: 0) {
            MemoryLayeredHero(photos: heroPlanes(memory), sidesRevealed: sidesRevealed) { openGrid() }
                .frame(maxHeight: .infinity)
                .padding(.top, 8)

            VStack(spacing: 5) {
                Text(memory.title).font(.title3.weight(.semibold)).multilineTextAlignment(.center)
                Text(contextLine(memory)).font(.footnote).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .animation(MemoryMotion.honoring(reduceMotion, MemoryMotion.reveal), value: facet)
            }
            .padding(.horizontal, 28)
            .padding(.top, 22)
            .opacity(contextRevealed ? 1 : 0)
            .animation(contextArrival, value: contextRevealed)

            Spacer(minLength: 18)

            MemoryContextBar(selection: $facet) { openGrid() }
                .padding(.horizontal, 34)
                .padding(.bottom, 10)
                .opacity(contextRevealed ? 1 : 0)
                .animation(contextArrival, value: contextRevealed)

            if !memory.uncertainPhotos.isEmpty {
                Button { uncertainPrompt = memory.uncertainPhotos.first } label: {
                    Label("この写真について確認したい", systemImage: "questionmark.circle")
                        .font(.footnote.weight(.medium))
                        .padding(.vertical, 7)
                        .padding(.horizontal, 13)
                        .background(.regularMaterial, in: Capsule())
                }
                .buttonStyle(.plain)
                .padding(.bottom, 10)
                .opacity(contextRevealed ? 1 : 0)
                .animation(contextArrival, value: contextRevealed)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(MemoryDepth.canvas)
        .scaleEffect(showingGrid && !reduceMotion ? 1.04 : 1)
        .opacity(showingGrid ? 0 : 1)
        .overlay { confirmationOverlay(memory) }
    }

    /// The grid lives inside the Memory rather than in a cover, so the dark surface expands in place.
    @ViewBuilder
    private var gridOverlay: some View {
        if showingGrid {
            MemoryPhotoGrid(photos: gridPhotos) { closeGrid() }
                .transition(.opacity)
        }
    }

    private func openGrid() {
        withAnimation(MemoryMotion.honoring(reduceMotion, MemoryMotion.surface)) { showingGrid = true }
    }

    private func closeGrid() {
        withAnimation(MemoryMotion.honoring(reduceMotion, MemoryMotion.surface)) { showingGrid = false }
    }

    @ViewBuilder
    private func confirmationOverlay(_ memory: MemoryPresentation) -> some View {
        if showingConfirmation, let confirmation {
            ZStack {
                // The Memory stays put behind the popup, keyboard included.
                RemotePhoto(photo: memory.heroPhotos.first)
                    .overlay(Color.black.opacity(0.22))
                    .ignoresSafeArea()
                    .ignoresSafeArea(.keyboard)

                ContextualConfirmation(
                    question: confirmation.question,
                    suggestion: confirmation.suggestion,
                    error: confirmationError,
                    busy: confirming,
                    acknowledged: acknowledged,
                    correcting: $correcting,
                    correction: $correction,
                    confirm: { resolve(confirmation) },
                    dismiss: { close() }
                )
                .offset(y: -70)
                .animation(MemoryMotion.honoring(reduceMotion, MemoryMotion.popup), value: acknowledged)
            }
            .transition(.opacity)
            .animation(MemoryMotion.honoring(reduceMotion, MemoryMotion.settle), value: showingConfirmation)
        }
    }

    private func resolve(_ confirmation: ConfirmationPresentation) {
        if PreviewFixtures.isEnabled { Task { await acknowledge() }; return }
        let saver = ConfirmationViewModel(item: confirmation, api: model.api)
        saver.correcting = correcting
        saver.correction = correction
        confirming = true
        Task {
            let saved = await saver.save()
            confirming = false
            confirmationError = saver.error
            if saved {
                await acknowledge()
                await model.load()
            }
        }
    }

    /// A brief pulse that the answer landed, then the Memory is all that is left.
    private func acknowledge() async {
        acknowledged = true
        try? await Task.sleep(nanoseconds: reduceMotion ? 150_000_000 : 220_000_000)
        close()
        try? await Task.sleep(nanoseconds: 300_000_000)
        acknowledged = false
        correcting = false
        correction = ""
    }

    private var contextArrival: Animation {
        reduceMotion ? .easeOut(duration: 0.18) : .easeOut(duration: 0.26)
    }

    private func close() {
        withAnimation(MemoryMotion.honoring(reduceMotion, MemoryMotion.settle)) { showingConfirmation = false }
    }

    /// At most three planes build the Memory; anything beyond belongs to the flipped grid.
    /// The representative photograph is placed at the centre index so the plane the user
    /// zoomed in from stays the dominant one, with a fragment on either side of it.
    private func heroPlanes(_ memory: MemoryPresentation) -> [MemoryPhotoPresentation] {
        let source = Array((memory.heroPhotos.isEmpty ? memory.supportingPhotos : memory.heroPhotos).prefix(3))
        guard source.count > 1 else { return source }
        var planes = Array(source.dropFirst())
        planes.insert(source[0], at: planes.count / 2)
        return planes
    }

    private func contextLine(_ memory: MemoryPresentation) -> String {
        switch facet {
        case .place: memory.place ?? "場所は記録されていません"
        case .time: memory.date.map { $0.formatted(date: .long, time: .omitted) } ?? "日付は記録されていません"
        case .photos: memory.summary ?? ""
        }
    }

    private var gridPhotos: [MemoryPhotoPresentation] {
        guard let memory else { return [] }
        return memory.supportingPhotos.isEmpty ? memory.heroPhotos : memory.heroPhotos + memory.supportingPhotos
    }

    private var memory: MemoryPresentation? { PreviewFixtures.isEnabled ? PreviewFixtures.memory(id: memoryId) : model.memory }
    private var confirmation: ConfirmationPresentation? {
        PreviewFixtures.isEnabled && memoryId == PreviewFixtures.confirmation.memoryId ? PreviewFixtures.confirmation : model.confirmation
    }
}
