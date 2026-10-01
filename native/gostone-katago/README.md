# GoStone KataGo native bridge

This Capacitor plugin owns the native boundary for offline game analysis. The
Android and iOS implementations are independent; neither changes the Next.js
website or its server analysis provider. Both platforms verify the bundled
model, and the JavaScript client verifies the returned engine identity.

## Android runtime

Android builds KataGo v1.18.2 at commit
`fd0723fdbc0e9d82cf269c9630af8c27c57c07c4` with Eigen 3.4.0 as a CPU-only
Android PIE for `arm64-v8a` and `x86_64`. `npm run mobile:katago:android`
builds it, and `npm run mobile:android:build` includes that step. Generated
sources, build trees and executables stay ignored so Git contains a reproducible
recipe instead of opaque binaries.

The Java plugin verifies the 38 MB model, warms one engine session and keeps it
alive between reviews, permits one job at a time, caps each selected position
at 80 visits, streams the actual turn result, supports cancellation, and stops
at Android's severe thermal state. It first requests positions 0–10 with one
visit, a three-move PV and no policy payload, then continues the preview in
16-position blocks. Every usable block is persisted by the mobile client. Only
the largest fixed-player win-rate or score swings receive the adaptive
900-visit quality budget. The review can therefore open after ten contiguous
moves (or after 28 seconds). A 90-second safety boundary preserves and returns
every usable preview instead of discarding the review. An instrumentation test
runs real 9×9 inference through the local protocol. Real-phone performance and
battery measurements are still required before a store release.

## iOS runtime

On macOS with Xcode 26+, CMake and Ninja installed, run:

```bash
npm run mobile:katago:ios
npm run mobile:sync
```

The first command checks out the exact pinned KataGo commit, applies the
reviewable iOS patch, builds Metal/MPSGraph arm64 slices for iPhone and the
Apple-silicon Simulator, and creates
`native/gostone-katago/ios/Frameworks/GoStoneKataGoCore.xcframework`. The generated framework is
ignored. Swift Package Manager links it only when it exists; otherwise the
plugin remains explicitly fail-closed, so normal web and source-only builds do
not claim that local inference is available.

The iOS plugin runs the analysis protocol in process, verifies the model hash,
retains a warm engine between reviews, and uses the same 0–10-first,
16-position preview chunks and selective quality pass as Android. It permits
one job, streams preview and quality replacements, preserves partial results at
the 90-second limit, and stops on cancellation, backgrounding, or serious
thermal pressure. It requires iOS 16 because KataGo's current MPSGraph
implementation uses APIs introduced there.

The Simulator slice is a compile/link contract only. Xcode 26.6's simulator
Metal driver aborts inside `MPSGraphDevice` when this graph executes, so the
plugin reports the runtime unavailable there instead of risking an application
crash. Inference is enabled only on a physical device.

Before release, compare fixed-fixture output against the server worker and run
sustained 9×9, 13×13 and 19×19 analysis on an older and current real iPhone.
Neither native app silently falls back to Modal or the KataGo server.
