import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// worker.mjs and bot.mjs start running as soon as they are loaded, so they cannot be imported in a test.
// This test checks the connections instead: every name they import from ./lib/... really exists there.
// (A misspelt or renamed import would otherwise only show when the program is started.)
vi.mock("../scripts/lib/db.mjs", () => ({ prisma: {} }));

const ROOT = resolve(__dirname, "..");

describe("the bot and the worker are connected to the right functions", () => {
  for (const file of ["scripts/worker.mjs", "scripts/bot.mjs"]) {
    it(`${file}: every imported name exists`, async () => {
      const source = readFileSync(join(ROOT, file), "utf8");
      const imports = [...source.matchAll(/import\s+(?:\{([^}]*)\}|\*\s+as\s+(\w+)|(\w+))\s+from\s+"(\.\/lib\/[^"]+)"/g)];
      expect(imports.length).toBeGreaterThan(3);
      for (const [, names, , , target] of imports) {
        const mod = await import(/* @vite-ignore */ join(ROOT, "scripts", target));
        for (const name of (names ?? "").split(",").map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
          expect(mod[name], `${file} imports "${name}" from ${target}, which does not export it`).toBeDefined();
        }
      }
    });
  }

  it("the worker hands the worker core everything it needs", () => {
    const source = readFileSync(join(ROOT, "scripts/worker.mjs"), "utf8");
    for (const dep of ["prisma", "football", "buildEventsHtml", "renderPost", "brandLookFields", "pickBackground", "telegramForUser", "unlink", "localDate", "config"]) {
      expect(source, dep).toMatch(new RegExp(`createWorkerCore\\(\\{[\\s\\S]*\\b${dep}\\b[\\s\\S]*\\}\\)`));
    }
    const football = source.match(/football:\s*\{([^}]*)\}/)?.[1] ?? "";
    for (const fn of ["refreshStatuses", "fetchEvents", "saveEvents", "isFinished", "isDead"]) expect(football).toContain(fn);
  });
});
