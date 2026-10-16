import { resolve } from "node:path";
import { defineConfig } from "vite";

// Dev: the admin API, media and the web app's /data files come from a deployed Worker (default) or a local `wrangler dev`
// (API_TARGET=http://localhost:8787) or `npm run mock` (API_TARGET=http://localhost:8788).
const target = process.env.API_TARGET ?? "https://quran-design.rapid-sun-0190.workers.dev";

export default defineConfig({
  base: "/admin/",
  build: {
    target: "es2022",
    // Served next to the web app: the Worker's static assets are apps/web/dist, so /admin/ is apps/web/dist/admin.
    // Only this folder is emptied, never apps/web/dist itself.
    outDir: resolve(import.meta.dirname, "../web/dist/admin"),
    emptyOutDir: true,
  },
  server: {
    proxy: Object.fromEntries(
      ["/admin/api", "/api/config", "/media", "/data/surahs.json", "/data/ayahs-en.json", "/data/topics.json", "/data/clips.json", "/data/bg", "/qapi"].map((p) => [p, { target, changeOrigin: true }]),
    ),
  },
});
