import { describe, expect, it, vi } from "vitest";
import { runPoller, shouldRestart } from "../scripts/lib/poller.mjs";

// The loop that listens to one customer's Telegram bot, run against a scripted fake Telegram.

type Reply = unknown | Error;
function scriptedTelegram(script: Record<string, Reply[]>, fallback: Record<string, Reply> = {}) {
  const calls: { method: string; body: unknown; options: unknown }[] = [];
  const tg = {
    api: vi.fn(async (method: string, body?: unknown, options?: unknown) => {
      calls.push({ method, body, options });
      const queue = script[method];
      const next = queue && queue.length ? queue.shift() : fallback[method];
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error(`unexpected call: ${method}`);
      return next;
    }),
  };
  return { tg, calls };
}

const ok = (result: unknown = true) => ({ ok: true, result });
const ME = { ok: true, result: { username: "demo_bot" } };

function setup(script: Record<string, Reply[]>, opts: { stopAfterGetUpdates?: number; handle?: (...a: unknown[]) => unknown } = {}) {
  const { tg, calls } = scriptedTelegram(script, { getMe: ME, deleteWebhook: ok(), setMyCommands: ok(), getUpdates: { ok: true, result: [] } });
  const entry: Record<string, any> = { stop: false, failed: false, tg, label: "demo@x.com", ctx: { tg, ownerId: "u1" }, lastFailure: null };
  const sleeps: number[] = [];
  const logs: string[] = [];
  const errors: string[] = [];
  let updatesCalls = 0;
  const original = tg.api;
  tg.api = vi.fn(async (method: string, body?: unknown, options?: unknown) => {
    if (method === "getUpdates" && ++updatesCalls > (opts.stopAfterGetUpdates ?? 99)) entry.stop = true;
    return original(method, body, options);
  });
  let clock = 1_000_000;
  const deps = {
    handle: opts.handle ?? vi.fn(async () => {}),
    onUpdateError: vi.fn(async () => {}),
    sleep: async (ms: number) => void sleeps.push(ms),
    now: () => clock,
    log: (m: string) => logs.push(m),
    error: (...a: unknown[]) => errors.push(a.map(String).join(" ")),
  };
  return { entry, deps, calls, sleeps, logs, errors, tg, setClock: (t: number) => (clock = t), run: () => runPoller(entry, deps) };
}

describe("shouldRestart", () => {
  it("starts bots that are not running, leaves running ones, and restarts failed ones only after the pause", () => {
    expect(shouldRestart(undefined, 0)).toBe(true);
    expect(shouldRestart({ failed: false }, 0)).toBe(false);
    expect(shouldRestart({ failed: true, retryAt: 1000 }, 999)).toBe(false);
    expect(shouldRestart({ failed: true, retryAt: 1000 }, 1000)).toBe(true);
    expect(shouldRestart({ failed: true }, 0)).toBe(true);
  });
});

describe("runPoller: starting", () => {
  it("checks the bot, removes a webhook, sets the commands and starts listening", async () => {
    const s = setup({ getUpdates: [{ ok: true, result: [] }] }, { stopAfterGetUpdates: 1 });
    await s.run();
    expect(s.calls.map((c) => c.method).filter((m) => m !== "getUpdates")).toEqual(["getMe", "deleteWebhook", "setMyCommands"]);
    expect(s.calls.some((c) => c.method === "getUpdates")).toBe(true);
    expect(s.logs[0]).toContain("@demo_bot is running");
    expect(s.entry.failed).toBe(false);
  });

  it("a bad token is not tried again every 10 seconds: 5 minutes pause, said only once", async () => {
    const s = setup({ getMe: [{ ok: false, error_code: 401, description: "Unauthorized" }, { ok: false, error_code: 401, description: "Unauthorized" }] });
    await s.run();
    expect(s.entry).toMatchObject({ failed: true, retryAt: 1_000_000 + 5 * 60_000 });
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]).toContain("Unauthorized");
    expect(s.errors[0]).toContain("5 minutes");
    expect(s.calls.map((c) => c.method)).toEqual(["getMe"]); // nothing else was started
    await s.run(); // the next try, same entry: the same message is not repeated
    expect(s.errors).toHaveLength(1);
  });

  it("no internet at start: failed for 30 seconds, then tried again (it does not crash)", async () => {
    const s = setup({ getMe: [new TypeError("fetch failed")] });
    await expect(s.run()).resolves.toBeUndefined();
    expect(s.entry).toMatchObject({ failed: true, retryAt: 1_000_000 + 30_000 });
    expect(s.errors[0]).toContain("cannot reach Telegram");
  });

  it("an error while removing the webhook or setting the commands is handled the same way", async () => {
    const s = setup({ deleteWebhook: [new Error("socket hang up")] });
    await s.run();
    expect(s.entry.failed).toBe(true);
  });
});

describe("runPoller: the internet drops while the bot is running", () => {
  it("waits 2, 4, 8 ... seconds (at most 60) and carries on when it is back; says so once each way", async () => {
    const down = () => new TypeError("fetch failed");
    const s = setup({ getUpdates: [down(), down(), down(), down(), down(), down(), down(), down(), down(), down(), { ok: true, result: [] }, { ok: true, result: [] }] }, { stopAfterGetUpdates: 12 });
    await s.run();
    expect(s.sleeps).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000, 60000, 60000]);
    expect(s.errors.filter((e) => e.includes("connection problem"))).toHaveLength(1);
    expect(s.logs.filter((l) => l.includes("connection is back"))).toHaveLength(1);
    expect(s.entry.failed).toBe(false);
  });

  it("the waiting starts again from 2 seconds after the connection was back", async () => {
    const down = () => new TypeError("fetch failed");
    const s = setup({ getUpdates: [down(), down(), { ok: true, result: [] }, down(), { ok: true, result: [] }] }, { stopAfterGetUpdates: 5 });
    await s.run();
    expect(s.sleeps).toEqual([2000, 4000, 2000]);
  });

  it("a timeout (Telegram did not answer) is treated like a lost connection, and getUpdates is given a longer time limit", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const s = setup({ getUpdates: [timeout, { ok: true, result: [] }] }, { stopAfterGetUpdates: 2 });
    await s.run();
    expect(s.sleeps).toEqual([2000]);
    const polls = s.calls.filter((c) => c.method === "getUpdates");
    expect(polls[0].options).toEqual({ timeoutMs: 40_000 });
    expect(polls[0].body).toMatchObject({ timeout: 25, offset: 0 });
  });

  it("stopping the bot while it waits ends the loop without another request", async () => {
    const s = setup({ getUpdates: [new TypeError("fetch failed")] });
    s.deps.sleep = async () => {
      s.entry.stop = true;
    };
    await s.run();
    expect(s.logs.at(-1)).toContain("bot stopped");
  });
});

describe("runPoller: Telegram answers with an error", () => {
  it("a revoked token (401) ends the loop and schedules a check in 5 minutes", async () => {
    const s = setup({ getUpdates: [{ ok: false, error_code: 401, description: "Unauthorized" }] });
    await s.run();
    expect(s.entry).toMatchObject({ failed: true, retryAt: 1_000_000 + 5 * 60_000 });
  });

  it("other errors: wait 5 seconds and go on; 409 explains the likely cause", async () => {
    const s = setup({ getUpdates: [{ ok: false, error_code: 409, description: "Conflict: terminated by other getUpdates request" }, { ok: true, result: [] }] }, { stopAfterGetUpdates: 2 });
    await s.run();
    expect(s.sleeps).toEqual([5000]);
    expect(s.errors.join("\n")).toContain("another poller");
  });
});

describe("runPoller: messages", () => {
  const update = (id: number, text = "hi") => ({ update_id: id, message: { chat: { id: 5 }, text } });

  it("hands every update to the handler and asks only for newer ones afterwards", async () => {
    const handle = vi.fn(async () => {});
    const s = setup({ getUpdates: [{ ok: true, result: [update(10), update(11)] }, { ok: true, result: [] }] }, { stopAfterGetUpdates: 2, handle });
    await s.run();
    expect(handle).toHaveBeenCalledTimes(2);
    const polls = s.calls.filter((c) => c.method === "getUpdates");
    expect(polls[1].body).toMatchObject({ offset: 12 });
  });

  it("a failing handler does not stop the loop: the person is told, the next update is handled", async () => {
    const handle = vi.fn(async (_ctx: unknown, u: unknown) => {
      if ((u as { update_id: number }).update_id === 10) throw new Error("database is asleep");
    });
    const s = setup({ getUpdates: [{ ok: true, result: [update(10), update(11)] }, { ok: true, result: [] }] }, { stopAfterGetUpdates: 2, handle });
    await s.run();
    expect(handle).toHaveBeenCalledTimes(2);
    expect(s.deps.onUpdateError).toHaveBeenCalledTimes(1);
    expect(s.errors.join("\n")).toContain("failed to handle update");
    // a failing update is not asked for again (otherwise one bad message would block the bot forever)
    expect(s.calls.filter((c) => c.method === "getUpdates")[1].body).toMatchObject({ offset: 12 });
  });

  it("even a failing 'tell the person' does not stop the loop", async () => {
    const handle = vi.fn(async () => {
      throw new Error("x");
    });
    const s = setup({ getUpdates: [{ ok: true, result: [update(1)] }, { ok: true, result: [] }] }, { stopAfterGetUpdates: 2, handle });
    s.deps.onUpdateError = vi.fn(async () => {
      throw new Error("Telegram is down too");
    });
    await expect(s.run()).resolves.toBeUndefined();
    expect(s.logs.at(-1)).toContain("bot stopped");
  });
});
