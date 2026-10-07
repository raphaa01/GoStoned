# Mobile beta fixes

The native shell now applies the selected palette to its WebView, status area
and tab bar, disables iOS bounce, and lets CSS own the safe-area insets. Guest,
login and home decoration stones switch to white in dark mode. The initial
HTML palette is selected before the React bundle loads.

iOS keeps its existing tab items during route changes instead of resetting the
Liquid Glass selection through Home. A left-edge swipe returns through the
client history; both native and client guards disable it on game and training
routes. Lessons pin Continue above the tabs. Portrait leaderboards show rating,
games and wins within the viewport. Play gives Time control more space.

The shared web/app game displays the latest pass above the board and offers a
small Share game action directly in the result dialog. Native share sheets use
the existing Capacitor bridge; blocked browser sharing/clipboard access leaves
a selectable public link. Mobile player cards place the Go rank beside each
name and hide redundant role, color and ordinary turn instructions.

Puzzle mistakes retain the server's last correct variation and revision. Undo
removes the failed decision and its automatic refutation together, then unlocks
the board at the correct position. Solving after a mistake still records a
failed first attempt.

## Native review repair

The iOS C++ stdout buffer used to emit unterminated JSON when flushed. Since
stdin and stderr can flush their tied stdout stream while KataGo writes, the
Swift parser could discard those fragments and reach the safety timeout. Only
newlines now emit records; output writes are serialized. The portable native
regression compiles the actual production buffers, reproduces the old failure,
and checks 10,001 records with concurrent flushes. CI runs it with g++.

This fixes a reproduced transport defect. Full Metal inference, UIKit gestures,
safe areas and native sharing still require physical iPhone validation; Windows
cannot compile the iOS app with Xcode. Browser tests cover the shared mobile
bundle and website; Android Java compilation verifies plugin registration.

## Releasing

Merge updates the website/API. Installed beta binaries need a new release:
build the mobile bundle and sync Capacitor; rebuild the iOS KataGo framework
with `npm run mobile:katago:ios` before archiving so the C++ repair is included.
Use the existing Android/iOS release scripts in `docs/mobile-store-release.md`.
No database migration or new dependency is required.

## Theme and lesson follow-up

Fresh website and app sessions default to light, including on dark devices.
Explicit dark, light and system choices are stored separately for each client;
system mode is now stored rather than represented by a missing preference.
Website water artwork, hero transitions and chapter panels use a consistent
dark palette when dark mode is selected. Review cards use a complete border
and the shared palette tokens.

Teaching continuations advance with Show next move, one placement per tap.
The lesson cannot complete until every reply is visible. Life or death explains
the center move, Black's reply and White's capturing move in their respective
positions. Restart restores the original board even midway through the example.
