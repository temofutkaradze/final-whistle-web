import { beforeEach, describe, expect, it } from "vitest";
import { toggleSelection } from "../scripts/lib/selection.mjs";
import { createFakeDb } from "./helpers/fake-prisma";


const HOUR = 3600e3;
const NOW = Date.UTC(2026, 9, 10, 20, 0, 0);
let db: ReturnType<typeof createFakeDb>;
const toggle = (extra: Record<string, unknown> = {}) => toggleSelection({ prisma: db.prisma, userId: "u1", fixtureId: 1, maxAgeHours: 24, now: NOW, ...extra });
const selections = () => db.tables.selection.filter((s) => s.userId === "u1" && s.fixtureId === 1);

beforeEach(() => {
  db = createFakeDb({ now: NOW });
  db.tables.match.push({ fixtureId: 1, kickoff: new Date(NOW - 2 * HOUR) });
});

describe("tapping a match button", () => {
  it("selects the match, and a second tap removes the selection", async () => {
    expect(await toggle()).toEqual({ result: "selected" });
    expect(selections()).toHaveLength(1);
    expect(selections()[0].status).toBe("SELECTED");
    expect(await toggle()).toEqual({ result: "removed" });
    expect(selections()).toHaveLength(0);
  });

  it("says so when the match does not exist any more or is older than 24 hours", async () => {
    expect(await toggle({ fixtureId: 99 })).toEqual({ result: "no-match" });
    db.tables.match[0].kickoff = new Date(NOW - 25 * HOUR);
    expect(await toggle()).toEqual({ result: "too-old" });
    expect(selections()).toHaveLength(0);
  });

  it("does not remove a post that was already sent", async () => {
    await toggle();
    selections()[0].status = "COMPLETED";
    expect(await toggle()).toEqual({ result: "already-sent" });
    expect(selections()).toHaveLength(1);
  });

  it("does not remove a post that is being sent right now", async () => {
    await toggle();
    selections()[0].status = "SENDING";
    expect(await toggle()).toEqual({ result: "sending" });
    expect(selections()).toHaveLength(1);
    expect(selections()[0].status).toBe("SENDING");
  });

  it("a failed post can be removed, and selected again", async () => {
    await toggle();
    selections()[0].status = "FAILED";
    expect(await toggle()).toEqual({ result: "removed" });
    expect(await toggle()).toEqual({ result: "selected" });
  });

  it("a quick double tap does not crash: both taps get an answer and only one selection exists", async () => {
    const results = await Promise.all([toggle(), toggle()]);
    expect(results.map((r) => r.result)).toEqual(["selected", "selected"]);
    expect(selections()).toHaveLength(1);
  });

  it("two taps on a selected match both end with the selection removed", async () => {
    await toggle();
    const results = await Promise.all([toggle(), toggle()]);
    expect(results.map((r) => r.result)).toEqual(["removed", "removed"]);
    expect(selections()).toHaveLength(0);
  });

  it("other database errors are not hidden", async () => {
    db.failNext("selection", "create", new Error("Can't reach database server"));
    await expect(toggle()).rejects.toThrow("Can't reach database server");
  });

  it("selections of different customers do not interfere", async () => {
    await toggle();
    expect(await toggle({ userId: "u2" })).toEqual({ result: "selected" });
    expect(db.tables.selection).toHaveLength(2);
  });
});

describe('worker claim between selection lookup and deletion',()=>{
  it.each(['SENDING','COMPLETED'])('keeps the row after the worker changes it to %s',async status=>{
    await toggle();
    const remove=db.prisma.selection.deleteMany;
    db.prisma.selection.deleteMany=async(args:unknown)=>{selections()[0].status=status;return remove(args);};
    expect(await toggle()).toEqual({result:status==='SENDING'?'sending':'already-sent'});
    expect(selections()).toHaveLength(1);expect(selections()[0].status).toBe(status);
  });
  it('preserves a replacement created by another tap rather than deleting it by a stale ID',async()=>{
    await toggle();const remove=db.prisma.selection.deleteMany;
    db.prisma.selection.deleteMany=async(args:unknown)=>{selections()[0].id='replacement';return remove(args);};
    expect(await toggle()).toEqual({result:'selected'});expect(selections()[0].id).toBe('replacement');
  });
  it('does not hide conditional-delete database failures',async()=>{
    await toggle();db.failNext('selection','deleteMany',new Error('database unavailable'));
    await expect(toggle()).rejects.toThrow('database unavailable');expect(selections()).toHaveLength(1);
  });
});
