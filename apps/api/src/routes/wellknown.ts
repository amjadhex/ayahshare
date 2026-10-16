// App links: share links (https://<site>/s/<code>) open the iOS / Android app when it is installed.
//   GET /.well-known/apple-app-site-association → iOS Universal Links (Associated Domains), needs APPLE_TEAM_ID
//   GET /.well-known/assetlinks.json            → Android App Links (autoVerify), needs ANDROID_CERT_SHA256
// Until those vars are set (wrangler.jsonc) the files carry placeholders, so their shape can be checked but no app is
// verified; the apps open qurandesign://s/<code> links meanwhile.
import { Hono } from "hono";

/** The apps' bundle id / package name (apps/mobile/capacitor.config.ts). */
export const APP_ID = "com.ayahshare.app";
const HOUR = { "Cache-Control": "public, max-age=3600" };

export const wellKnown = new Hono<{ Bindings: Env }>();

wellKnown.get("/.well-known/apple-app-site-association", (c) =>
  c.json({
    applinks: { details: [{ appIDs: [`${c.env.APPLE_TEAM_ID || "APPLE_TEAM_ID"}.${APP_ID}`], components: [{ "/": "/s/*", comment: "share links" }] }] },
  }, 200, HOUR));

wellKnown.get("/.well-known/assetlinks.json", (c) =>
  c.json([{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app", package_name: APP_ID,
      // One or more SHA-256 fingerprints of the signing certificate (Play app signing + upload key), comma-separated.
      sha256_cert_fingerprints: (c.env.ANDROID_CERT_SHA256 || "ANDROID_SIGNING_CERT_SHA256").split(",").map((s) => s.trim()).filter(Boolean),
    },
  }], 200, HOUR));
