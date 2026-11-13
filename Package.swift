// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Piston",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "Piston", path: "Sources/Piston")
    ]
)
