// swift-tools-version: 5.9
import Foundation
import PackageDescription

let corePath = "ios/Frameworks/GoStoneKataGoCore.xcframework"
let packageDirectory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let hasNativeCore = FileManager.default.fileExists(
    atPath: packageDirectory.appendingPathComponent(corePath).path
)
var pluginDependencies: [Target.Dependency] = [
    .product(name: "Capacitor", package: "capacitor-swift-pm")
]
var packageTargets: [Target] = []

if hasNativeCore {
    packageTargets.append(.binaryTarget(name: "GoStoneKataGoCore", path: corePath))
    pluginDependencies.append("GoStoneKataGoCore")
}

packageTargets.append(.target(
    name: "GoStoneKataGoPlugin",
    dependencies: pluginDependencies,
    path: "ios/Sources/GoStoneKataGoPlugin",
    linkerSettings: hasNativeCore ? [
        .linkedFramework("CoreML"),
        .linkedFramework("MetalPerformanceShaders"),
        .linkedFramework("MetalPerformanceShadersGraph"),
        .linkedLibrary("c++"),
        .linkedLibrary("z")
    ] : []
))

let package = Package(
    name: "GoStoneKataGo",
    platforms: [.iOS(.v16)],
    products: [
        // Capacitor derives this product name from the npm package id
        // `@gostone/katago` when it regenerates CapApp-SPM/Package.swift.
        .library(name: "GostoneKatago", targets: ["GoStoneKataGoPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: packageTargets
)
