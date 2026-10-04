# Mobile store release

## Source and native build

This release branch starts from `origin/main` commit
`0d68485db95bb22f69700146055e3b58a732790e`. The iOS KataGo changes
were reviewed from draft PR #156, commit
`6bba985f1dfc930e49a26e147dab5e0500e7d859`, and ported onto that
main commit. The current website, mobile UI, puzzles, learning, sharing, and
design changes remain based on main.

Google Play has registered the Android application identifier `app.gostone`.
The iOS bundle identifier remains `com.gostone.app`. Android's Java namespace
and the shared native OAuth callback remain `com.gostone.app`; they do not
need to match the Android application identifier. The existing native
projects configure these identifiers independently. Capacitor's top-level
`appId` remains the iOS identifier; do not regenerate the Android project
with that default. The release API is
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

## Store signing

Confirm that `com.gostone.app` belongs to the Apple team, `app.gostone` matches
the Play app, and the chosen build numbers have not already been used. Do not create a new
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

For iOS, install or allow Xcode to create the Apple Distribution signing
identity and App Store provisioning profile for the real team, then:

```sh
export GOSTONE_APPLE_TEAM_ID=<actual-10-character-team-id>
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
