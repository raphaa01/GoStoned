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

Copy `.env.mobile.example` to `.env.mobile.local` or set
`VITE_GOSTONE_API_URL`. Run the Next.js API on port 3000, then:

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
  progress and cancel, runs one analysis at a time, defaults to 20 and caps at
  80 visits per position, stops at severe thermal pressure, persists completed
  results locally, and never calls the server analysis route. The device test
  verifies an actual model inference on Android API 36.
- **iOS:** source contract, model verification, project wiring and an explicit
  fail-closed bridge are ready. The Metal/CoreML core must still be compiled on
  macOS and tested on real iPhones. Upstream commit
  `fd0723fdbc0e9d82cf269c9630af8c27c57c07c4` does not provide an iOS
  library/XCFramework target, so Windows cannot honestly complete that link.
- **Website:** continues to use the existing server worker. Mobile native paths
  never silently fall back to Modal or the KataGo server.

See `native/gostone-katago/README.md` for the platform-specific release gates.
