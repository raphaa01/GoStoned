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

The Java plugin verifies the 38 MB model, permits one job at a time, caps each
position at 80 visits, streams progress, supports cancellation, and stops at
Android's severe thermal state. An instrumentation test runs real 9×9 inference
through the local protocol. Real-phone performance and battery measurements are
still required before a store release.

## iOS runtime

The separate Swift plugin, model verification, Capacitor contract and project
wiring are ready, but iOS deliberately remains fail-closed. Upstream KataGo does
not ship an iPhone static library/XCFramework target, and that native link cannot
be built or validated on Windows. Enabling `available: true` requires:

1. Build an arm64 device library and simulator library with Xcode 26 or newer.
2. Wrap the analysis API behind this plugin without spawning a process.
3. Confirm cancellation, progress, one-job concurrency and thermal shutdown.
4. Compare every result field against the server worker on fixed fixtures.
5. Run sustained 9×9, 13×13 and 19×19 analyses on representative iPhones.
6. Package the outputs as `GoStoneKataGoCore.xcframework` and repeat the model
   identity check before enabling the runtime.

Until then, the website keeps its server analysis provider, Android uses only
its local runtime, and iOS reports the local engine as unavailable. Neither
native app silently falls back to Modal or the KataGo server.
