import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests use mocked Postgres, Telegram and API-Football; no production credentials are needed.
// News renderer integration tests require installed Playwright Chromium and an ephemeral local port.
// Match renderer tests use a fake browser. Run all tests with: npm test
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
