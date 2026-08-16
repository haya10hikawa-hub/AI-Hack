// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ReMemoryMechanicalTests",
    platforms: [.macOS(.v13)],
    products: [.library(name: "ReMemoryCore", targets: ["ReMemoryCore"])],
    targets: [
        .target(
            name: "ReMemoryCore",
            path: "ReMemory",
            exclude: [
                "App", "Components", "PreviewSupport", "Features/Upload",
                "Features/Memories/MemoriesView.swift", "Features/Memory/MemoryView.swift",
                "Features/Recall/RecallView.swift", "Features/Confirmation/ConfirmationView.swift"
            ],
            sources: [
                "Networking", "Transport", "Presentation",
                "Features/Memories/MemoriesViewModel.swift", "Features/Memory/MemoryViewModel.swift",
                "Features/Recall/RecallViewModel.swift", "Features/Confirmation/ConfirmationViewModel.swift"
            ]
        ),
        .testTarget(name: "ReMemoryCoreTests", dependencies: ["ReMemoryCore"])
    ],
    swiftLanguageVersions: [.v5]
)
