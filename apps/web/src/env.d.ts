/// <reference types="vite/client" />

// Build-time settings read by the iOS / Android app (src/platform-native.ts; see apps/mobile/README.md).
interface ImportMetaEnv {
  /** The API the app calls (default: the deployed Worker). The web app always uses the origin it was loaded from. */
  readonly VITE_APP_API_BASE?: string;
  /** Google Cloud OAuth client id of type iOS; empty → sign-in hidden in the iOS app. */
  readonly VITE_GOOGLE_IOS_CLIENT_ID?: string;
  /** Google Cloud OAuth client id of type Android; empty → sign-in hidden in the Android app. */
  readonly VITE_GOOGLE_ANDROID_CLIENT_ID?: string;
}
