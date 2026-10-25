# Website and mobile audit — 2026-10-24

The audit combines source review, functional tests and screenshots. It does not
establish that every possible defect has been found.

## Corrected findings

| Finding | Correction | Regression coverage |
| --- | --- | --- |
| German privacy headings and links extend beyond a 320 px app screen. | Constrain the legal card's grid and wrap long titles and links. | All three legal destinations, light and dark, at 320 px. |
| Winding learning-path labels extend beyond narrow screens. | Reserve horizontal room for the path offsets and allow label wrapping. | Every learning node and label at 320 px; authenticated website sweep. |
| Dark training screens have unreadable text: the app keeps white panels, and website selections keep white text on pale green. | Apply the app palette to panels and controls, and dark foregrounds to selected website controls. | Setup screenshots and measured text contrast in app setup/gameplay and authenticated website training. |
| The app's All games link changes the URL but leaves the profile at the top. | Scroll to fragment destinations after their content mounts. | Navigate from Home to the history anchor and verify the browser's scroll position. |
| App screens remain declared English after changing locale. | Update the document language from the active route. | German, Japanese and French routes. |
| Unknown app destinations show only GoStone / 404. | Show translated explanation and a working Home link. | Open an unknown German route and return Home. |
| Failed app logout rejects without a visible, retryable error. | Catch failure, show a localized alert and guard pending submissions. | Fail logout, verify no unhandled rejection, then retry successfully. |
| Website 404 responses ignore the saved appearance. | Reuse the theme bootstrap and supply both palettes. | Verify HTTP 404, light/dark appearance, recovery link and narrow layout. |
| HTML, empty and malformed API replies bypass typed error recovery. | Validate the envelope while retaining HTTP status and Retry-After. | Gateway errors, unauthorized empty replies, null JSON, invalid success flags and proxy rate limiting. |
| Absolute API Request URLs can remain on the native asset host, and copying their body as a stream can lose payloads at a bridge. | Rewrite local API URLs for both native schemes, preserve buffered request bodies, and scope credential defaults and capability headers to GoStone APIs. | Native-scheme URL tests and built-app Request/body/header checks. |
| Standard URL origins are opaque for the iOS asset scheme, making origin-based navigation checks unreliable. | Compare actual scheme and host and resolve paths against the full app URL. | Local iOS URLs, other app hosts and external HTTPS destinations. |
| ESLint can traverse Playwright's changing generated output. | Ignore test-results and playwright-report. | Full lint run alongside the audit tools. |
| Locked runtime and build dependencies have published security advisories. | Update Next.js/ESLint config to 16.4.3, sharp to 0.35.5, Vite to 8.3.5, source-map-js to 1.2.2 and Zod to 4.6.7; scope Capacitor CLI's Xcode parser override to 4.0.0, which removes its vulnerable UUID dependency. | Full npm audit, application checks, native sync/build and Xcode project parse/serialization. |

The initial full `npm audit` reported eight affected dependency packages
(one critical, four high and three moderate); the production-only audit reported
three. The updates clear the registry's reported advisories without suppressions.
The production patches follow the published [Next.js image-optimization advisory](https://github.com/advisories/GHSA-2464-fhr4-w9xw),
[sharp/librsvg advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) and
[source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
This is dependency advisory remediation, not a claim that an exploit was
demonstrated against this deployment. CI now rejects high/critical audit findings.

## Screenshot coverage

The initial local sweep captured 270 views: 21 website routes and 24 app routes,
each at 320, 390 and 1440 px, in light and dark appearance. Destinations included
Home, Play, daily/practice puzzles, learning, training, review, leaderboard,
profile/settings, friends, account forms, legal pages, games, shared replay and
unknown routes; the app additionally included local play, Go clock and Coach.

Local captures are in `.cache/audit-shots/`. They use controlled API fixtures.
The local website server intentionally has no database: account-protected
website URLs therefore capture their registration gate, rather than claiming
to capture authenticated content. Some fixture-free dynamic routes capture
their loading/error state. Functional game, puzzle and review tests exercise
their populated states separately.

`tests/authenticated/layout-audit.spec.ts` complements this with actual isolated
PostgreSQL sessions for profile, settings, friends, learning, training and review.
It captures light/dark screenshots and checks layout and JavaScript errors.
These tests run in the existing PostgreSQL CI job. Focused corrected-layout
captures are written to `.cache/visual-audit/`; CI publishes that directory as
the `visual-audit-client` and `visual-audit-authenticated` artifacts for five days.

## Reproduction

```sh
npm run typecheck
npm run mobile:typecheck
npm run lint
npm test
npm run build
npm run mobile:build
npm audit
npm run test:browser
npx playwright test --config playwright.mobile-board-designs.config.ts
```

The existing PostgreSQL supervisor runs `playwright.review.config.ts`, including
the authenticated screenshot sweep, against its disposable local database.
Never point that mutating suite at production.

The initial complete browser run passed 242 tests with 88 intentional project
skips; the complete app run passed 195 with five intentional skips. New focused
regressions supplement those baselines. Final validation is recorded on the PR.

## Remaining verification boundaries

An additional Android API 36 smoke used the final debug APK in a disposable,
read-only emulator session. It covered cold launch, Home, Play, a live daily
puzzle, local stone placement and the native fullscreen Go clock. Its screenshots
and the boot/log caveats are recorded in `.cache/visual-audit/android-*.png` and
`android-emulator-smoke.md` beside them.

The app browser tests exercise the bundled client shared by Android and iOS,
with existing native bridge fixtures. They do not replace physical-device
tests. No physical Android device was connected for this audit, and Windows cannot run
Xcode or an iOS simulator. Native OAuth provider accounts, real share sheets,
device safe areas, engine thermals and store-distributed binaries still require
device verification. This change does not publish new App Store or Play builds.
