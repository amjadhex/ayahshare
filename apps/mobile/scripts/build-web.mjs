// Builds the web app (apps/web) for the apps into apps/mobile/www (capacitor.config.ts webDir). It never touches
// apps/web/dist, which is the website's build. The service worker is left out: the app has its files on board.
// VITE_APP_API_BASE defaults to https://ayahshare.com (see README → Build-time settings).
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("../../web/", import.meta.url));
const www = fileURLToPath(new URL("../www/", import.meta.url));
// Google sign-in (README → Google sign-in): the OAuth clients of the iOS app and the Android app, in the Google Cloud
// project of the web client the Worker checks (quran-design-app, info@eventhex.ai; 16 Oct 2026). Android has three
// (Play signing key, the previous one, the upload key); any of them turns the button on.
const env = {
  ...process.env,
  VITE_APP_API_BASE: process.env.VITE_APP_API_BASE || "https://ayahshare.com",
  VITE_GOOGLE_IOS_CLIENT_ID: process.env.VITE_GOOGLE_IOS_CLIENT_ID || "11230418675-ak85t5ngfebgl5gi25i87uv9014ngnge.apps.googleusercontent.com",
  VITE_GOOGLE_ANDROID_CLIENT_ID: process.env.VITE_GOOGLE_ANDROID_CLIENT_ID || "11230418675-0mruvd0i3dv51a9lfhv64vnt3rclerii.apps.googleusercontent.com",
};

const run = (args) => {
  const r = spawnSync("npx", args, { cwd: web, env, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
if (!process.argv.includes("--no-check")) run(["tsc", "--noEmit"]);
run(["vite", "build", "--outDir", www, "--emptyOutDir"]);
for (const f of ["sw.js", "admin"]) rmSync(new URL(f, `file://${www}`), { recursive: true, force: true });
console.log(`web app built into ${www} (API ${env.VITE_APP_API_BASE})`);
