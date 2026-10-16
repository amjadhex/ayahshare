import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      remoteBindings: false, // AI / Vectorize / ASSETS are faked per test (test/helpers.ts); D1, R2 and the cache are local
      // The pool bundles an older workerd than wrangler; tests run on the newest date it supports.
      // D1 counters are written at the end of each request (src/lib/counters.ts) instead of after a 15 s window.
      miniflare: { compatibilityDate: "2026-08-22", bindings: { TEST_MIGRATIONS: await readD1Migrations("./migrations"), COUNTER_FLUSH_SECONDS: "0" } },
    }),
  ],
  test: { setupFiles: ["./test/setup.ts"] },
}));
