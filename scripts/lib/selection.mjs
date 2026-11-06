// A customer taps a match button in Telegram: select it, or take the selection back.
// Returns what happened, so bot.mjs can answer the tap. Written to survive double taps and a post that is being sent.

export async function toggleSelection({ prisma, userId, fixtureId, maxAgeHours, now = Date.now() }) {
  const match = await prisma.match.findUnique({ where: { fixtureId } });
  if (!match) return { result: "no-match" };

  const existing = await prisma.selection.findUnique({ where: { userId_fixtureId: { userId, fixtureId } } });
  if (existing) {
    if (existing.status === "COMPLETED") return { result: "already-sent" };
    // The worker is sending it right now: removing it here would break that send.
    if (existing.status === "SENDING") return { result: "sending" };
    const removed = await prisma.selection.deleteMany({
      where: { id: existing.id, userId, fixtureId, status: { in: ["SELECTED", "FAILED"] } },
    });
    if (!removed.count) {
      const current = await prisma.selection.findUnique({ where: { userId_fixtureId: { userId, fixtureId } } });
      if (current?.status === "COMPLETED") return { result: "already-sent" };
      if (current?.status === "SENDING") return { result: "sending" };
      if (current) return { result: "selected" }; // a replacement or another state: leave it intact
    }
    return { result: "removed" };
  }

  if (match.kickoff.getTime() < now - maxAgeHours * 3600e3) return { result: "too-old" };
  try {
    await prisma.selection.create({ data: { userId, fixtureId } });
  } catch (e) {
    if (e?.code !== "P2002") throw e; // a second tap selected it a moment earlier: same result
  }
  return { result: "selected" };
}
