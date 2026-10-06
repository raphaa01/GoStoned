# Mobile store release

## Approved branding

The iOS AppIcon catalog contains the approved Sculpted light and dark 1024px
app icons. The light icon is the default, and the dark icon uses iOS's dark
luminosity appearance. Header logos use the matching transparent masters at
`public/branding/`. These assets were copied unchanged from the approved
`app/icons/` artwork in the separate icon-assets branch; that branch's source
masters remain authoritative. The App Store listing icon comes from the
uploaded binary, not a separate listing upload.

The iOS launch images use the same approved logo. Regenerate just those images
with `npm run mobile:splash -- --ios`; without `--ios` the existing generator
also refreshes Android launch images.

## Source and native build

This release branch starts from `origin/main` commit
`0d68485db95bb22f69700146055e3b58a732790e`. The iOS KataGo changes
were reviewed from draft PR #156, commit
`6bba985f1dfc930e49a26e147dab5e0500e7d859`, and ported onto that
main commit. The current website, mobile UI, puzzles, learning, sharing, and
design changes remain based on main.

The Android application identifier and iOS bundle identifier are both
`app.gostone`, matching Capacitor's top-level `appId`. Android's Java namespace
and the shared native OAuth callback remain `com.gostone.app`; they do not
need to match the store identifiers. Google Play has registered `app.gostone`;
register the same explicit App ID with the Apple team and select it for the
App Store Connect record. The existing `app.gostone.primary` App ID and
`app.gostone.web` Services ID are separate Apple sign-in identifiers.
The release API is
`https://gostone.app`. Capacitor's `localhost` is an internal asset hostname,
not a development API origin. Mobile native analysis has no server KataGo
fallback. The v1.18.2 KataGo commit is
`fd0723fdbc0e9d82cf269c9630af8c27c57c07c4`; the model SHA-256 is
`0ba27eced5180b3e3d0b898b280c541112989765e789d1eb6cd0d31b2b2c1229`.

On macOS, use Xcode 26 or newer, JDK 21, Android API/Build Tools 36, NDK
27.2.12479018, CMake 3.27 or newer plus Ninja for iOS, and Android SDK CMake
3.22.1 for the Android script. Open `ios/App/App.xcodeproj` in Xcode. The
top-level `.xcworkspace` path mentioned in older instructions does not exist.

```sh
npm ci
npm run mobile:doctor
npm run typecheck
npm run mobile:typecheck
npm run lint
npm test
npm run build
npm run mobile:build
npm run mobile:katago:android
npm run mobile:katago:ios
npm run mobile:sync
npm run mobile:android:build
```

The iOS script finds CMake and Ninja through `CMAKE` and `NINJA` environment
variables, the ignored `.mobile-cache/ios-build-tools/bin/`, or standard
Homebrew paths. It builds arm64 iPhone and Apple-silicon Simulator slices and
generates the ignored `GoStoneKataGoCore.xcframework`. Simulator inference is
deliberately unavailable because the Xcode 26.6 MPSGraph simulator driver can
abort during graph execution; device inference stays linked in Release.

## App icon artwork

Approved light and dark Sculpted app icons and transparent logo masters are
tracked in [`app/icons/`](../app/icons/README.md). The app icon PNGs are
1024 × 1024, opaque, and square; the transparent logo PNGs are 2048 × 2048.
Use the SVG masters to generate other required sizes and include a dark
version in artwork previews. Generated store uploads and screenshots remain
under `artifacts/release/<version>-<build>/store-assets/`.

## Store signing

Confirm that `app.gostone` belongs to the Apple team and matches the Play app,
and the chosen build numbers have not already been used. Do not create a new
Android key if an existing Play upload key is already registered. Supply the
existing Android key through local environment variables, never committed
Gradle properties:

```sh
GOSTONE_ANDROID_KEYSTORE_FILE=/secure/path/to/gostone-upload.jks
GOSTONE_ANDROID_KEYSTORE_PASSWORD=<local-secret>
GOSTONE_ANDROID_KEY_ALIAS=<existing-alias>
GOSTONE_ANDROID_KEY_PASSWORD=<local-secret>
export GOSTONE_ANDROID_KEYSTORE_FILE GOSTONE_ANDROID_KEYSTORE_PASSWORD
export GOSTONE_ANDROID_KEY_ALIAS GOSTONE_ANDROID_KEY_PASSWORD
npm run mobile:android:release
```

The script compiles the arm64 KataGo runtime, synchronizes the production
bundle, builds `bundleRelease`, verifies its signature, arm64 payload and
model hash, and places the `.aab` plus unstripped native symbol ZIP under
`artifacts/release/<version>-<build>/android/`.

For iOS, install an Apple Distribution identity with its private key and an
App Store provisioning profile for `app.gostone` from the real team. Use the
profile's UUID, not its display name. Release builds use manual signing for
both archive and export; Xcode's automatic development signing conflicts with
an explicit Apple Distribution identity. These commands do not create or
revoke certificates or upload a build:

```sh
export GOSTONE_APPLE_TEAM_ID=<actual-10-character-team-id>
export GOSTONE_IOS_PROFILE_UUID=<installed-app-store-profile-uuid>
npm run mobile:ios:release
```

This builds the pinned XCFramework, synchronizes the production bundle,
archives for `generic/platform=iOS`, verifies codesign, provisioning team,
device architecture, model hash and dSYMs, then exports using Xcode 26's
`app-store-connect` method. The signed archive and IPA are collected under
`artifacts/release/<version>-<build>/ios/`. Neither binaries nor signing
material belong in Git.

## Native sign-in and remaining validation

Google and Apple sign-in opens in the system browser. Their existing HTTPS
callbacks issue a three-minute, one-use code bound to a verifier stored in the
app. The custom URL callback `com.gostone.app://oauth` returns that code to the
app, which exchanges it for the existing HttpOnly session or registration
cookie. This requires migration `043_mobile_oauth_handoffs.sql` on production.
The website continues to use its original callback and navigation. The
browser-to-app flow still needs a live Google and Apple provider test on real
devices; compiling the app does not verify provider configuration or cookie
handling. Static game share URLs remain on `gostone.app`; native universal
links are not enabled without a verified association file and the final
signing identity.
Real-phone battery, thermal, background, and full-game tests plus TestFlight
and Play internal testing have not been performed by the build process.

Production database verification needs a securely provided `DATABASE_URL`:

```sh
npm run check:production-schema
```

The check now verifies the schema and every numbered migration in the current
repository, including `041_gokyo_shumyo_puzzles.sql`,
`042_board_placement_preference.sql`, and `043_mobile_oauth_handoffs.sql`.
If migrations are missing, the authorized
operator must use `npm run db:migrate` with the same safe connection, then rerun
the check. No production migration runs during artifact builds.
