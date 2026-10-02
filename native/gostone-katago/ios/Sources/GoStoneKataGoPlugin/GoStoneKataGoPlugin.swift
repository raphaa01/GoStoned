import Capacitor
import CryptoKit
import Foundation
import UIKit
#if canImport(GoStoneKataGoCore)
import GoStoneKataGoCore
#endif

private let engineVersion = "v1.18.2"
private let modelSha256 = "0ba27eced5180b3e3d0b898b280c541112989765e789d1eb6cd0d31b2b2c1229"
// One visit evaluates only the root. Two also search a candidate move.
private let previewVisits = 2
private let previewPVLength = 3
private let qualityPVLength = 12
private let initialPreviewPositions = 11
private let previewChunkPositions = 16
private let maximumQualityMoves = 12
private let importantWinrateSwing = 0.05
private let importantScoreSwing = 2.5
private let maximumVisits = 80
private let totalVisitBudget = 900
private let maximumRuntimeSeconds = 90

private struct RuntimeFiles {
    let model: URL
    let config: URL
}

private final class ActiveAnalysis {
    weak var owner: GoStoneKataGoPlugin?
    let id: String
    let call: CAPPluginCall
    let input: JSObject
    let requestedVisits: Int
    let totalTurns: Int
    var qualityVisits = previewVisits
    var phase = "preview"
    var currentRequestId = ""
    var expectedPhaseTurns = 0
    var nextPreviewStart = 0
    var previewChunkIndex = 0
    var qualityTurns: [Int] = []
    var phaseTurns: [Int: JSObject] = [:]
    var bestTurns: [Int: JSObject] = [:]
    var cancelled = false
    var resolved = false
    var timeout: DispatchWorkItem?

    init(
        owner: GoStoneKataGoPlugin,
        id: String,
        call: CAPPluginCall,
        input: JSObject,
        requestedVisits: Int,
        totalTurns: Int
    ) {
        self.owner = owner
        self.id = id
        self.call = call
        self.input = input
        self.requestedVisits = requestedVisits
        self.totalTurns = totalTurns
    }
}

private final class EngineSession {
    weak var owner: GoStoneKataGoPlugin?
    var engine: OpaquePointer?
    var stopping = false

    init(owner: GoStoneKataGoPlugin) {
        self.owner = owner
    }
}

private enum NativeError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self {
        case .message(let value): return value
        }
    }
}

@objc(GoStoneKataGoPlugin)
public class GoStoneKataGoPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GoStoneKataGoPlugin"
    public let jsName = "GoStoneKataGo"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "analyze", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    private let stateQueue = DispatchQueue(label: "com.gostone.katago.ios")
    private var activeAnalysis: ActiveAnalysis?
    private var warmEngine: EngineSession?
    private var verifiedRuntime: RuntimeFiles?
    private var lifecycleObservers: [NSObjectProtocol] = []

    @objc override public func load() {
        lifecycleObservers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in self?.cancelForLifecycle("Local analysis was cancelled in the background.") })
        lifecycleObservers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.willTerminateNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in self?.cancelForLifecycle("Local analysis was cancelled because the app is closing.") })
    }

    deinit {
        for observer in lifecycleObservers { NotificationCenter.default.removeObserver(observer) }
        if let job = activeAnalysis { stop(job) }
        else { stopWarmEngine() }
    }

    @objc public func getStatus(_ call: CAPPluginCall) {
        stateQueue.async {
            #if canImport(GoStoneKataGoCore)
            #if targetEnvironment(simulator)
            call.resolve(self.status(
                available: false,
                reason: "KataGo Metal inference requires a physical iOS device."
            ))
            #else
            do {
                let runtime = try self.ensureRuntime()
                let nativeVersion = String(cString: gostone_katago_version())
                guard nativeVersion == engineVersion else {
                    throw NativeError.message("The linked KataGo core has an unexpected version.")
                }
                _ = try self.ensureWarmEngine(runtime)
                call.resolve(self.status(available: true))
            } catch {
                call.resolve(self.status(available: false, reason: self.safeMessage(error)))
            }
            #endif
            #else
            call.resolve(self.status(
                available: false,
                reason: "The KataGo Metal core has not been linked into this build."
            ))
            #endif
        }
    }

    @objc public func analyze(_ call: CAPPluginCall) {
        #if canImport(GoStoneKataGoCore)
        #if targetEnvironment(simulator)
        call.reject("KataGo Metal inference requires a physical iOS device.", "native_runtime_unavailable")
        #else
        guard let analysisId = call.getString("analysisId"), !analysisId.isEmpty,
              let input = call.getObject("input") else {
            call.reject("A valid analysisId and input are required.", "invalid_analysis_request")
            return
        }
        let requestedVisits = max(1, min(maximumVisits, call.getInt("visitsPerTurn") ?? 20))
        stateQueue.async {
            guard self.activeAnalysis == nil else {
                call.reject("Another local analysis is already running.", "analysis_busy")
                return
            }
            do {
                guard !self.isThermallyConstrained else {
                    throw NativeError.message("The device is too warm to start local analysis.")
                }
                let runtime = try self.ensureRuntime()
                let moveCount = (input["moves"] as? [Any])?.count ?? 0
                let job = ActiveAnalysis(
                    owner: self,
                    id: analysisId,
                    call: call,
                    input: input,
                    requestedVisits: requestedVisits,
                    totalTurns: moveCount + 1
                )
                self.activeAnalysis = job
                _ = try self.ensureWarmEngine(runtime)
                try self.sendNextPreviewChunk(job)
                let timeout = DispatchWorkItem { [weak self, weak job] in
                    guard let self, let job, self.activeAnalysis === job, !job.resolved else { return }
                    self.fail(job, message: "Local analysis reached the 90-second safety limit.")
                }
                job.timeout = timeout
                self.stateQueue.asyncAfter(deadline: .now() + .seconds(maximumRuntimeSeconds), execute: timeout)
            } catch {
                if let job = self.activeAnalysis, job.id == analysisId {
                    job.resolved = true
                    self.stop(job)
                    self.activeAnalysis = nil
                }
                call.reject(self.safeMessage(error), "native_analysis_failed")
            }
        }
        #endif
        #else
        call.reject("The KataGo Metal core is unavailable.", "native_runtime_unavailable")
        #endif
    }

    @objc public func cancel(_ call: CAPPluginCall) {
        let requestedId = call.getString("analysisId")
        stateQueue.async {
            if let job = self.activeAnalysis, requestedId == nil || requestedId == job.id {
                job.cancelled = true
                if !job.resolved {
                    job.resolved = true
                    job.call.reject("Local analysis was cancelled.", "analysis_cancelled")
                }
                self.stop(job)
                if self.activeAnalysis === job { self.activeAnalysis = nil }
            }
            call.resolve()
        }
    }

    private func cancelForLifecycle(_ message: String) {
        stateQueue.async {
            guard let job = self.activeAnalysis else {
                self.stopWarmEngine()
                return
            }
            job.cancelled = true
            if !job.resolved {
                job.resolved = true
                job.call.reject(message, "analysis_cancelled")
            }
            self.stop(job)
            if self.activeAnalysis === job { self.activeAnalysis = nil }
        }
    }

    #if canImport(GoStoneKataGoCore)
    private func ensureRuntime() throws -> RuntimeFiles {
        if let verifiedRuntime { return verifiedRuntime }
        guard let model = Bundle.main.url(
            forResource: "b10c384h6nbttflrs",
            withExtension: "katago",
            subdirectory: "public/katago"
        ) else {
            throw NativeError.message("The bundled KataGo model is missing.")
        }
        guard let config = Bundle.main.url(
            forResource: "analysis-mobile",
            withExtension: "cfg",
            subdirectory: "public/katago"
        ) else {
            throw NativeError.message("The bundled KataGo configuration is missing.")
        }
        let data = try Data(contentsOf: model, options: [.mappedIfSafe])
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        guard digest == modelSha256 else {
            throw NativeError.message("The bundled KataGo model failed verification.")
        }
        let runtimeDirectory = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0].appendingPathComponent("katago/\(engineVersion)", isDirectory: true)
        try FileManager.default.createDirectory(at: runtimeDirectory, withIntermediateDirectories: true)
        let runtimeModel = runtimeDirectory.appendingPathComponent("b10c384h6nbttflrs.bin.gz")
        let existingData = try? Data(contentsOf: runtimeModel, options: [.mappedIfSafe])
        let existingDigest = existingData.map { SHA256.hash(data: $0).map { String(format: "%02x", $0) }.joined() }
        if existingDigest != modelSha256 {
            let temporaryModel = runtimeDirectory.appendingPathComponent("b10c384h6nbttflrs.bin.gz.tmp")
            try? FileManager.default.removeItem(at: temporaryModel)
            try data.write(to: temporaryModel, options: [.atomic])
            try? FileManager.default.removeItem(at: runtimeModel)
            try FileManager.default.moveItem(at: temporaryModel, to: runtimeModel)
        }
        let runtime = RuntimeFiles(model: runtimeModel, config: config)
        verifiedRuntime = runtime
        return runtime
    }

    private func ensureWarmEngine(_ runtime: RuntimeFiles) throws -> EngineSession {
        if let warmEngine, warmEngine.engine != nil, !warmEngine.stopping { return warmEngine }
        if warmEngine != nil {
            throw NativeError.message("The previous KataGo session is still closing.")
        }
        let session = EngineSession(owner: self)
        let retainedContext = Unmanaged.passRetained(session).toOpaque()
        let engine = runtime.model.path.withCString { modelPath in
            runtime.config.path.withCString { configPath in
                gostone_katago_start(
                    modelPath,
                    configPath,
                    { line, context in
                        guard let line, let context else { return }
                        let session = Unmanaged<EngineSession>.fromOpaque(context).takeUnretainedValue()
                        session.owner?.receive(line: String(cString: line))
                    },
                    { exitCode, error, context in
                        guard let context else { return }
                        let session = Unmanaged<EngineSession>.fromOpaque(context).takeRetainedValue()
                        let message = error.map { String(cString: $0) }
                        if let owner = session.owner {
                            owner.engineExited(session, exitCode: exitCode, error: message)
                        } else if let engine = session.engine {
                            DispatchQueue.global().async { gostone_katago_destroy(engine) }
                        }
                    },
                    retainedContext
                )
            }
        }
        guard let engine else {
            Unmanaged<EngineSession>.fromOpaque(retainedContext).release()
            throw NativeError.message("The KataGo Metal core could not be started.")
        }
        session.engine = engine
        warmEngine = session
        return session
    }

    private func request(
        id: String,
        input: JSObject,
        visits: Int,
        pvLength: Int,
        analyzeTurns: [Int]
    ) throws -> JSObject {
        guard let sourceMoves = input["moves"] as? [JSObject], sourceMoves.count <= 1_000 else {
            throw NativeError.message("The game move list is invalid or too large.")
        }
        let boardSize = (input["boardSize"] as? NSNumber)?.intValue ?? input["boardSize"] as? Int ?? 0
        guard [9, 13, 19].contains(boardSize),
              let rules = input["rules"] as? String,
              let komi = input["komi"] as? NSNumber else {
            throw NativeError.message("The analysis position is invalid.")
        }
        let moves = try sourceMoves.map { move -> [String] in
            guard let color = move["color"] as? String, let coordinate = move["move"] as? String else {
                throw NativeError.message("The game contains an invalid move.")
            }
            return [color == "black" ? "B" : "W", coordinate]
        }
        var value: JSObject = [
            "id": id,
            "moves": moves,
            "rules": rules,
            "komi": komi.doubleValue,
            "boardXSize": boardSize,
            "boardYSize": boardSize,
            "maxVisits": visits,
            "analysisPVLen": pvLength,
            "includePolicy": false,
            "analyzeTurns": analyzeTurns
        ]
        if let initialPlayer = input["initialPlayer"] as? String {
            value["initialPlayer"] = initialPlayer == "black" ? "B" : "W"
        }
        if let stones = input["initialStones"] as? [JSObject] {
            value["initialStones"] = try stones.map { stone -> [String] in
                guard let color = stone["color"] as? String, let coordinate = stone["move"] as? String else {
                    throw NativeError.message("The game contains an invalid initial stone.")
                }
                return [color == "black" ? "B" : "W", coordinate]
            }
        }
        if let restrictions = input["allowMoves"] as? [JSObject] {
            value["allowMoves"] = try restrictions.map { restriction -> JSObject in
                guard let player = restriction["player"] as? String,
                      let moves = restriction["moves"] as? [String],
                      let untilDepth = restriction["untilDepth"] as? NSNumber else {
                    throw NativeError.message("The game contains an invalid move restriction.")
                }
                return [
                    "player": player == "black" ? "B" : "W",
                    "moves": moves,
                    "untilDepth": untilDepth.intValue
                ]
            }
        }
        return value
    }

    private func send(_ value: JSObject, to job: ActiveAnalysis) throws {
        guard let engine = warmEngine?.engine, warmEngine?.stopping == false else {
            throw NativeError.message("The KataGo Metal core stopped.")
        }
        let data = try JSONSerialization.data(withJSONObject: value)
        guard let line = String(data: data, encoding: .utf8),
              line.withCString({ gostone_katago_send(engine, $0) }) == 1 else {
            throw NativeError.message("The request could not be sent to KataGo.")
        }
    }

    private func sendNextPreviewChunk(_ job: ActiveAnalysis) throws {
        let start = job.nextPreviewStart
        guard start < job.totalTurns else {
            try startQualityPass(job)
            return
        }
        let size = job.previewChunkIndex == 0 ? initialPreviewPositions : previewChunkPositions
        let end = min(job.totalTurns, start + size)
        let turns = Array(start..<end)
        job.phase = "preview"
        job.currentRequestId = "\(job.id):preview:\(job.previewChunkIndex)"
        job.expectedPhaseTurns = turns.count
        job.phaseTurns.removeAll(keepingCapacity: true)
        job.nextPreviewStart = end
        job.previewChunkIndex += 1
        try send(request(
            id: job.currentRequestId,
            input: job.input,
            visits: previewVisits,
            pvLength: previewPVLength,
            analyzeTurns: turns
        ), to: job)
    }

    private func startQualityPass(_ job: ActiveAnalysis) throws {
        job.qualityTurns = importantTurns(job.bestTurns, moveCount: max(0, job.totalTurns - 1))
        let budgetedVisits = max(previewVisits, totalVisitBudget / max(1, job.qualityTurns.count))
        job.qualityVisits = max(previewVisits, min(job.requestedVisits, budgetedVisits))
        guard !job.qualityTurns.isEmpty, job.qualityVisits > previewVisits else {
            resolve(job, visits: previewVisits, complete: true)
            return
        }
        job.phase = "quality"
        job.currentRequestId = "\(job.id):quality"
        job.expectedPhaseTurns = job.qualityTurns.count
        job.phaseTurns.removeAll(keepingCapacity: true)
        try send(request(
            id: job.currentRequestId,
            input: job.input,
            visits: job.qualityVisits,
            pvLength: qualityPVLength,
            analyzeTurns: job.qualityTurns
        ), to: job)
    }

    private func receive(line: String) {
        stateQueue.async {
            guard let job = self.activeAnalysis else { return }
            guard self.activeAnalysis === job, !job.resolved,
                  let data = line.data(using: .utf8),
                  let response = try? JSONSerialization.jsonObject(with: data) as? JSObject else { return }
            guard response["id"] as? String == job.currentRequestId else { return }
            if let error = response["error"] as? String {
                self.fail(job, message: "KataGo rejected the analysis: \(error)")
                return
            }
            if response["isDuringSearch"] as? Bool == true || response["noResults"] as? Bool == true { return }
            guard let turnNumber = (response["turnNumber"] as? NSNumber)?.intValue,
                  turnNumber >= 0,
                  let root = response["rootInfo"] as? JSObject,
                  let player = root["currentPlayer"] as? String,
                  ["B", "W"].contains(player),
                  root["winrate"] is NSNumber,
                  root["scoreLead"] is NSNumber,
                  response["moveInfos"] is [Any] else {
                self.fail(job, message: "KataGo returned an invalid turn result.")
                return
            }
            job.phaseTurns[turnNumber] = response
            job.bestTurns[turnNumber] = response
            self.emitProgress(job: job, visits: job.phase == "preview" ? previewVisits : job.qualityVisits, turn: response)
            if self.isThermallyConstrained {
                self.fail(job, message: "Local analysis stopped because the device became too warm.")
                return
            }
            guard job.phaseTurns.count >= job.expectedPhaseTurns else { return }
            do {
                if job.phase == "preview" {
                    try self.sendNextPreviewChunk(job)
                } else {
                    self.resolve(job, visits: job.qualityVisits, complete: true)
                }
            } catch {
                self.fail(job, message: self.safeMessage(error))
            }
        }
    }

    private func importantTurns(_ turns: [Int: JSObject], moveCount: Int) -> [Int] {
        guard moveCount > 0 else { return [] }
        let candidates = (1...moveCount).compactMap { moveNumber -> (Int, Double)? in
            guard let before = turns[moveNumber - 1], let after = turns[moveNumber],
                  let beforeWinrate = blackWinrate(before), let afterWinrate = blackWinrate(after),
                  let beforeScore = blackScoreLead(before), let afterScore = blackScoreLead(after) else { return nil }
            let impact = max(
                abs(beforeWinrate - afterWinrate) / importantWinrateSwing,
                abs(beforeScore - afterScore) / importantScoreSwing
            )
            return (moveNumber, impact)
        }.sorted { $0.1 > $1.1 }
        var selected = Set<Int>()
        var selectedMoves = 0
        for candidate in candidates {
            if selectedMoves >= maximumQualityMoves { break }
            if candidate.1 < 1.0 && selectedMoves >= min(3, candidates.count) { break }
            selected.insert(candidate.0 - 1)
            selected.insert(candidate.0)
            selectedMoves += 1
        }
        return selected.sorted()
    }

    private func blackWinrate(_ turn: JSObject) -> Double? {
        guard let root = turn["rootInfo"] as? JSObject,
              let player = root["currentPlayer"] as? String,
              let value = root["winrate"] as? NSNumber else { return nil }
        return player == "B" ? value.doubleValue : 1.0 - value.doubleValue
    }

    private func blackScoreLead(_ turn: JSObject) -> Double? {
        guard let root = turn["rootInfo"] as? JSObject,
              let player = root["currentPlayer"] as? String,
              let value = root["scoreLead"] as? NSNumber else { return nil }
        return player == "B" ? value.doubleValue : -value.doubleValue
    }

    private func engineExited(_ session: EngineSession, exitCode: Int32, error: String?) {
        stateQueue.async {
            if self.warmEngine === session, let job = self.activeAnalysis, !job.resolved {
                let detail = error?.isEmpty == false ? error! : "KataGo stopped unexpectedly (exit \(exitCode))."
                self.fail(job, message: detail, stopEngine: false)
            }
            if let engine = session.engine {
                session.engine = nil
                DispatchQueue.global().async { gostone_katago_destroy(engine) }
            }
            if self.warmEngine === session { self.warmEngine = nil }
        }
    }

    private func stopWarmEngine() {
        guard let session = warmEngine, !session.stopping else { return }
        session.stopping = true
        if let engine = session.engine { gostone_katago_stop(engine) }
    }

    private func stop(_ job: ActiveAnalysis) {
        job.timeout?.cancel()
        stopWarmEngine()
    }
    #else
    private func stop(_ job: ActiveAnalysis) {}
    private func stopWarmEngine() {}
    #endif

    private func resolve(
        _ job: ActiveAnalysis,
        visits: Int,
        complete: Bool,
        warning: String? = nil,
        keepEngine: Bool = true
    ) {
        guard !job.resolved else { return }
        job.resolved = true
        job.timeout?.cancel()
        var result: JSObject = [
            "turns": job.bestTurns.sorted { $0.key < $1.key }.map(\.value),
            "visitsPerTurn": visits,
            "complete": complete
        ]
        if let warning { result["warning"] = warning }
        job.call.resolve(result)
        if activeAnalysis === job { activeAnalysis = nil }
        if !keepEngine { stopWarmEngine() }
    }

    private func fail(_ job: ActiveAnalysis, message: String, stopEngine: Bool = true) {
        guard !job.resolved else { return }
        if job.bestTurns[0] != nil && job.bestTurns[1] != nil && !job.cancelled {
            resolve(job, visits: previewVisits, complete: false, warning: message, keepEngine: !stopEngine)
        } else {
            job.resolved = true
            job.timeout?.cancel()
            job.call.reject(message, job.cancelled ? "analysis_cancelled" : "native_analysis_failed")
            if activeAnalysis === job { activeAnalysis = nil }
            if stopEngine { stopWarmEngine() }
        }
    }

    private var isThermallyConstrained: Bool {
        ProcessInfo.processInfo.thermalState == .serious || ProcessInfo.processInfo.thermalState == .critical
    }

    private func status(available: Bool, reason: String? = nil) -> JSObject {
        var result: JSObject = [
            "available": available,
            "engineVersion": engineVersion,
            "modelSha256": modelSha256
        ]
        if let reason { result["reason"] = reason }
        return result
    }

    private func emitProgress(job: ActiveAnalysis, visits: Int, turn: JSObject) {
        let completedTurns = job.phase == "preview" ? job.bestTurns.count : job.phaseTurns.count
        let totalTurns = job.phase == "preview" ? job.totalTurns : job.qualityTurns.count
        let data: JSObject = [
            "analysisId": job.id,
            "phase": job.phase,
            "completedTurns": completedTurns,
            "totalTurns": totalTurns,
            "visitsPerTurn": visits,
            "thermalState": ProcessInfo.processInfo.thermalState.progressiveName,
            "turn": turn
        ]
        DispatchQueue.main.async { self.notifyListeners("progress", data: data) }
    }

    private func safeMessage(_ error: Error) -> String {
        let message = error.localizedDescription
        return message.isEmpty ? "The local KataGo runtime failed." : message
    }
}

private extension ProcessInfo.ThermalState {
    var progressiveName: String {
        switch self {
        case .nominal: return "nominal"
        case .fair: return "fair"
        case .serious: return "serious"
        case .critical: return "critical"
        @unknown default: return "serious"
        }
    }
}
