import SwiftUI

struct ContextualConfirmation: View {
    let question: String
    let suggestion: String?
    let error: String?
    let busy: Bool
    /// Set once the answer has been accepted; drives the brief acknowledgment before collapsing.
    let acknowledged: Bool
    @Binding var correcting: Bool
    @Binding var correction: String
    let confirm: () -> Void
    let dismiss: () -> Void

    @State private var arrived = false
    @FocusState private var answerFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var answer: String { correction.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canSubmit: Bool { !busy && (!correcting || !answer.isEmpty) }

    var body: some View {
        card
            .opacity(arrived ? 1 : 0)
            .scaleEffect(arrived || reduceMotion ? 1 : 0.96)
            .animation(MemoryMotion.honoring(reduceMotion, MemoryMotion.popup) ?? .easeOut(duration: 0.2), value: arrived)
            .onAppear { arrived = true }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(question)
                .font(.subheadline.weight(.medium))
                .fixedSize(horizontal: false, vertical: true)

            if let suggestion, !correcting {
                Text(suggestion)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if correcting {
                TextField("ここに書く", text: $correction, axis: .vertical)
                    .lineLimit(1...3)
                    .textFieldStyle(.plain)
                    .font(.callout)
                    .padding(9)
                    .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .focused($answerFocused)
                    .onSubmit { if canSubmit { confirm() } }
            }

            if let error {
                Text(error).font(.caption).foregroundStyle(.red)
            }

            actions
        }
        .padding(16)
        .frame(maxWidth: 300)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: MemoryDepth.popupRadius, style: .continuous))
        .memoryCardShadow()
        .overlay(alignment: .topTrailing) { dismissControl }
    }

    @ViewBuilder
    private var actions: some View {
        if acknowledged {
            // The only green in the flow: a short pulse that the answer landed.
            HStack {
                Spacer(minLength: 0)
                Image(systemName: "checkmark")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(Color.green, in: Circle())
                    .transition(.scale(scale: 0.7).combined(with: .opacity))
            }
        } else if correcting {
            HStack(spacing: 10) {
                Button("やめる") { correcting = false; answerFocused = false }
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Button("決定", action: confirm)
                    .font(.subheadline.weight(.semibold))
                    .disabled(!canSubmit)
            }
        } else if suggestion != nil {
            HStack(spacing: 10) {
                Button("ちがう") { correcting = true; answerFocused = true }
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Button("そう", action: confirm)
                    .font(.subheadline.weight(.semibold))
                    .disabled(busy)
            }
        } else {
            Button {
                correcting = true
                answerFocused = true
            } label: {
                HStack(spacing: 6) {
                    Text("答える").font(.subheadline.weight(.medium))
                    Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 9)
                .padding(.horizontal, 11)
                .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder
    private var dismissControl: some View {
        if !acknowledged {
            Button(action: dismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.secondary)
                    .frame(width: 22, height: 22)
                    .background(.thinMaterial, in: Circle())
            }
            .offset(x: 7, y: -7)
            .accessibilityLabel("あとで")
        }
    }
}
