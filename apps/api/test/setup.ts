import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { beforeEach } from "vitest";
import { embeddings, mockFetch } from "./helpers";

await applyD1Migrations(env.DB, (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS);

// Every test starts with the fake embeddings API and no other outbound fetch; tests mock what they expect.
beforeEach(() => {
  embeddings.mockReset();
  mockFetch(() => new Response("unexpected fetch", { status: 500 }));
});
