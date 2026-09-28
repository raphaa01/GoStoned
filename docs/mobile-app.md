# GoStone mobile app

The mobile target is a bundled Vite/React client that reuses GoStone's existing
components, rulebook, polling, matchmaking and browser-bot code. Capacitor wraps
the bundle for iOS and Android. The Next.js application remains the authoritative
Vercel API and the only process with PostgreSQL access.

## Repository separation

| Target | Source boundary | Responsibility |
| --- | --- | --- |
| Website/API | `app/`, `components/`, `lib/` | Existing Next.js site, Vercel API, matchmaking and persistence |
| Shared mobile client | `mobile/` | Bundled React entry point and native-safe navigation |
| Android shell | `android/` | Gradle application, Android resources and device tests |
| Android KataGo | `native/gostone-katago/android/` | Local CPU engine bridge and lifecycle/thermal controls |
| iOS shell | `ios/` | Xcode/SPM application project |
| iOS KataGo | `native/gostone-katago/ios/` | Separate Swift bridge and future XCFramework boundary |

The website is not replaced or packaged as a remote WebView. Shared game UI and
rules are reused, while platform-native code stays in the Android and iOS
boundaries above.

## Mobile experience

The bundled client has its own app shell. It deliberately does not render the
website navbar, landing-page hero, or footer.

- The fixed tab bar contains Start, Puzzles, Learn, Review, and Leaderboard.
- The Start screen keeps the Play action above the tab bar and obtains profile,
  active-match, rating, recent-game, and friend data from the existing APIs.
- Play, puzzles, lessons, reviews, profiles, friends, authentication, and legal
  screens reuse the existing product components and backend contracts with
  mobile-specific layouts.
- Theme preference is System, Light, or Dark. Both palettes are purpose-built;
  the iOS shell alone uses a progressive blurred/translucent dock treatment,
  while Android surfaces remain opaque.
- CSS safe-area insets, compact-phone rules, tablet split layouts, minimum touch
  heights, and reduced-motion preferences are part of the shared mobile layer.
- Android and iOS use generated light/dark native launch assets, followed by a
  short in-app Go-stone crossfade. Regenerate them with `npm run mobile:splash`.

## Runtime boundaries

- Matchmaking, games, clocks, chat, ratings and final Japanese scoring stay on
  the server. The bundled client rewrites only `/api/*` requests to the origin in
  `VITE_GOSTONE_API_URL`.
- Capacitor's native HTTP and cookie bridges preserve the existing HttpOnly
  session model. Production native builds reject a non-HTTPS API origin.
- Normal bot moves continue to use `GOSTONE_BOT_MODEL` and
  `workers/browser/gostoneBot.worker.ts`. The v8 model is copied into every mobile
  bundle and verified by SHA-256.
- KataGo review is a separate native boundary described by
  `lib/mobile/katagoContract.ts`. The pinned network is downloaded at build time,
  verified, and bundled; the released app must never download it while analyzing.

## Local web-bundle development

Native builds default to the canonical `https://gostone.app` API. Copy
`.env.mobile.example` to `.env.mobile.local` or set `VITE_GOSTONE_API_URL` only
when intentionally building against another HTTPS origin. For local browser
development, run the Next.js API on port 3000; the Vite server proxies `/api`
to it. Then run:

```powershell
npm run mobile:dev
```

The bundled client is served on `http://127.0.0.1:4173`. `npm run mobile:build`
creates the release web bundle, including the v8 and KataGo model assets.

## Native projects

```powershell
npm run mobile:add:android
npm run mobile:add:ios
```

The iOS command generates a Swift Package Manager project. Building or running
that project requires macOS, Xcode 26 or newer, and an Apple signing team; these
Apple tools cannot be installed on Windows. After generation, use
`npm run mobile:sync` whenever web assets or Capacitor plugins change.

On Windows, the installed development baseline is OpenJDK 21, CMake, Android
Studio, Android Platform/Build Tools 36 and ADB. A reproducible debug APK can be
built with:

```powershell
npm run mobile:android:build
```

The script discovers the standard Windows, macOS and Linux SDK/JDK locations,
checks out pinned KataGo and Eigen sources into `.mobile-cache`, cross-compiles
separate `arm64-v8a` and `x86_64` CPU runtimes, synchronizes verified assets,
and runs Gradle `assembleDebug`. The first build downloads and compiles the
pinned native sources; later builds are incremental.

Before an iOS release, add the production API hostname and `localhost` to
`WKAppBoundDomains` in the app's `Info.plist`, then enable
`limitsNavigationsToAppBoundDomains` after OAuth/deep-link testing.

## KataGo native status

KataGo v1.18.2 and `b10c384h6nbttflrs` are the pinned mobile identities.

- **Android:** enabled locally with the Eigen CPU backend. It exposes start,
  progress and cancel and runs one analysis at a time. A one-visit preview makes
  the first ten contiguous moves usable immediately; after 28 seconds the UI
  opens whatever contiguous preview is ready. A second pass then replaces those
  positions using the adaptive 900-visit quality budget. The 90-second safety
  boundary returns and persists usable work instead of replacing it with a
  generic failure. It stops at severe thermal pressure and never calls the
  server analysis route. The device test verifies actual multi-position model
  inference on Android API 36.
- **iOS:** source contract, model verification, project wiring and an explicit
  fail-closed bridge are ready. The Metal/CoreML core must still be compiled on
  macOS and tested on real iPhones. Upstream commit
  `fd0723fdbc0e9d82cf269c9630af8c27c57c07c4` does not provide an iOS
  library/XCFramework target, so Windows cannot honestly complete that link.
- **Website:** continues to use the existing server worker. Mobile native paths
  never silently fall back to Modal or the KataGo server.

See `native/gostone-katago/README.md` for the platform-specific release gates.

## Exact release work still required

### iOS — perform on a Mac

1. Install Xcode 26 or newer, accept its license, install the iOS Simulator
   runtime, and select the project’s Apple Developer signing team.
2. Clone the repository, run `npm ci`, `npm run mobile:build`, and
   `npm run mobile:sync`; open `ios/App/App.xcworkspace` in Xcode.
3. Build KataGo v1.18.2 at the pinned commit as an arm64 device plus simulator
   XCFramework using Metal (CoreML may be evaluated only if it produces the same
   contract). Link it to `GoStoneKataGoPlugin`, replace the fail-closed status,
   and keep the pinned model hash check, cancellation, thermal handling,
   progressive preview/quality events, adaptive 900-visit budget, and
   90-second result-preserving safety boundary.
4. Run contract tests in Simulator, then test model loading, a complete review,
   cancellation, background/foreground, memory pressure, and thermal handling
   on at least one real older iPhone and one current iPhone. Confirm that no
   request reaches the server analysis endpoint.
5. Configure the final bundle identifier, Associated Domains / OAuth callback
   URLs, `WKAppBoundDomains`, privacy strings, app icons, Apple sign-in (when
   the production login providers require it), and production API origin.
6. Test all five tabs, auth, matchmaking and reconnect, a bot game, sharing,
   Dynamic Type, VoiceOver, light/dark mode, iPhone SE-sized layout, a modern
   iPhone, and iPad split layouts. Archive a Release build, validate it, upload
   to TestFlight, complete App Privacy/export declarations, and submit.

Windows can prepare the Xcode sources and assets, but cannot compile/link Metal,
codesign an iOS app, run the iOS Simulator, or produce an App Store archive.

### Android — finish the release build

1. Open `android/` in Android Studio, set the final application ID/version,
   production icons and store metadata, then configure a release keystore via
   local/CI secrets (never commit it). Enable Google Play App Signing.
2. Run `npm ci`, `npm run mobile:build`, `npm run mobile:sync`,
   `npm run mobile:android:build`, `npm run typecheck`, and `npm test`.
3. Test the local 38 MB KataGo model, first-preview latency, and progressive
   quality pass on real arm64 devices:
   one low/mid-range device and one current flagship. Verify cancellation,
   backgrounding, offline analysis, heat, memory, and that completed analyses
   reopen from local storage without a network call.
4. Verify production OAuth/deep links, cookies, API hostname, notification and
   privacy behavior; exercise all tabs, matchmaking/reconnect, the 10-second bot
   fallback, static share links, TalkBack, font scaling, phones, and a tablet.
5. Build a signed Release AAB, run Play pre-launch/internal testing, inspect
   crashes and ANRs, complete Data safety/content rating/store listing, then
   promote only the tested artifact to production.
