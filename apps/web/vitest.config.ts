import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Component and unit tests (jsdom). The build config (vite.config.ts) is separate: its service-worker and dist plugins
// have nothing to do in tests.
export default defineConfig({
  plugins: [react()],
  // src/legal.test.ts reads the legal pages' source in legal/ at the repo root.
  server: { fs: { allow: ["../.."] } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
