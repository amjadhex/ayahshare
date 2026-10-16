// AyahShare for iOS and Android: the web app (apps/web) built into www/ and bundled into the app — not a wrapper around
// the website. API calls go to https://ayahshare.com (apps/web/src/platform-native.ts). See README.md.
import type { CapacitorConfig } from "@capacitor/cli";

const DARK = "#111316";

const config: CapacitorConfig = {
  appId: "com.ayahshare.app",
  appName: "AyahShare",
  webDir: "www", // npm run build:web (scripts/build-web.mjs); never apps/web/dist
  backgroundColor: DARK,
  // Lets the API tell the app's requests apart in analytics (device/browser come from the user agent).
  appendUserAgent: "AyahShareApp",
  ios: {
    // The page draws under the status bar and home indicator and pads itself with env(safe-area-inset-*).
    contentInset: "never",
    backgroundColor: DARK,
  },
  android: {
    backgroundColor: DARK,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false, // hidden by the app once the first screen is ready (platform.ready())
      backgroundColor: DARK,
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
    },
    StatusBar: { style: "DARK", backgroundColor: DARK },
    // Android: the page goes edge to edge (viewport-fit=cover) and gets real env(safe-area-inset-*) values on current
    // WebViews; older WebViews are padded natively instead.
    SystemBars: { insetsHandling: "native", style: "DARK" },
    // Google sign-in (hidden until client ids are built in, README → Google sign-in) and Sign in with Apple (iOS only:
    // AuthenticationServices, nothing extra bundled; the button shows only on iOS, platform-native.ts).
    // The daily reminder (Today's ayah): Android's status-bar icon is the white mark (res/drawable-*/ic_stat_ayahshare.png,
    // made from brand/mark-white.svg), tinted emerald in the shade.
    LocalNotifications: { smallIcon: "ic_stat_ayahshare", iconColor: "#0f5c4d" },
    SocialLogin: { providers: { google: true, facebook: false, apple: true, twitter: false } },
  },
};

export default config;
