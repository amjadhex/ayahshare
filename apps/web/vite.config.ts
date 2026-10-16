import { createHash } from "node:crypto";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Dev: API, proxies and media come from a deployed Worker (default) or a local `wrangler dev` (API_TARGET=http://localhost:8787).
// /data/* is served from public/data (written by the pipeline).
const target = process.env.API_TARGET ?? "https://quran-design.rapid-sun-0190.workers.dev";

/** Builds src/sw.ts to /sw.js and injects the app shell (entry chunks, their imports, CSS, icons) to precache. */
function serviceWorker(): Plugin {
  return {
    name: "service-worker",
    apply: "build",
    buildStart() {
      this.emitFile({ type: "chunk", id: "src/sw.ts", fileName: "sw.js" });
    },
    generateBundle(_, bundle) {
      const sw = bundle["sw.js"];
      if (sw?.type !== "chunk") return;
      // The app's page is /app (/ is the landing page). The brand files the first screen shows (Home's logo and mark) are in the shell too, so the installed app never
      // waits for them.
      const shell = new Set(["/app", "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png", "/icons/apple-touch-icon.png",
        "/brand/lockup-light.svg", "/brand/lockup-dark.svg", "/brand/mark-emerald.svg", "/brand/mark.svg", "/brand/mark-white.svg"]);
      for (const f of Object.values(bundle)) {
        if (f.fileName === "sw.js") continue;
        if (f.type === "chunk" && f.isEntry) [f.fileName, ...f.imports].forEach((x) => shell.add(`/${x}`));
        if (f.type === "asset" && f.fileName.endsWith(".css")) shell.add(`/${f.fileName}`);
      }
      const list = [...shell].sort();
      const version = createHash("sha256").update(list.join()).digest("hex").slice(0, 10);
      sw.code = sw.code.replaceAll("__SHELL__", JSON.stringify(list)).replaceAll("__VERSION__", JSON.stringify(version));
    },
  };
}

/** Empties dist/ before each build like `emptyOutDir`, but keeps dist/admin, which the admin app (apps/admin) builds into.
 *  So the web app can be rebuilt on its own without deleting the admin build. */
function emptyOutDirKeepAdmin(): Plugin {
  let outDir = "";
  return {
    name: "empty-out-dir-keep-admin",
    apply: "build",
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
    buildStart() {
      if (!existsSync(outDir)) return;
      for (const f of readdirSync(outDir)) if (f !== "admin") rmSync(join(outDir, f), { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), emptyOutDirKeepAdmin(), serviceWorker()],
  worker: { format: "es" },
  build: {
    target: "es2022",
    // dist/ is emptied by emptyOutDirKeepAdmin() instead, which keeps dist/admin — see README.
    emptyOutDir: false,
  },
  // The export worker's encoder is found only when it first runs; listing it here stops the dev server from reloading
  // the page in the middle of the first export.
  optimizeDeps: { include: ["mediabunny", "@mediabunny/aac-encoder"] },
  server: {
    // dist/ is rebuilt by `npm run build` and by the admin app; changes there must not reload the dev page.
    watch: { ignored: ["**/dist/**"] },
    // The Worker accepts writes (sign-in, share links, saves) only from its own origin (CSRF guard), so the dev server
    // presents the target's origin on proxied requests; without this, writes from localhost get "bad origin".
    proxy: Object.fromEntries(
      ["/api", "/qapi", "/audio", "/media", "/s/", "/admin/api"].map((p) => [p, {
        target, changeOrigin: true, cookieDomainRewrite: "",
        configure: (proxy: { on: (event: "proxyReq", fn: (req: { getHeader: (n: string) => unknown; setHeader: (n: string, v: string) => void }) => void) => void }) => {
          proxy.on("proxyReq", (req) => { if (req.getHeader("origin")) req.setHeader("origin", new URL(target).origin); });
        },
      }]),
    ),
  },
});
