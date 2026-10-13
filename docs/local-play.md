# Shared-device play and Go clock

Android and iOS expose **Play on one device** below the normal play selection.
Choose 9×9, 13×13 or 19×19 and one of the existing time controls. Black starts;
legal placements and passes switch the clock. Resigning loses for the current
color. Timeouts include the normal Byo-yomi periods.

The game exists only in component memory. It creates no game, rating, player or
history record. Leaving or reloading discards it. After two passes both clocks
stop. Players can mark complete dead groups and neutral regions, resume play,
or independently confirm the position for Black and White. Any marking change
clears both confirmations.

`POST /api/local-game/score` is a bounded, rate-limited, stateless endpoint available
without login. It replays the move record, validates Japanese ko and settlement
marks, and uses the existing Japanese rulebook to compute the score. Both
agreements are required for a finalized response. Final scoring needs a network
connection; failures leave the position intact for retry or resumption.

**Go clock**, at the bottom of the shared-device setup, runs without a board or
server. Choose a time control, open the clock, then tap to start Black. Each
subsequent tap changes the active color. Pause preserves time already spent in
the current Byo-yomi period; a completed turn restores the remaining period.
Reset and Back are separate controls and never switch turns.

The clock fills the app screen. Portrait viewports render the same landscape
layout rotated by 90 degrees, including confirmation dialogs. Physical landscape
viewports render it directly. Native bridges keep the display awake and hide
system chrome until exit. Android's Back button asks before leaving a running
game or clock; iOS edge gestures are disabled on these routes.

Validation: local clock/game/HTTP tests, bundled mobile browser tests in
`tests/mobile/local-play.spec.ts`, mobile typecheck/build and Android debug build.
Compiling the iOS bridge requires macOS and Xcode.
