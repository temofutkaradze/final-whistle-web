import { beforeEach, describe, expect, it, vi } from "vitest";
import * as config from "../scripts/lib/config.mjs";
import { buildEventsHtml } from "../scripts/lib/events.mjs";
import { classifyError, createBackoff, createWorkerCore } from "../scripts/lib/worker-core.mjs";
import { createFakeDb } from "./helpers/fake-prisma";

// The worker's decisions, run against an in-memory database with fake match data, render server and Telegram.
// A tick() is one round of the worker (it runs once a minute). The clock is moved by hand.

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 10, 20, 0, 0);
const DAY = "2026-10-10";
const finished = (s: string) => config.FINISHED.has(s);
const dead = (s: string) => config.DEAD.has(s);

const GOAL = (minute: number, team = "Alpha FC", id = 1, name = "John Sample") => ({
  type: "Goal", detail: "Normal Goal", comments: null, time: { elapsed: minute, extra: null }, player: { id, name }, team: { name: team },
});
const networkError = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });

let clock: { now: number };
let db: ReturnType<typeof createFakeDb>;
let tg: { sendDocument: ReturnType<typeof vi.fn>; sendMessage: ReturnType<typeof vi.fn> };
let renderPost: ReturnType<typeof vi.fn>;
let football: { refreshStatuses: ReturnType<typeof vi.fn>; fetchEvents: ReturnType<typeof vi.fn>; saveEvents: ReturnType<typeof vi.fn>; isFinished: typeof finished; isDead: typeof dead };
let build: ReturnType<typeof vi.fn>;
let unlink: ReturnType<typeof vi.fn>;
let apiEvents: Record<number, unknown[]>; // what the "API" returns for the events of a fixture
let liveStatus: Record<number, string>; // what the "API" says about a match

function makeCore(extra: Record<string, unknown> = {}) {
  return createWorkerCore({
    prisma: db.prisma,
    football,
    buildEventsHtml: build,
    renderPost,
    brandLookFields: async (b: { name?: string; templateRef?: string }) => ({ template: b?.templateRef ?? "classic", page_name: b?.name ?? "" }),
    pickBackground: async () => ({ background_data_uri: "bg" }),
    telegramForUser: () => tg,
    unlink,
    localDate: (d: Date) => d.toISOString().slice(0, 10),
    config,
    now: () => clock.now,
    sleep: async () => {},
    log: () => {},
    error: () => {},
    ...extra,
  });
}

function addUser(id: string, extra: Record<string, unknown> = {}) {
  db.tables.user.push({ id, email: `${id}@x.com`, telegramChatId: `chat-${id}`, botToken: `enc-${id}`, ...extra });
  db.tables.brand.push({ id: `b-${id}`, userId: id, name: `Page ${id}`, templateRef: "classic", brandMode: "text", logoPath: null, backgroundPath: null, backgroundUrl: null, createdAt: 1 });
}
function addMatch(fixtureId: number, extra: Record<string, unknown> = {}) {
  db.tables.match.push({
    fixtureId, day: DAY, leagueId: 39, leagueName: "Premier League", leagueLogo: "l", homeTeam: "Alpha FC", awayTeam: "Beta FC", homeLogo: "h", awayLogo: "a",
    kickoff: new Date(T0 - 120 * MIN), statusShort: "NS", homeScore: null, awayScore: null, eventsJson: null, finishedAt: null, lastCheckedAt: null, ...extra,
  });
  liveStatus[fixtureId] ??= String(extra.statusShort ?? "NS");
}
function addSel(id: string, userId: string, fixtureId: number, extra: Record<string, unknown> = {}) {
  db.tables.selection.push({ id, userId, fixtureId, status: "SELECTED", backgroundPath: null, attempts: 0, lastError: null, sentAt: null, createdAt: new Date(T0 - 3 * 3600e3), updatedAt: new Date(T0 - 3 * 3600e3), ...extra });
}
const sel = (id: string) => db.tables.selection.find((s) => s.id === id)!;
const match = (id: number) => db.tables.match.find((m) => m.fixtureId === id)!;
const advance = (minutes: number) => (clock.now += minutes * MIN);
const finishedWithEvents = (id: number, hs = 1, as = 0) => addMatch(id, { statusShort: "FT", homeScore: hs, awayScore: as, eventsJson: hs + as ? [GOAL(10)] : [] });

beforeEach(() => {
  clock = { now: T0 };
  db = createFakeDb(clock);
  tg = { sendDocument: vi.fn(async () => {}), sendMessage: vi.fn(async () => {}) };
  renderPost = vi.fn(async () => "/tmp/post.jpg");
  build = vi.fn(buildEventsHtml);
  unlink = vi.fn(async () => {});
  apiEvents = {};
  liveStatus = {};
  football = {
    refreshStatuses: vi.fn(async (_day: string, list: { fixtureId: number }[]) => {
      for (const m of list) Object.assign(match(m.fixtureId), { statusShort: liveStatus[m.fixtureId] ?? "NS", lastCheckedAt: new Date(clock.now) });
    }),
    fetchEvents: vi.fn(async (id: number) => apiEvents[id] ?? []),
    saveEvents: vi.fn(async (id: number, events: unknown[]) => Object.assign(match(id), { eventsJson: events, finishedAt: new Date(clock.now) })),
    isFinished: finished,
    isDead: dead,
  };
  addUser("u1");
});

describe("classifyError", () => {
  it("treats 'nobody's fault' problems as transient", () => {
    for (const e of [
      networkError(),
      new Error("fetch failed"),
      Object.assign(new Error("x"), { code: "ECONNRESET" }),
      Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }),
      new Error("Render server answered with HTTP 503"),
      new Error("Telegram sendDocument failed: Too Many Requests: retry after 5"),
      new Error("Bad Gateway"),
    ]) expect(classifyError(e), String(e)).toBe("transient");
  });

  it("treats errors that will happen again as permanent", () => {
    for (const e of [
      new Error("Telegram sendDocument failed: Forbidden: bot was blocked by the user"),
      new Error("Telegram sendDocument failed: Bad Request: chat not found"),
      new Error("Custom template rejected: <script> is not allowed"),
      new Error("Unknown secret format"),
      new Error("Render server answered with HTTP 500"),
      "just a string",
      undefined,
    ]) expect(classifyError(e), String(e)).toBe("permanent");
  });
});

describe("createBackoff", () => {
  it("doubles the pause up to the maximum and forgets after ok()", () => {
    const b = createBackoff({ baseMs: 1000, maxMs: 5000 });
    expect(b.ready("k", 0)).toBe(true);
    expect([b.fail("k", 0), b.fail("k", 0), b.fail("k", 0), b.fail("k", 0)]).toEqual([1000, 2000, 4000, 5000]);
    expect(b.ready("k", 4999)).toBe(false);
    expect(b.ready("k", 5000)).toBe(true);
    b.ok("k");
    expect(b.fail("k", 0)).toBe(1000);
    expect(b.ready("other", 0)).toBe(true);
  });
});

describe("worker: the normal path", () => {
  it("sends the post once and records it", async () => {
    addMatch(1, { statusShort: "FT", homeScore: 2, awayScore: 1, eventsJson: [GOAL(10), GOAL(70)] });
    addSel("s1", "u1", 1);
    const core = makeCore();
    await core.tick();
    expect(renderPost).toHaveBeenCalledTimes(1);
    expect(renderPost.mock.calls[0][0]).toMatchObject({ fixture_id: "1_s1", home_team: "Alpha FC", home_score: 2, away_score: 1, page_name: "Page u1" });
    expect(tg.sendDocument).toHaveBeenCalledTimes(1);
    expect(tg.sendDocument).toHaveBeenCalledWith("chat-u1", "/tmp/post.jpg", "Alpha FC 2-1 Beta FC");
    expect(sel("s1")).toMatchObject({ status: "COMPLETED", sentAt: new Date(T0) });
    await core.tick();
    advance(5);
    await core.tick();
    expect(tg.sendDocument).toHaveBeenCalledTimes(1);
  });

  it("waits 110 minutes after kickoff, and does not touch the API before that", async () => {
    addMatch(1, { kickoff: new Date(T0 - 100 * MIN), statusShort: "2H" });
    addSel("s1", "u1", 1);
    const core = makeCore();
    await core.tick();
    expect(football.refreshStatuses).not.toHaveBeenCalled();
    advance(11);
    await core.tick();
    expect(football.refreshStatuses).toHaveBeenCalledTimes(1);
  });

  it("looks at a running match every 10 minutes, one request per day list", async () => {
    addMatch(1, { statusShort: "2H" });
    addMatch(2, { statusShort: "2H" });
    addSel("s1", "u1", 1);
    addSel("s2", "u1", 2);
    const core = makeCore();
    await core.tick();
    expect(football.refreshStatuses).toHaveBeenCalledTimes(1); // both matches, one list
    expect((football.refreshStatuses.mock.calls[0][1] as unknown[]).length).toBe(2);
    advance(5);
    await core.tick();
    expect(football.refreshStatuses).toHaveBeenCalledTimes(1);
    advance(6);
    await core.tick();
    expect(football.refreshStatuses).toHaveBeenCalledTimes(2);
  });

  it("when the match ends: status check, events download (once), then the post", async () => {
    addMatch(1, { statusShort: "2H" });
    addSel("s1", "u1", 1);
    liveStatus[1] = "FT";
    apiEvents[1] = [GOAL(33)];
    const core = makeCore();
    await core.tick();
    expect(football.fetchEvents).toHaveBeenCalledTimes(1);
    expect(football.saveEvents).toHaveBeenCalledTimes(1);
    expect(sel("s1").status).toBe("COMPLETED");
  });

  it("works out the post once and shares the events between customers; every customer gets own files", async () => {
    addUser("u2");
    addMatch(1, { statusShort: "2H" });
    addSel("s1", "u1", 1);
    addSel("s2", "u2", 1);
    liveStatus[1] = "FT";
    apiEvents[1] = [GOAL(33)];
    await makeCore().tick();
    expect(football.fetchEvents).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledTimes(1);
    expect(renderPost.mock.calls.map((c) => c[0].fixture_id).sort()).toEqual(["1_s1", "1_s2"]);
    expect(tg.sendDocument).toHaveBeenCalledTimes(2);
  });

  it("ignores customers who have no chat or no bot connected, and matches that are too old", async () => {
    addUser("u2", { botToken: null });
    addUser("u3", { telegramChatId: null });
    finishedWithEvents(1);
    finishedWithEvents(2);
    db.tables.match.find((m) => m.fixtureId === 2)!.kickoff = new Date(T0 - 25 * 3600e3);
    addSel("s2", "u2", 1);
    addSel("s3", "u3", 1);
    addSel("s4", "u1", 2);
    await makeCore().tick();
    expect(tg.sendDocument).not.toHaveBeenCalled();
    expect(db.tables.selection.every((s) => s.status === "SELECTED")).toBe(true);
  });

  it("uses a customer's own template, or Classic when it was deleted meanwhile", async () => {
    finishedWithEvents(1);
    addSel("s1", "u1", 1);
    db.tables.template.push({ id: "t1", userId: "u1", html: "<html>mine</html>" });
    db.tables.brand[0].templateRef = "custom:t1";
    await makeCore().tick();
    expect(renderPost.mock.calls[0][0]).toMatchObject({ template: "classic", template_html: "<html>mine</html>" });

    db.tables.selection.length = 0;
    addSel("s2", "u1", 1);
    db.tables.template.length = 0;
    await makeCore().tick();
    expect(renderPost.mock.calls[1][0].template).toBe("classic");
    expect(renderPost.mock.calls[1][0].template_html).toBeUndefined();
  });

  it("tells the customer when a match is postponed or cancelled, once", async () => {
    addMatch(1, { statusShort: "2H" });
    addSel("s1", "u1", 1);
    liveStatus[1] = "PST";
    const core = makeCore();
    await core.tick();
    expect(sel("s1")).toMatchObject({ status: "FAILED", lastError: "match PST" });
    expect(tg.sendMessage).toHaveBeenCalledTimes(1);
    expect(String(tg.sendMessage.mock.calls[0][1])).toContain("postponed or cancelled");
    advance(30);
    await core.tick();
    expect(tg.sendMessage).toHaveBeenCalledTimes(1);
    expect(tg.sendDocument).not.toHaveBeenCalled();
  });

  it("two workers running at the same time never send the same post twice", async () => {
    finishedWithEvents(1);
    addSel("s1", "u1", 1);
    await Promise.all([makeCore().tick(), makeCore().tick(), makeCore().tick()]);
    expect(tg.sendDocument).toHaveBeenCalledTimes(1);
    expect(sel("s1").status).toBe("COMPLETED");
  });
});

describe("worker: when the match data service has problems", () => {
  it("a failing status check does not stop posts that are ready", async () => {
    finishedWithEvents(1);
    addMatch(2, { statusShort: "2H" });
    addSel("s1", "u1", 1);
    addSel("s2", "u1", 2);
    football.refreshStatuses.mockRejectedValue(new Error("API-Football error: {\"rateLimit\":\"Too many requests\"}"));
    await makeCore().tick();
    expect(football.refreshStatuses).toHaveBeenCalledTimes(1);
    expect(sel("s1").status).toBe("COMPLETED");
    expect(sel("s2").status).toBe("SELECTED");
  });

  it("after a failed status check it waits 10, then 20, then 40 minutes (the free quota is protected)", async () => {
    addMatch(2, { statusShort: "2H" });
    addSel("s2", "u1", 2);
    football.refreshStatuses.mockRejectedValue(new Error("API down"));
    const core = makeCore();
    const calls: [number, number][] = [];
    for (let minute = 0; minute <= 80; minute++) {
      await core.tick();
      if (calls.length === 0 || football.refreshStatuses.mock.calls.length !== calls[calls.length - 1][1]) calls.push([minute, football.refreshStatuses.mock.calls.length]);
      advance(1);
    }
    expect(calls.map((c) => c[0])).toEqual([0, 10, 30, 70]); // tries at minute 0, 10, 30, 70 (pauses 10, 20, 40)
  });

  it("a failing events download does not stop other posts and is retried after 5, then 10 minutes", async () => {
    finishedWithEvents(1);
    addMatch(3, { statusShort: "FT", homeScore: 1, awayScore: 0 });
    addSel("s1", "u1", 1);
    addSel("s3", "u1", 3);
    football.fetchEvents.mockRejectedValue(new Error("API-Football error: timeout"));
    const core = makeCore();
    await core.tick();
    expect(sel("s1").status).toBe("COMPLETED");
    expect(football.fetchEvents).toHaveBeenCalledTimes(1);
    advance(1);
    await core.tick();
    expect(football.fetchEvents).toHaveBeenCalledTimes(1);
    advance(4);
    await core.tick();
    expect(football.fetchEvents).toHaveBeenCalledTimes(2);
    advance(9);
    await core.tick();
    expect(football.fetchEvents).toHaveBeenCalledTimes(2);
    advance(1);
    await core.tick();
    expect(football.fetchEvents).toHaveBeenCalledTimes(3);
    // when the service recovers, the post is made
    football.fetchEvents.mockResolvedValue([GOAL(5)]);
    advance(30);
    await core.tick();
    expect(sel("s3").status).toBe("COMPLETED");
  });

  it("a match that ended with goals but no events is looked up again before a post without scorers is made", async () => {
    addMatch(4, { statusShort: "FT", homeScore: 2, awayScore: 1 });
    addSel("s4", "u1", 4);
    apiEvents[4] = []; // the provider is late
    const core = makeCore();
    await core.tick();
    expect(football.saveEvents).not.toHaveBeenCalled();
    expect(tg.sendDocument).not.toHaveBeenCalled();
    advance(1);
    await core.tick();
    expect(football.fetchEvents).toHaveBeenCalledTimes(1); // waits 5 minutes
    advance(4);
    apiEvents[4] = [GOAL(20), GOAL(60), GOAL(80, "Beta FC", 2, "Luis Test")]; // the events arrive on the second look
    await core.tick();
    expect(football.fetchEvents).toHaveBeenCalledTimes(2);
    expect(football.saveEvents).toHaveBeenCalledTimes(1);
    expect(renderPost.mock.calls[0][0].total_events).toBe(2);
    expect(sel("s4").status).toBe("COMPLETED");
  });

  it("after three empty answers the post is made without scorers; a 0-0 match does not wait at all", async () => {
    addMatch(4, { statusShort: "FT", homeScore: 2, awayScore: 1 });
    addMatch(5, { statusShort: "FT", homeScore: 0, awayScore: 0 });
    addSel("s4", "u1", 4);
    addSel("s5", "u1", 5);
    const core = makeCore();
    await core.tick();
    expect(sel("s5").status).toBe("COMPLETED"); // 0-0: empty events are normal
    expect(sel("s4").status).toBe("SELECTED");
    advance(5);
    await core.tick();
    expect(sel("s4").status).toBe("SELECTED");
    advance(5);
    await core.tick();
    expect(football.fetchEvents.mock.calls.filter((c) => c[0] === 4).length).toBe(3);
    expect(sel("s4").status).toBe("COMPLETED");
    expect(renderPost.mock.calls.at(-1)?.[0]).toMatchObject({ total_events: 0, home_events_html: "" });
  });
});

describe("worker: when the render server or Telegram is unreachable", () => {
  it("does not use up the attempts: the post waits and is sent when the render server is back", async () => {
    finishedWithEvents(1);
    addSel("s1", "u1", 1);
    renderPost.mockRejectedValue(networkError());
    const core = makeCore();
    for (let i = 0; i < 40; i++) {
      await core.tick();
      advance(3);
    }
    expect(sel("s1")).toMatchObject({ status: "SELECTED", attempts: 0 });
    expect(sel("s1").lastError).toContain("fetch failed");
    expect(tg.sendMessage).not.toHaveBeenCalled(); // the customer is not told "could not be created"
    const tries = renderPost.mock.calls.length;
    expect(tries).toBeLessThan(15); // it did not try every minute

    renderPost.mockResolvedValue("/tmp/post.jpg");
    advance(10);
    await core.tick();
    expect(sel("s1").status).toBe("COMPLETED");
    expect(tg.sendDocument).toHaveBeenCalledTimes(1);
  });

  it("'too many requests' from Telegram is waiting, not failing", async () => {
    finishedWithEvents(1);
    addSel("s1", "u1", 1);
    tg.sendDocument.mockRejectedValueOnce(new Error("Telegram sendDocument failed: Too Many Requests: retry after 12"));
    const core = makeCore();
    await core.tick();
    expect(sel("s1")).toMatchObject({ status: "SELECTED", attempts: 0 });
    advance(2);
    await core.tick();
    expect(sel("s1").status).toBe("COMPLETED");
  });

  it("gives up after 24 hours of not being able to deliver, and tells the customer", async () => {
    finishedWithEvents(1);
    addSel("s1", "u1", 1);
    renderPost.mockRejectedValue(networkError());
    const core = makeCore();
    await core.tick();
    advance(25 * 60);
    await core.tick(); // outside the 24 h window: not tried any more
    expect(sel("s1").status).toBe("SELECTED");
    await core.expireOld();
    expect(sel("s1").status).toBe("FAILED");
    expect(String(tg.sendMessage.mock.calls[0][1])).toContain("could not get the final result");
  });
});

describe("worker: errors that will repeat", () => {
  it("counts attempts, keeps the pause between them, and after the last one closes the post and tells the customer", async () => {
    finishedWithEvents(1);
    addSel("s1", "u1", 1);
    tg.sendDocument.mockRejectedValue(new Error("Telegram sendDocument failed: Forbidden: bot was blocked by the user"));
    const core = makeCore();
    for (let attempt = 1; attempt <= config.MAX_ATTEMPTS; attempt++) {
      await core.tick();
      expect(sel("s1").attempts, `attempt ${attempt}`).toBe(attempt);
      expect(sel("s1").status).toBe(attempt === config.MAX_ATTEMPTS ? "FAILED" : "SELECTED");
      advance(1);
      await core.tick(); // too early: the pause between attempts holds
      expect(tg.sendDocument).toHaveBeenCalledTimes(attempt);
      advance(config.RETRY_DELAY_MIN);
    }
    expect(sel("s1").lastError).toContain("blocked by the user");
    expect(tg.sendMessage).toHaveBeenCalledTimes(1);
    expect(String(tg.sendMessage.mock.calls[0][1])).toContain("could not be created");
    advance(60);
    await core.tick();
    expect(tg.sendDocument).toHaveBeenCalledTimes(config.MAX_ATTEMPTS);
  });

  it("a rejected template or any other render error counts as an attempt", async () => {
    finishedWithEvents(1);
    addSel("s1", "u1", 1);
    renderPost.mockRejectedValueOnce(new Error("Custom template rejected: <script> is not allowed"));
    await makeCore().tick();
    expect(sel("s1")).toMatchObject({ status: "SELECTED", attempts: 1 });
  });
});

describe("worker: never the same post twice", () => {
  it("a post that was delivered but could not be saved (database asleep) is not sent again", async () => {
    finishedWithEvents(1);
    addSel("s1", "u1", 1);
    db.failNext("selection", "update", new Error("Can't reach database server"), 3, (a) => a.data.status === "COMPLETED");
    const core = makeCore();
    await core.tick();
    expect(tg.sendDocument).toHaveBeenCalledTimes(1);
    expect(sel("s1").status).toBe("SENDING"); // the note could not be written yet
    // the next rounds only save the note: nothing is sent again, even when the stuck-post recovery runs
    advance(20);
    await core.recoverStuck();
    expect(sel("s1").status).toBe("SENDING");
    await core.tick();
    expect(sel("s1")).toMatchObject({ status: "COMPLETED" });
    advance(10);
    await core.tick();
    expect(tg.sendDocument).toHaveBeenCalledTimes(1);
  });

  it("keeps trying to save for as long as the database is down", async () => {
    finishedWithEvents(1);
    addSel("s1", "u1", 1);
    db.failNext("selection", "update", new Error("Can't reach database server"), 9, (a) => a.data.status === "COMPLETED");
    const core = makeCore();
    await core.tick(); // 3 failures
    await core.tick(); // the saving of the pending note fails once more (4)
    advance(1);
    await core.tick();
    expect(sel("s1").status).toBe("SENDING");
    db.clearFailures();
    advance(1);
    await core.tick();
    expect(sel("s1").status).toBe("COMPLETED");
    expect(tg.sendDocument).toHaveBeenCalledTimes(1);
  });

  it("forgets a pending note when the customer meanwhile deleted the selection", async () => {
    finishedWithEvents(1);
    addSel("s1", "u1", 1);
    db.failNext("selection", "update", new Error("db"), 3, (a) => a.data.status === "COMPLETED");
    const core = makeCore();
    await core.tick();
    db.tables.selection.length = 0;
    await core.tick();
    expect(core._state.deliveredButUnsaved.size).toBe(0);
  });
});

describe("worker: housekeeping", () => {
  it("expireOld closes posts older than 24 hours and tells customers who have a bot, but nobody else", async () => {
    addUser("u2", { botToken: null });
    addMatch(1, { kickoff: new Date(T0 - 30 * 3600e3), statusShort: "2H" }); // never ended in our data
    addMatch(2, { kickoff: new Date(T0 - 3 * 3600e3), statusShort: "2H" });
    addSel("old", "u1", 1);
    addSel("fresh", "u1", 2);
    addSel("nobot", "u2", 1);
    await makeCore().expireOld();
    expect(sel("old")).toMatchObject({ status: "FAILED" });
    expect(sel("old").lastError).toContain("gave up");
    expect(sel("fresh").status).toBe("SELECTED");
    expect(sel("nobot").status).toBe("SELECTED");
    expect(tg.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("recoverStuck puts back posts stuck in SENDING for 15 minutes, all of them at start-up", async () => {
    finishedWithEvents(1);
    addSel("stuck", "u1", 1, { status: "SENDING", updatedAt: new Date(T0 - 20 * MIN) });
    addSel("busy", "u1", 1, { status: "SENDING", updatedAt: new Date(T0 - 2 * MIN) });
    const core = makeCore();
    expect(await core.recoverStuck()).toBe(1);
    expect(sel("stuck").status).toBe("SELECTED");
    expect(sel("busy").status).toBe("SENDING");
    expect(await core.recoverStuck({ all: true })).toBe(1);
    expect(sel("busy").status).toBe("SELECTED");
  });

  it("cleanup removes old matches with their selections and photos, and old list and usage records", async () => {
    addMatch(1, { kickoff: new Date(T0 - 50 * 3600e3) });
    addMatch(2, { kickoff: new Date(T0 - 5 * 3600e3) });
    addSel("old", "u1", 1, { backgroundPath: "/files/old.jpg" });
    addSel("new", "u1", 2, { backgroundPath: "/files/new.jpg" });
    db.tables.fixtureDay.push({ date: "2026-10-01" }, { date: "2026-10-10" });
    db.tables.apiUsage.push({ day: "2026-09-01", count: 5 }, { day: "2026-10-10", count: 5 });
    await makeCore().cleanup();
    expect(db.tables.match.map((m) => m.fixtureId)).toEqual([2]);
    expect(db.tables.selection.map((s) => s.id)).toEqual(["new"]);
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(unlink).toHaveBeenCalledWith("/files/old.jpg");
    expect(db.tables.fixtureDay.map((d) => d.date)).toEqual(["2026-10-10"]);
    expect(db.tables.apiUsage.map((d) => d.day)).toEqual(["2026-10-10"]);
  });
});
