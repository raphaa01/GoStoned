import Capacitor
import CryptoKit
import Foundation

@objc(GoStoneKataGoPlugin)
public class GoStoneKataGoPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GoStoneKataGoPlugin"
    public let jsName = "GoStoneKataGo"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "analyze", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    private let engineVersion = "v1.18.2"
    private let modelSha256 = "0ba27eced5180b3e3d0b898b280c541112989765e789d1eb6cd0d31b2b2c1229"

    @objc public func getStatus(_ call: CAPPluginCall) {
        guard let model = Bundle.main.url(
            forResource: "b10c384h6nbttflrs",
            withExtension: "katago",
            subdirectory: "public/katago"
        ) else {
            call.resolve(status(available: false, reason: "The bundled KataGo model is missing."))
            return
        }
        do {
            let data = try Data(contentsOf: model, options: [.mappedIfSafe])
            let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            guard digest == modelSha256 else {
                call.resolve(status(available: false, reason: "The bundled KataGo model failed verification."))
                return
            }
        } catch {
            call.resolve(status(available: false, reason: "The bundled KataGo model could not be read."))
            return
        }

        // GoStoneKataGoCore is intentionally a separate static library boundary.
        // It is enabled only after the pinned KataGo Metal build has passed the
        // real-device thermal and output-contract test suite on macOS/Xcode.
        call.resolve(status(
            available: false,
            reason: "The KataGo Metal core has not been linked into this build."
        ))
    }

    @objc public func analyze(_ call: CAPPluginCall) {
        call.reject("The KataGo Metal core is unavailable.", "native_runtime_unavailable")
    }

    @objc public func cancel(_ call: CAPPluginCall) {
        call.resolve()
    }

    private func status(available: Bool, reason: String? = nil) -> JSObject {
        var result: JSObject = [
            "available": available,
            "engineVersion": engineVersion,
            "modelSha256": modelSha256
        ]
        if let reason = reason { result["reason"] = reason }
        return result
    }
}
