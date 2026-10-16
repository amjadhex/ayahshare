// Secrets set with `wrangler secret put` (not visible to `wrangler types`), and bindings that may be absent.
interface Env {
  OPENROUTER_API_KEY: string;
  ADMIN_TOKEN: string;
  // Quran Foundation API client (tafsir, QuranReflect; src/lib/qf.ts). Reflect answers 503 without them.
  QF_CLIENT_ID?: string;
  QF_CLIENT_SECRET?: string;
  EVENTS?: AnalyticsEngineDataset; // bound once Analytics Engine is enabled on the account (wrangler.jsonc)
  // Email sign-in (src/lib/email.ts): the key its codes are hashed with. Email sign-in is off without it.
  AUTH_CODE_SECRET?: string;
  // Turnstile's secret key (src/lib/turnstile.ts); the check is required only with it and the TURNSTILE_SITE_KEY var.
  TURNSTILE_SECRET?: string;
  // Sign in with Apple (src/lib/apple.ts): the identity token audiences accepted, comma-separated. Unset → the iOS app's
  // bundle id, com.ayahshare.app. Add the Services ID here if Apple sign-in ever comes to the web.
  APPLE_CLIENT_IDS?: string;
  // The Sign in with Apple key's .p8 (PEM text) for APPLE_KEY_ID: signs the client secret with which the Worker exchanges
  // the app's authorization code for a refresh token, and revokes it when the account is deleted. Unset → neither happens.
  APPLE_SIGNIN_KEY?: string;
  // The web's daily reminder (src/lib/webpush.ts): the private half of the VAPID_PUBLIC_KEY var, base64url 'd' (32 bytes).
  // Unset → no web reminder (PublicConfig.vapidPublicKey missing, the cron sends nothing).
  VAPID_PRIVATE_KEY?: string;
}
