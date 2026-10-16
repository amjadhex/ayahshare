# apps/mobile — AyahShare for iOS and Android

The iOS and Android apps are the web app (`apps/web`) built and **bundled inside the app** with Capacitor 8. They are
not a wrapper around the website: there is no `server.url`; the pages, scripts and data files ship in the app, and only
the API is remote. Every feature of the web app is in the apps the moment the web build is synced.

| | |
|---|---|
| App id / package | `com.ayahshare.app` (iOS bundle id, Android `applicationId` and `namespace`) |
| Name | AyahShare |
| Web build | `www/` (`webDir` in `capacitor.config.ts`), built by `npm run build:web` — never `apps/web/dist` |
| API | `https://ayahshare.com` (build-time `VITE_APP_API_BASE`, see below) |
| Link scheme | `ayahshare://s/<code>`; `https://ayahshare.com/s/<code>` (Universal Links / App Links, prepared) |
| User agent | the WebView's, plus `AyahShareApp` |
| Saved files | Photos (iOS); `Pictures/AyahShare`, `Movies/AyahShare` (Android) |
| iOS | Xcode 27, iOS 15+, Swift Package Manager (no CocoaPods) |
| Android | Java 21, SDK 36 (min 24), Gradle wrapper in `android/` |

## How it fits together

- **One codebase.** All app code is in `apps/web/src`. What differs in the app goes through the platform adapter
  (`apps/web/src/platform.ts`); the app's implementation is `apps/web/src/platform-native.ts` and
  `apps/web/src/native/*`, which the web never downloads (loaded only when `Capacitor.isNativePlatform()`).
- **API host.** Paths the Worker answers (`/api`, `/qapi`, `/audio`, `/media`, `/s`, `/data/clips.json`,
  `/data/bg/*`) go to `https://ayahshare.com` (`apps/web/src/endpoint.ts`), or to the device's copy once the offline
  store has one (below); everything else loads from the app. The Worker answers the app origins
  (`capacitor://localhost` on iOS, `https://localhost` on Android) with CORS on `/api/*` (`apps/api/src/lib/http.ts`)
  and with `*` on `/qapi`, `/audio`, `/media` and `/data`.
- **Sign-in session.** The web uses an HTTP-only cookie. The app gets the session token from `/api/auth/google`,
  `/api/auth/apple` (iOS) or `/api/auth/email/verify` (the Worker returns it to the app origins), keeps it with `@capacitor/preferences` and sends
  it as `Authorization: Bearer …` (`platform.saveSession`).
- **Native features** (`platform-native.ts`):
  - Share → `@capacitor/filesystem` writes the exported file to the app's cache (in slices) → `@capacitor/share`.
  - Save → the app's own `SaveToGallery` plugin: Photos on iOS (add-only access, usage text in `Info.plist`), the
    Gallery on Android (`Pictures/AyahShare`, `Movies/AyahShare`; a storage permission only on Android 7–9).
    Code: `ios/App/App/SaveToGalleryPlugin.swift`, `android/app/src/main/java/com/ayahshare/app/SaveToGalleryPlugin.java`,
    registered in `AppViewController.swift` / `MainActivity.java`.
  - `@capacitor/haptics`, `@capacitor/clipboard` (copy link fallback).
  - `@capacitor/status-bar`: light text on the dark app bar; `SystemBars` (core) keeps Android edge to edge.
  - `@capacitor/splash-screen`: shown until the first screen is ready (4 s at most).
  - `@capacitor/app`: Android back button (closes the open sheet or dialog, then goes back a screen, then leaves the
    app); links that start or reach the running app open their design in Create.
  - Google sign-in: `@capgo/capacitor-social-login`. **Off** until the client ids exist — see below.
  - Sign in with Apple (**iOS only**, App Store guideline 4.8): the same plugin's Apple provider (AuthenticationServices,
    the system sheet; full name and email). The first button on the login page. The app sends the identity token, and
    the name Apple gives on the first sign-in, to `POST /api/auth/apple`. Needs the `com.apple.developer.applesignin`
    entitlement (`ios/App/App/App.entitlements`) and the capability on the App ID (automatic signing adds it). In the
    simulator it works only with an Apple Account signed in there. Not on the web or Android.
    Apple gives the name and email the person chooses to share (the email may be a Hide My Email relay address).
    **Token revocation** (guideline 5.1.1(v), from build 2): the app sets the provider up with
    `useProperTokenExchange: true` and also sends Apple's one-time `authorizationCode`. The Worker exchanges it at
    `https://appleid.apple.com/auth/token` (client secret: an ES256 JWT signed with the Sign in with Apple key, Worker
    secret `APPLE_SIGNIN_KEY`, with the vars `APPLE_KEY_ID` / `APPLE_TEAM_ID`), keeps the refresh token encrypted in
    `users.apple_refresh` (migration 0010; AES-GCM, key derived from `AUTH_CODE_SECRET`), and `DELETE /api/me` revokes it
    at `https://appleid.apple.com/auth/revoke` before deleting the account. A failed exchange or revocation is logged and
    never blocks sign-in or deletion. Build 1 sends no code: those accounts get a token at their next sign-in.
    Email sign-in (a 6-digit code) needs nothing native: it is the web's own form and returns the same token.
  - Play a whole surah (`nowPlaying` in `platform-native.ts`): `@capgo/capacitor-media-session` sets the lock screen /
    notification card and its previous ayah / play / pause / next ayah buttons. iOS: `UIBackgroundModes` = `audio` in
    `Info.plist` (plus the playback audio session category in `AppDelegate.swift`) keeps the WebView's audio playing with
    the phone locked. Android: the plugin runs a foreground service of type `mediaPlayback` while the recitation is
    playing or paused (permission `FOREGROUND_SERVICE_MEDIA_PLAYBACK` in `AndroidManifest.xml`), which keeps the
    WebView's audio going with the screen off; the media notification needs the notification permission the
    local-notifications plugin already declares.
- **Export** runs in the WebView with the same engine as the web (Mediabunny in a Web Worker, WebCodecs H.264; the
  bundled AAC encoder where the WebView has none; real-time recording as the fallback).
- **Not in the app:** the service worker (`build:web` deletes `sw.js`; `pwa.ts` never registers it in the app and
  never offers the install strip there) and the admin app (it builds into `apps/web/dist/admin`, not into `www/`).

## Offline store (`apps/web/src/native/offline*.ts`)

The app keeps what it downloads from the Worker on the device, so it reopens fast and works with a weak or no
connection. Only the app has it; on the web nothing changes.

| Group | Paths | How |
|---|---|---|
| media | `/media/*` (clips, posters, thumbnails, `/media/voice/*`), `/audio/*` (recitations, translation voices) | Read from disk once downloaded; 300 MB, least recently used removed first |
| text | `/qapi/*`, `/media/translations/*` | Read from disk once downloaded; own 100 MB cap, so media never pushes the Quran text out |
| fresh | `/data/clips.json`, `/data/bg/*`, `/api/config`, `/api/trending`, `/api/tafsir/*`, `/api/reflections/*`, `/api/clips/<id>`, `/api/shares/<code>` | The copy on disk answers at once and is refreshed in the background; from the network when there is no copy |
| user | `/api/me`, `/api/creations`, `/api/favourites` | Network first; the copy when the network fails or takes over 5 s; removed whenever the session changes |
| never | writes, `/api/search`, `/api/stats/*`, `/api/auth/*`, `/s/*`, `/media/creations/*`, `/media/legal/*` | Network only |

- **Where it hooks in.** `endpoint.ts` `apiUrl()` resolves every Worker path (`api.ts` `mediaUrl()` goes through it).
  In the app it returns the local file (`Capacitor.convertFileSrc`, e.g.
  `capacitor://localhost/_capacitor_file_/…/Caches/offline/<hash>.mp4`) for a media or text path on disk, so
  `<video>`, `<audio>`, `<img>` and `fetch()` read the device. A path not on disk goes to the network and is queued
  for download (2 at a time, after 1.5 s), so whatever the Feed shows or preloads lands on disk. `window.fetch` is
  wrapped for GET requests to the Worker: a media file the page fetches (the Feed's preloading, the editor, Auto
  contrast, export) is downloaded once, natively (`Filesystem.downloadFile`, straight to disk), and then read from
  disk — one download, not two. Range requests and everything that is not a GET pass straight through.
- **Files.** `Directory.Cache/offline/<hash>.<ext>` (the extension sets the content type the local server sends) and
  `offline/index.json` (path → file, size, group, last use), written 2 s after a change and when the app goes to the
  background. At start the index is checked against the folder: entries whose file the system removed are dropped,
  half-finished downloads (`*.part`) and unnamed files are deleted.
- **Seeking.** iOS: Capacitor's scheme handler answers Range requests for local files. Android: Capacitor's local
  server answers a Range request from byte 0, so `OfflineFilesWebViewClient.java` answers Range requests for
  `cache/offline/*` with the bytes asked for (206 + Content-Range).
- **Saved designs and history** on the device are in IndexedDB (`history.ts`) and work offline as before; the account's
  saved designs (`/api/creations`) show their last copy offline.
- `Filesystem.downloadFile` is marked deprecated in favour of `@capacitor/file-transfer`; it works in 8.x. Switch when
  it is removed (add the plugin with the same version in `apps/web` and here).

## Email sign-in bot check (Turnstile) in the app

The email step's Cloudflare Turnstile widget works in the app's WebView: tested on iOS (page origin
`capacitor://localhost`) with Cloudflare's always-pass test sitekey. `challenges.cloudflare.com/turnstile/v0/api.js`
loads, the widget renders and the callback returns a token. No CSP or navigation rule is in the way: the app has no CSP
`<meta>` and Capacitor lets iframes load. The Worker already checks app tokens against the hostname `localhost`
(`apps/api/src/lib/turnstile.ts`). So for the **real** sitekey, add `localhost` to the widget's hostnames
(Cloudflare dashboard → Turnstile → widget → Hostname management), or app sign-ins will fail the check. If Cloudflare
will not accept `localhost` for a production widget, the fallback is: skip Turnstile for requests from the app origins,
and use stricter per-IP and per-email rate limits on `/api/auth/email/start` instead. Switching iOS to
`server.iosScheme: "https"` would not help, because the hostname would still be `localhost`.

## Status and known issues

- **iOS simulator, video export:** the export stalls on the simulator. WebCodecs' H.264 `VideoEncoder` stops after
  about 7 frames with every setting (default, `latencyMode: "realtime"`, `prefer-software`), even with nothing but
  coloured frames. Decoding the clip is fine (90 frames in under 1 s). This looks like a limit of the simulator, but it
  has not been checked on a real iPhone yet. The export has no stall watchdog: it waits forever at a few percent instead
  of falling back to real-time recording (`apps/web/src/export/index.ts`, `runWorker`). Image export and sharing work.
- **Android:** tested on the `AyahShare_API34` emulator with the debug APK. Start, language, the Feed with
  playback, and the offline cache in `cache/offline` all work. In airplane mode the Feed still opened from the device's
  copies.
- **Offline:** tested on the iOS simulator with the API base pointed at an unreachable host. A Feed reel seen before
  still played: its clip and recitation came from `Caches/offline/`, and `/data/clips.json`, `/api/config` and
  `/api/trending` came from their copies. A reel that was never downloaded shows an endless spinner. The Feed could
  skip such reels when the device is offline (not done). Unit tests cover the size caps and eviction
  (`apps/web/src/native/offline*.test.ts`).

## Prerequisites (this Mac)

- Node 24, `npm install` in `apps/web` and in `apps/mobile`.
- iOS: Xcode 27 with an iOS simulator.
- Android: `brew install openjdk@21` and `brew install --cask android-commandlinetools`; the SDK lives in
  `/opt/homebrew/share/android-commandlinetools` (platform 36, build-tools 36, platform-tools, emulator, a
  `system-images;android-34;google_apis;arm64-v8a` image). Before Gradle:

  ```sh
  export JAVA_HOME=/opt/homebrew/opt/openjdk@21
  export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
  ```

## Build and run — how web changes reach the apps

Every change in `apps/web` reaches the apps the same way: **build the web app into `www/`, then sync**.

```sh
cd apps/mobile
npm run sync            # checks plugin versions, type-checks and builds apps/web into www/, copies it into both apps, updates native plugins
npm run sync:ios        # or one platform
npm run sync:android
npm run build:web -- --no-check   # only the web build (skips tsc)
```

`build:web` (`scripts/build-web.mjs`) runs `tsc --noEmit` and `vite build --outDir ../mobile/www --emptyOutDir` in
`apps/web` with `VITE_APP_API_BASE` (default `https://ayahshare.com`), then removes `sw.js`. It never writes to
`apps/web/dist` (the website's build). `www/`, `ios/App/App/public` and `android/app/src/main/assets/public` are build
output (ignored).

`npm run check` fails when a Capacitor plugin version in `apps/web/package.json` differs from `apps/mobile/package.json`
(the JavaScript side is bundled from `apps/web`, the native side is installed here; they must match). Install plugins
with the same exact version in both folders.

### iOS (simulator)

```sh
npm run open:ios        # Xcode: pick a simulator, Run
# or headless:
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' -derivedDataPath build/ios build
xcrun simctl install booted build/ios/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch --console-pty booted com.ayahshare.app     # prints console lines
xcrun simctl openurl booted ayahshare://s/<code>                # open a share link in the app
```

The web view can be inspected from Safari → Develop → Simulator (debug builds).

### Android (emulator or phone)

```sh
cd android && ./gradlew assembleDebug           # → app/build/outputs/apk/debug/app-debug.apk
$ANDROID_HOME/emulator/emulator -avd AyahShare_API34 &
$ANDROID_HOME/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk
$ANDROID_HOME/platform-tools/adb shell am start -n com.ayahshare.app/.MainActivity
$ANDROID_HOME/platform-tools/adb shell am start -a android.intent.action.VIEW -d "ayahshare://s/<code>"
```

Create the emulator once with
`avdmanager create avd -n AyahShare_API34 -k "system-images;android-34;google_apis;arm64-v8a" -d pixel_7`.
The web view can be inspected from Chrome → `chrome://inspect` (debug builds).

### Icons and launch screen

`npm run assets` runs `scripts/make-artwork.mjs` (draws `assets/*.png` from `brand/icon` and `brand/splash`) and
`capacitor-assets generate` (every iOS and Android size, adaptive Android icon, splash). Run it again when the final
AyahShare logo is in `brand/`.

## Build-time settings

Set in the environment of `npm run sync` / `npm run build:web` (or `apps/web/.env`); they only affect the apps:

| Variable | Default | Purpose |
|---|---|---|
| `VITE_APP_API_BASE` | `https://ayahshare.com` | The API the apps call (e.g. the workers.dev address for testing). |
| `VITE_GOOGLE_IOS_CLIENT_ID` | empty | Google OAuth client id of type iOS. Empty → Google sign-in hidden on iOS. |
| `VITE_GOOGLE_ANDROID_CLIENT_ID` | empty | Google OAuth client id of type Android. Empty → Google sign-in hidden on Android. |

## Google sign-in (off until the owner creates the client ids)

Both apps sign in for the **web client id** the Worker already checks (`GOOGLE_CLIENT_ID`, served by `/api/config`),
so the Worker accepts their ID tokens without changes. To switch it on:

1. Google Cloud Console → the project of the web client → Credentials:
   - **iOS** client: bundle id `com.ayahshare.app`. Put its id in `VITE_GOOGLE_IOS_CLIENT_ID` and add its *reversed*
     client id (`com.googleusercontent.apps.…`) as a second URL scheme in `ios/App/App/Info.plist`
     (`CFBundleURLTypes`), next to `ayahshare`. Without that scheme the sign-in sheet cannot return to the app.
   - **Android** client: package `com.ayahshare.app` and the SHA-1 of each signing certificate (debug keystore for
     testing: `keytool -list -v -keystore ~/.android/debug.keystore -storepass android`; Play app signing and upload
     key for release). Put its id in `VITE_GOOGLE_ANDROID_CLIENT_ID`.
2. `npm run sync`, rebuild the apps.

## Share links into the app

- **Now:** `ayahshare://s/<code>` opens the app on both platforms (iOS `CFBundleURLTypes`, Android intent filter).
- **Universal Links (iOS):** `ios/App/App/App.entitlements` lists `applinks:ayahshare.com` (only the apex: www
  301-redirects to it and Universal Links do not follow redirects). The Worker serves
  `/.well-known/apple-app-site-association` (`apps/api/src/routes/wellknown.ts`, `APP_ID` must be
  `com.ayahshare.app`). `APPLE_TEAM_ID` is set (`F9FZQJ3FT6`) in `apps/api/wrangler.jsonc`, so it serves
  `F9FZQJ3FT6.com.ayahshare.app`; *Associated Domains* must be enabled for the app id in the Apple Developer account.
- **App Links (Android):** the manifest has an `autoVerify` intent filter for `https://ayahshare.com/s/…`; the Worker
  serves `/.well-known/assetlinks.json`. Set `ANDROID_CERT_SHA256` (Play Console → App integrity → app signing
  certificate SHA-256, plus the upload key's if wanted, comma-separated).

## Signing and publishing (later)

Needs an Apple Developer account ($99/year) and a Google Play developer account ($25 once) — owner actions.

- **iOS:** in Xcode select the team (Signing & Capabilities), enable Associated Domains, set the version
  (`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`), Product → Archive → distribute to App Store Connect / TestFlight.
  The photo-library text is in `Info.plist` (`NSPhotoLibraryAddUsageDescription`).
  Current: version 1.0.1, build 3 (13 Oct 2026: the reels redesign, Today's ayah with its daily reminder, the surah
  player, the new Reflect sheet). This Mac's Xcode has no Apple account signed in, so `xcodebuild -exportArchive` fails
  ("No Accounts"): upload from Xcode → Organizer (Distribute App → App Store Connect).
- **Daily reminder (local notifications):** Android shows `res/drawable-*/ic_stat_ayahshare.png` (the white mark, made
  from `apps/web/public/brand/mark-white.svg`; `capacitor.config.ts` LocalNotifications). The reminder is an inexact
  alarm (`isExactNotification: false` in `platform-native.ts`; `SCHEDULE_EXACT_ALARM` removed in `AndroidManifest.xml`):
  no "Alarms & reminders" settings screen and no Play declaration, but Android may show it up to an hour after its time.
- **Android:** create an upload keystore (`keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA
  -keysize 2048 -validity 10000`, kept outside the repo), add a `signingConfigs.release` to `android/app/build.gradle`
  reading it from `~/.gradle/gradle.properties`, raise `versionCode` / `versionName` (now 2 / 1.0.1), then `./gradlew bundleRelease` →
  upload `app-release.aab` to Play Console with Play app signing.
- **Background audio declarations (store review):** the iOS app declares background audio (`UIBackgroundModes: audio`);
  App Review: used for continuous Quran recitation (a whole surah) while the phone is locked. The Android app declares a
  `mediaPlayback` foreground service; Play Console → App content → Foreground service permissions needs the declaration
  "Media playback" (with a short video or description of the recitation playing with the screen off).
- Store listings need screenshots, a privacy policy URL (`https://ayahshare.com/privacy`) and the data-safety form
  (the app sends anonymous usage events; sign-in stores name and email).
