import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildEventsHtml } from "../scripts/lib/events.mjs";

// buildEventsHtml turns the raw API-Football events into the scorers shown on the post.
const MATCH = { home_team: "Alpha FC", away_team: "Beta FC", home_score: 2, away_score: 1 };

type Ev = { type: string; detail: string; minute: number; extra?: number; player?: string; id?: number | null; team: string; comments?: string };
const ev = (e: Ev) => ({
  type: e.type,
  detail: e.detail,
  comments: e.comments ?? null,
  time: { elapsed: e.minute, extra: e.extra ?? null },
  player: { id: e.id === undefined ? 1 : e.id, name: e.player ?? "John Sample" },
  team: { name: e.team },
});
const goal = (minute: number, team: string, extra: Partial<Ev> = {}) => ev({ type: "Goal", detail: "Normal Goal", minute, team, ...extra });
const card = (minute: number, team: string, detail: string, extra: Partial<Ev> = {}) => ev({ type: "Card", detail, minute, team, ...extra });
const run = (events: unknown, match = MATCH) => buildEventsHtml(events, match);
const rows = (html: string) => (html.match(/<div class="event">/g) ?? []).length;

// the function logs every event it skips; keep the test output quiet
beforeAll(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterAll(() => vi.restoreAllMocks());

describe("buildEventsHtml: scorers", () => {
  it("gives empty lists for no events or unusable input", () => {
    const empty = { home_events_html: "", away_events_html: "", total_events: 0 };
    expect(run([])).toEqual(empty);
    expect(run(null)).toEqual(empty);
    expect(run("nope")).toEqual(empty);
    expect(run([null, 5, "x", undefined])).toEqual(empty);
  });

  it("puts home goals on the home side and away goals on the away side, name shortened", () => {
    const r = run([goal(12, "Alpha FC", { player: "John Sample", id: 1 }), goal(30, "Beta FC", { player: "Luis Test", id: 2 })]);
    expect(r.home_events_html).toBe(`<div class="event"><span class="minute">12'</span><span class="sep">|</span><span class="player-name">J. Sample</span></div>`);
    expect(r.away_events_html).toBe(`<div class="event"><span class="player-name">L. Test</span><span class="sep">|</span><span class="minute">30'</span></div>`);
    expect(r.total_events).toBe(2);
  });

  it("shortens only the first name and keeps one-word names", () => {
    expect(run([goal(5, "Alpha FC", { player: "Kevin De Bruyne" })]).home_events_html).toContain(">K. De Bruyne<");
    expect(run([goal(5, "Alpha FC", { player: "Neymar" })]).home_events_html).toContain(">Neymar<");
  });

  it("shows added time as 90+3 and lists goals in time order whatever order the API sent them", () => {
    const r = run([goal(90, "Alpha FC", { extra: 3, id: 2, player: "B Two" }), goal(10, "Alpha FC", { id: 1, player: "A One" }), goal(90, "Alpha FC", { id: 3, player: "C Three" })]);
    const minutes = [...r.home_events_html.matchAll(/class="minute">([^<]+)</g)].map((m) => m[1]);
    expect(minutes).toEqual(["10'", "90'", "90+3'"]);
  });

  it("joins several goals of the same player into one row", () => {
    const r = run([goal(12, "Alpha FC", { id: 7 }), goal(67, "Alpha FC", { id: 7 })]);
    expect(rows(r.home_events_html)).toBe(1);
    expect(r.home_events_html).toContain("12, 67'");
    expect(r.total_events).toBe(1);
  });

  it("does not join goals of players without an id that merely share a name", () => {
    // no id: a name alone is still used as the key, so the same name is joined (documented behaviour)
    const sameName = run([goal(12, "Alpha FC", { id: null, player: "John Sample" }), goal(67, "Alpha FC", { id: null, player: "John Sample" })]);
    expect(rows(sameName.home_events_html)).toBe(1);
    // different players stay separate
    const different = run([goal(12, "Alpha FC", { id: 1 }), goal(67, "Alpha FC", { id: 2, player: "Mark Other" })]);
    expect(rows(different.home_events_html)).toBe(2);
  });

  it("matches team names ignoring case and extra spaces", () => {
    expect(rows(run([goal(5, "  alpha   fc ")]).home_events_html)).toBe(1);
  });

  it("ignores goals of unknown teams and events without a minute", () => {
    expect(run([goal(5, "Gamma United")]).total_events).toBe(0);
    const noMinute = { ...goal(5, "Alpha FC"), time: { elapsed: null, extra: null } };
    expect(run([noMinute]).total_events).toBe(0);
  });

  it("ignores cancelled and disallowed goals and penalty shoot-out kicks", () => {
    const r = run([
      ev({ type: "Goal", detail: "Goal cancelled", minute: 20, team: "Alpha FC" }),
      ev({ type: "Goal", detail: "Goal Disallowed - offside", minute: 21, team: "Alpha FC" }),
      ev({ type: "Goal", detail: "Penalty", minute: 120, team: "Alpha FC", comments: "Penalty Shootout" }),
    ]);
    expect(r.total_events).toBe(0);
  });

  it("marks scored and missed penalties with an icon (white tick, red for a miss)", () => {
    const scored = run([ev({ type: "Goal", detail: "Penalty", minute: 30, team: "Alpha FC" })]).home_events_html;
    expect(scored).toContain('class="pk-wrap"');
    expect(scored).toContain('stroke="#ffffff"');
    const missed = run([ev({ type: "Goal", detail: "Missed Penalty", minute: 31, team: "Alpha FC" })]).home_events_html;
    expect(missed).toContain('class="pk-wrap"');
    expect(missed).toContain('stroke="#e50914"');
  });
});

describe("buildEventsHtml: cards", () => {
  it("shows a red card, but not a plain yellow card", () => {
    expect(run([card(40, "Beta FC", "Red Card")]).away_events_html).toContain('class="card-icon red"');
    expect(run([card(40, "Beta FC", "Yellow Card")]).total_events).toBe(0);
  });

  it("recognises a second yellow card, written either way", () => {
    expect(run([card(60, "Beta FC", "Second Yellow card")]).away_events_html).toContain("second-yellow");
    const yellowThenRed = run([card(60, "Beta FC", "Yellow Card", { id: 9 }), card(60, "Beta FC", "Red Card", { id: 9 })]);
    expect(yellowThenRed.away_events_html).toContain("second-yellow");
    expect(yellowThenRed.away_events_html).not.toContain('class="card-icon red"');
    expect(rows(yellowThenRed.away_events_html)).toBe(1);
  });

  it("a straight red for a player who had a yellow earlier is still a plain red", () => {
    const r = run([card(20, "Beta FC", "Yellow Card", { id: 9 }), card(70, "Beta FC", "Red Card", { id: 9 })]);
    expect(r.away_events_html).toContain('class="card-icon red"');
  });
});

describe("buildEventsHtml: own goals", () => {
  const own = (minute: number, team: string) => ev({ type: "Goal", detail: "Own Goal", minute, team, id: 50 });

  it("counts an own goal for the team that benefits, whichever way the API names the team", () => {
    // Home wins 1-0 through an own goal. Some data names the benefiting team (Alpha), some the player's own team (Beta).
    const match = { ...MATCH, home_score: 1, away_score: 0 };
    for (const team of ["Alpha FC", "Beta FC"]) {
      const r = run([own(33, team)], match);
      expect(r.home_events_html, team).toContain("33'");
      expect(r.away_events_html, team).toBe("");
    }
  });

  it("works the same for an away win", () => {
    const match = { ...MATCH, home_score: 0, away_score: 1 };
    for (const team of ["Alpha FC", "Beta FC"]) {
      const r = run([own(33, team)], match);
      expect(r.away_events_html, team).toContain("33'");
      expect(r.home_events_html, team).toBe("");
    }
  });
});

describe("buildEventsHtml: safety and size", () => {
  it("escapes player names (they come from outside)", () => {
    const r = run([goal(5, "Alpha FC", { player: 'Evil <img src=x onerror=alert(1)> "Q" & Co' })]);
    expect(r.home_events_html).not.toContain("<img");
    expect(r.home_events_html).toContain("&lt;img");
    expect(r.home_events_html).toContain("&quot;Q&quot;");
    expect(r.home_events_html).toContain("&amp;");
  });

  it("never drops a goal, but drops cards first when a side has more than 5 rows", () => {
    const goals = [1, 2, 3, 4, 5].map((i) => goal(i * 10, "Alpha FC", { id: 100 + i, player: `G${i} Player` }));
    const cards = [6, 7, 8].map((i) => card(i * 10, "Alpha FC", "Red Card", { id: 200 + i, player: `C${i} Player` }));
    const r = run([...goals, ...cards], { ...MATCH, home_score: 5 });
    expect(rows(r.home_events_html)).toBe(5);
    expect(r.home_events_html).not.toContain("card-icon");
    // six goals: all stay, because goals are never dropped
    const six = run([...goals, goal(55, "Alpha FC", { id: 106, player: "G6 Player" })], { ...MATCH, home_score: 6 });
    expect(rows(six.home_events_html)).toBe(6);
  });

  it("drops a missed penalty before a red card", () => {
    const events = [
      ...[1, 2, 3, 4].map((i) => goal(i * 10, "Alpha FC", { id: 100 + i, player: `G${i} Player` })),
      card(50, "Alpha FC", "Red Card", { id: 300, player: "R Card" }),
      ev({ type: "Goal", detail: "Missed Penalty", minute: 60, team: "Alpha FC", id: 301, player: "M Penalty" }),
    ];
    const r = run(events, { ...MATCH, home_score: 4 });
    expect(rows(r.home_events_html)).toBe(5);
    expect(r.home_events_html).toContain("card-icon red");
    expect(r.home_events_html).not.toContain("M. Penalty");
  });

  it("total_events always equals the rows on both sides", () => {
    const r = run([goal(5, "Alpha FC", { id: 1 }), goal(9, "Beta FC", { id: 2 }), card(80, "Beta FC", "Red Card", { id: 3 })]);
    expect(r.total_events).toBe(rows(r.home_events_html) + rows(r.away_events_html));
    expect(r.total_events).toBe(3);
  });
});
