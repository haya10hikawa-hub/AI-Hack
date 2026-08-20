import PhotosUI
import SwiftUI
import UIKit

struct SelectedPhoto: Identifiable { let id = UUID(); let name: String; let data: Data }

@MainActor
final class UploadViewModel: ObservableObject {
    @Published var pickerItems: [PhotosPickerItem] = []
    @Published var photos: [SelectedPhoto] = []
    @Published var working = false
    @Published var state: UploadViewState = .idle
    @Published var message: String?
    let api: APIClient?
    init(api: APIClient?) { self.api = api }

    func loadSelection() async {
        var loaded: [SelectedPhoto] = []
        for (index, item) in pickerItems.prefix(12).enumerated() {
            guard let raw = try? await item.loadTransferable(type: Data.self),
                  let image = UIImage(data: raw), let jpeg = image.jpegData(compressionQuality: 0.9),
                  jpeg.count <= 15 * 1024 * 1024 else { continue }
            loaded.append(SelectedPhoto(name: "Photo-\(index + 1).jpg", data: jpeg))
        }
        photos = loaded
        state = loaded.isEmpty ? .idle : .selected
        if loaded.count != pickerItems.count { message = "読み込めない写真、または15MBを超える写真を除外しました。" }
    }

    func upload() async {
        guard let api, !photos.isEmpty else { message = "写真を1枚以上選んでください。"; return }
        guard let rawStorage = ProcessInfo.processInfo.environment["REMEMORY_SUPABASE_URL"],
              let storageURL = URL(string: rawStorage),
              storageURL.scheme == "https" || storageURL.scheme == "http" else {
            message = "写真保存先の設定を確認してください。"; return
        }
        working = true; state = .uploading; defer { working = false }
        do {
            let request = UploadPrepareRequestDTO(files: photos.map { UploadFileDTO(name: $0.name, mimeType: "image/jpeg", bytes: $0.data.count) })
            let prepared: UploadPrepareDTO = try await api.post(.uploadPrepare, body: request)
            guard prepared.uploads.count == photos.count else { throw APIError.invalidResponse }
            for slot in prepared.uploads {
                guard photos.indices.contains(slot.clientIndex) else { throw APIError.invalidResponse }
                try await put(photos[slot.clientIndex], slot: slot, storageURL: storageURL)
            }
            state = .processing
            let complete = UploadCompleteRequestDTO(
                manifest: prepared.manifest,
                timezoneOffsetMinutes: TimeZone.current.secondsFromGMT() / 60,
                timezone: TimeZone.current.identifier,
                coarsePlace: nil
            )
            let result: UploadCompleteDTO = try await api.post(.uploadComplete, body: complete)
            state = result.rejected.isEmpty && result.processingState != .partial ? .completed : .partial
            message = result.rejected.isEmpty ? "\(result.accepted.count)枚の写真を追加しました。" : "\(result.accepted.count)枚を追加し、\(result.rejected.count)枚を除外しました。"
            if !result.accepted.isEmpty { photos = []; pickerItems = [] }
        } catch { state = .failed; message = error.localizedDescription }
    }

    private func put(_ photo: SelectedPhoto, slot: UploadSlotDTO, storageURL: URL) async throws {
        var components = URLComponents(url: storageURL
            .appendingPathComponent("storage/v1/object/upload/sign/rememory-private")
            .appendingPathComponent(slot.path), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "token", value: slot.token)]
        guard let url = components?.url else { throw APIError.invalidConfiguration }
        var request = URLRequest(url: url); request.httpMethod = "PUT"; request.timeoutInterval = 120
        request.setValue("false", forHTTPHeaderField: "x-upsert")
        request.setValue("image/jpeg", forHTTPHeaderField: "content-type")
        request.setValue("max-age=0", forHTTPHeaderField: "cache-control")
        let (_, response) = try await URLSession.shared.upload(for: request, from: photo.data)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw APIError.invalidResponse }
    }
}

struct UploadView: View {
    @StateObject private var model: UploadViewModel
    @Environment(\.dismiss) private var dismiss
    init(api: APIClient?) { _model = StateObject(wrappedValue: UploadViewModel(api: api)) }

    var body: some View {
        NavigationStack {
            VStack(spacing: 18) {
                PhotosPicker(selection: $model.pickerItems, maxSelectionCount: 12, matching: .images) {
                    Label("Select Photos", systemImage: "photo.on.rectangle.angled").frame(maxWidth: .infinity)
                }.buttonStyle(.borderedProminent).onChange(of: model.pickerItems) { _, _ in Task { await model.loadSelection() } }
                ScrollView(.horizontal) { LazyHStack { ForEach(model.photos) { photo in
                    if let image = UIImage(data: photo.data) { Image(uiImage: image).resizable().scaledToFill().frame(width: 110, height: 110).clipped() }
                } } }
                if let message = model.message { Text(message).font(.footnote).foregroundStyle(.secondary) }
                Spacer()
                Button(model.working ? "Adding…" : "Add \(model.photos.count) Photos") { Task { await model.upload() } }
                    .buttonStyle(.borderedProminent).disabled(model.working || model.photos.isEmpty).frame(maxWidth: .infinity)
            }.padding().navigationTitle("Add Photos").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
        }
    }
}
