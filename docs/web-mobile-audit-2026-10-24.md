# Website and mobile audit — 2026-10-24

The audit combines source review, functional tests and screenshots. It does not
establish that every possible defect has been found.

## Corrected findings

| Finding | Correction | Regression coverage |
| --- | --- | --- |
| German privacy headings and links extend beyond a 320 px app screen. | Constrain the legal card's grid and wrap long titles and links. | All three legal destinations, light and dark, at 320 px. |
| Winding learning-path labels extend beyond narrow screens. | Reserve horizontal room for the path offsets and allow label wrapping. | Every learning node and label at 320 px; authenticated website sweep. |
| The app's All games link changes the URL but leaves the profile at the top. | Scroll to fragment destinations after their content mounts. | Navigate from Home to the history anchor and verify the browser's scroll position. |
| App screens remain declared English after changing locale. | Update the document language from the active route. | German, Japanese and French routes. |
| Unknown app destinations show only GoStone / 404. | Show translated explanation and a working Home link. | Open an unknown German route and return Home. |
| Failed app logout rejects without a visible, retryable error. | Catch failure, show a localized alert and guard pending submissions. | Fail logout, verify no unhandled rejection, then retry successfully. |
| Website 404 responses ignore the saved appearance. | Reuse the theme bootstrap and supply both palettes. | Verify HTTP 404, light/dark appearance, recovery link and narrow layout. |
| HTML, empty and malformed API replies bypass typed error recovery. | Validate the envelope while retaining HTTP status and Retry-After. | Gateway errors, unauthorized empty replies, null JSON, invalid success flags and proxy rate limiting. |
| Absolute API Request URLs can remain on the native asset host. | Rewrite local API URLs for both native schemes; scope credential defaults and capability headers to GoStone APIs. | Native-scheme URL tests and built-app Request/body/header checks. |
| ESLint can traverse Playwright's changing generated output. | Ignore test-results and playwright-report. | Full lint run alongside the audit tools. |

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

The app browser tests exercise the bundled client shared by Android and iOS,
with existing native bridge fixtures. They do not replace physical-device
tests. No Android device was connected for this audit, and Windows cannot run
Xcode or an iOS simulator. Native OAuth provider accounts, real share sheets,
device safe areas, engine thermals and store-distributed binaries still require
device verification. This change does not publish new App Store or Play builds.
