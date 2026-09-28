# GoStone KataGo native bridge

This Capacitor plugin owns the native boundary for offline game analysis. Both
platforms verify the bundled model before a native core may run. The JavaScript
client additionally verifies the engine version and model SHA-256 returned by
the plugin.

The plugin is deliberately fail-closed until a real KataGo core is linked. The
upstream v1.18.2 source at commit `fd0723fdbc0e9d82cf269c9630af8c27c57c07c4`
builds a macOS executable, not an iOS static library or XCFramework. Its Metal
backend has no supported iPhone target. Enabling `available: true` before the
following checks pass would make a release claim that has not been validated:

1. Build an arm64 device library and simulator library with Xcode 26 or newer.
2. Wrap the analysis API behind this plugin without spawning a process.
3. Confirm cancellation, progress, one-job concurrency and thermal shutdown.
4. Compare every result field against the server worker on fixed fixtures.
5. Run sustained 9×9, 13×13 and 19×19 analyses on representative iPhones.
6. Package the outputs as `GoStoneKataGoCore.xcframework` and repeat the model
   identity check before enabling the runtime.

Until then, the web application keeps its existing server analysis provider and
native apps report the local engine as unavailable; native apps never fall back
to Modal or the KataGo server.
