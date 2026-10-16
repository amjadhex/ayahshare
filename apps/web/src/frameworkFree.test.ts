// The engine, canvas, API, analytics, platform adapter and app logic stay free of React, so the iOS / Android app
// (Capacitor) can plug in native pieces and any UI can drive them. Only src/ui/ and the entry may use React.
import { expect, it } from "vitest";

const sources = import.meta.glob<string>(["./**/*.ts", "!./ui/**", "!./test/**", "!./**/*.test.ts"], { query: "?raw", import: "default", eager: true });

it("modules outside src/ui do not import React", () => {
  expect(Object.keys(sources).length).toBeGreaterThan(15);
  const offenders = Object.entries(sources).filter(([, code]) => /from\s+["'](react|react-dom)(\/[^"']*)?["']/.test(code)).map(([f]) => f);
  expect(offenders).toEqual([]);
});
