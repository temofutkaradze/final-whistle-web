// Only actual API playing time establishes eligibility. HT/BT/P/live-without-phase are ambiguous.
export function isLiveCheckpoint(status, elapsed) {
  return (status === '2H' || status === 'ET') && Number.isInteger(elapsed) && elapsed >= 90;
}

export function checkpointFromFixture(fixture, observedAt) {
  const status = fixture?.fixture?.status;
  const home = fixture?.goals?.home, away = fixture?.goals?.away;
  if (!isLiveCheckpoint(status?.short, status?.elapsed) ||
      !Number.isInteger(home) || home < 0 || !Number.isInteger(away) || away < 0) return null;
  return { statusShort: status.short, elapsed: status.elapsed,
    extra: Number.isInteger(status.extra) && status.extra >= 0 ? status.extra : null,
    homeScore: home, awayScore: away, observedAt: observedAt.toISOString() };
}
