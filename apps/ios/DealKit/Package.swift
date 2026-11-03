// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "DealKit",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "DealEngine", targets: ["DealEngine"]),
        .library(name: "DealAI", targets: ["DealAI"]),
        .library(name: "DealStats", targets: ["DealStats"]),
        .library(name: "DealOnline", targets: ["DealOnline"]),
        .library(name: "DealNearby", targets: ["DealNearby"]),
    ],
    targets: [
        .target(name: "DealEngine"),
        .target(name: "DealAI", dependencies: ["DealEngine"]),
        .target(name: "DealStats", dependencies: ["DealEngine"]),
        .target(name: "DealOnline", dependencies: ["DealEngine"]),
        .target(name: "DealNearby", dependencies: ["DealEngine"]),
        .testTarget(
            name: "DealKitTests",
            dependencies: ["DealEngine", "DealAI", "DealStats", "DealOnline", "DealNearby"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
