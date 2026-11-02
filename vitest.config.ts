import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests live in tests/. They need no database, no network and no browser: everything that talks to the outside
// (Postgres, Telegram, API-Football, Chromium) is replaced or left out. Run them with:  npm test
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
