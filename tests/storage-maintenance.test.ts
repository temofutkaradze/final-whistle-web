import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cleanupDeliveredMatchArtifacts, cleanupMatchHtmlAfterRender, runStorageMaintenance, runTemporaryDirectoryMaintenance, storageMaintenanceInternals, TEMP_RETENTION_MS } from '../scripts/lib/storage-maintenance.mjs';

const NOW = Date.UTC(2026, 10, 28, 12);
const staleTime = new Date(NOW - TEMP_RETENTION_MS - 1000);
type FixtureRow = Record<string, any>;
let roots: string[] = [];
async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-storage-maintenance-'));
  roots.push(root);
  for (const dir of ['storage/news-tmp', 'storage/renderer-tmp', 'render/rendered', 'render/output']) await fs.mkdir(path.join(root, dir), { recursive: true });
  return root;
}
async function staleFile(file: string, text = 'fixture') {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
  await fs.utimes(file, staleTime, staleTime);
}
function fakePrisma({ sessions = [], challenges = [], pending = [], selections = [], matches = [] }: { sessions?: FixtureRow[]; challenges?: FixtureRow[]; pending?: FixtureRow[]; selections?: FixtureRow[]; matches?: FixtureRow[] } = {}) {
  const session = { findMany: vi.fn(async () => sessions), deleteMany: vi.fn(async () => ({ count: 0 })) };
  const matchPairingChallenge = { findMany: vi.fn(async () => challenges), deleteMany: vi.fn(async () => ({ count: 0 })) };
  const newsSettings = { findMany: vi.fn(async () => pending), updateMany: vi.fn(async () => ({ count: 0 })) };
  const match = { findMany: vi.fn(async () => matches) };
  const selection = { findMany: vi.fn(async (args: any) => {
    if (args?.where?.id?.in) return selections.filter(row => args.where.id.in.includes(row.id));
    if (args?.where?.fixtureId?.in) return selections.filter(row => args.where.fixtureId.in.includes(row.fixtureId));
    return [];
  }) };
  return { session, matchPairingChallenge, newsSettings, match, selection };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe('dry-run storage maintenance', () => {
  it('reports only aged delivered Match artifacts and expired records, preserving retryable and unknown files', async () => {
    const root = await tempRoot();
    const files = [
      'render/output/123_done_uuid.png',
      'render/rendered/123_done_uuid.html',
      'render/output/123_retry_uuid.png',
      'render/output/123_failed_uuid.png',
      'render/output/123_uncertain_uuid.png',
      'render/output/987_missing_uuid.png',
    ];
    for (const relative of files) await staleFile(path.join(root, relative));
    const db = fakePrisma({
      sessions: [{ id: 'expired-session', expiresAt: new Date(NOW - 1) }],
      challenges: [{ id: 'expired-challenge', expiresAt: new Date(NOW - 1) }],
      pending: [{ userId: 'u1', pending: { stage: 'collecting', ts: NOW - TEMP_RETENTION_MS - 1, lastAppliedUpdateId: 77 } }],
      selections: [
        { id: 'done', fixtureId: 123, status: 'COMPLETED', liveStatus: 'SENT' },
        { id: 'retry', fixtureId: 123, status: 'SELECTED', liveStatus: 'PENDING' },
        { id: 'failed', fixtureId: 123, status: 'FAILED', liveStatus: 'FAILED', finalDispatchAt: null, liveDispatchAt: null },
        { id: 'uncertain', fixtureId: 123, status: 'FAILED', liveStatus: 'UNCERTAIN', finalDispatchAt: new Date(NOW - 2), liveDispatchAt: new Date(NOW - 1) },
      ],
    });
    const report = await runStorageMaintenance({ prisma: db, root, mode: 'dry-run', now: NOW });
    expect(report.files.map((file: any) => path.relative(root, file.path).replace(/\\/g, '/')).sort()).toEqual([
      'render/output/123_done_uuid.png',
      'render/output/123_failed_uuid.png',
      'render/rendered/123_done_uuid.html',
    ]);
    expect(report.database.expiredSessions.map((row: any) => row.id)).toEqual(['expired-session']);
    expect(report.database.expiredPairingChallenges.map((row: any) => row.id)).toEqual(['expired-challenge']);
    expect(report.database.expiredInactiveNewsConversations).toEqual([{ userId: 'u1', lastAppliedUpdateId: 77 }]);
    expect(db.session.deleteMany).not.toHaveBeenCalled();
    expect(db.matchPairingChallenge.deleteMany).not.toHaveBeenCalled();
    expect(db.newsSettings.updateMany).not.toHaveBeenCalled();
    for (const relative of files) await expect(fs.access(path.join(root, relative))).resolves.toBeUndefined();
  });

  it('protects every News output while a rendering or uncertain sending state exists', async () => {
    const root = await tempRoot();
    const news = path.join(root, 'render/output/news_abandoned.png');
    await staleFile(news);
    const db = fakePrisma({ pending: [{ userId: 'u1', pending: { stage: 'sending', outputPath: news, lastAppliedUpdateId: 12 } }] });
    const report = await runStorageMaintenance({ prisma: db, root, mode: 'dry-run', now: NOW });
    expect(report.files).toEqual([]);
    await expect(fs.access(news)).resolves.toBeUndefined();
  });

  it('limits database cleanup to expired sessions, challenges, and idle conversations while preserving update markers', async () => {
    const root = await tempRoot();
    const stalePending = { stage: 'branding', ts: NOW - TEMP_RETENTION_MS - 1, lastAppliedUpdateId: 44, background: 'private-file-id' };
    const db = fakePrisma({
      sessions: [{ id: 'expired-session', expiresAt: new Date(NOW - 1) }],
      challenges: [{ id: 'expired-challenge', expiresAt: new Date(NOW - 1) }],
      pending: [{ userId: 'u1', pending: stalePending, lastUpdateId: 44 }],
    });
    db.session.deleteMany.mockResolvedValue({ count: 1 });
    db.matchPairingChallenge.deleteMany.mockResolvedValue({ count: 1 });
    db.newsSettings.updateMany.mockResolvedValue({ count: 1 });
    const result = await runStorageMaintenance({ prisma: db, root, mode: 'apply', now: NOW });
    expect(result.database.deleted).toEqual({ sessions: 1, pairingChallenges: 1, newsPending: 1, matchReceipts: 0 });
    expect(db.newsSettings.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'u1', lastUpdateId: 44, pending: { equals: stalePending } }),
      data: { pending: { lastAppliedUpdateId: 44 } },
    }));
  });

  it('cleans only the approved aged News scratch file when explicitly applying to a disposable fixture', async () => {
    const root = await tempRoot();
    const old = path.join(root, 'storage/news-tmp/orphan.tmp');
    await staleFile(old);
    const preview = await runTemporaryDirectoryMaintenance({ name: 'newsTemp', root, mode: 'dry-run', now: NOW });
    expect(preview.candidates.map((row: any) => row.path)).toEqual([old]);
    await expect(fs.access(old)).resolves.toBeUndefined();
    const applied = await runTemporaryDirectoryMaintenance({ name: 'newsTemp', root, mode: 'apply', now: NOW });
    expect(applied.deleted).toBe(1);
    await expect(fs.access(old)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports then removes only a wholly stale renderer profile tree in the isolated startup sweep', async () => {
    const root = await tempRoot();
    const profile = path.join(root, 'storage/renderer-tmp/profile-a');
    const cache = path.join(profile, 'Default/Cache/data');
    await staleFile(cache);
    await fs.utimes(path.join(profile, 'Default/Cache'), staleTime, staleTime);
    await fs.utimes(path.join(profile, 'Default'), staleTime, staleTime);
    await fs.utimes(profile, staleTime, staleTime);
    const preview = await runTemporaryDirectoryMaintenance({ name: 'rendererTemp', root, mode: 'dry-run', now: NOW });
    expect(preview.candidates.map((row: any) => row.path)).toContain(profile);
    await expect(fs.access(cache)).resolves.toBeUndefined();
    const applied = await runTemporaryDirectoryMaintenance({ name: 'rendererTemp', root, mode: 'apply', now: NOW });
    expect(applied.deleted).toBe(1);
    await expect(fs.access(profile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('proposes paired Match PNG, JPG, and HTML cleanup only for a renderer-owned output path', async () => {
    const root = await tempRoot();
    const output = path.join(root, 'render/output/55_sel_uuid.png');
    const jpg = path.join(root, 'render/output/55_sel_uuid.jpg');
    const html = path.join(root, 'render/rendered/55_sel_uuid.html');
    for (const file of [output, jpg, html]) await fs.writeFile(file, 'test-only');
    const preview = await cleanupDeliveredMatchArtifacts(output, { root, mode: 'dry-run' });
    expect(preview.candidates.sort()).toEqual([jpg, output].sort());
    expect((await cleanupMatchHtmlAfterRender(output, { root, mode: 'dry-run' })).candidates).toEqual([html]);
    for (const file of [output, jpg, html]) await expect(fs.access(file)).resolves.toBeUndefined();
    expect(await cleanupDeliveredMatchArtifacts(path.join(root, 'secrets', 'outside.png'), { root, mode: 'apply' })).toMatchObject({ deleted: 0 });
    const applied = await cleanupDeliveredMatchArtifacts(output, { root, mode: 'apply' });
    expect(applied.deleted).toBe(2);
    expect((await cleanupMatchHtmlAfterRender(output, { root, mode: 'apply' })).deleted).toBe(1);
    expect(storageMaintenanceInternals.selectionFromRenderName('55_sel_live_uuid.png')).toEqual({ selectionId: 'sel', live: true });
  });

  it('retains incomplete, uncertain, and stale News delivery states while preserving cursors on safe expiration', () => {
    expect(storageMaintenanceInternals.clearableNewsPending({ stage: 'sending', ts: NOW - TEMP_RETENTION_MS - 1 }, NOW)).toBe(false);
    expect(storageMaintenanceInternals.clearableNewsPending({ stage: 'rendering', requestId: 9, ts: NOW - TEMP_RETENTION_MS - 1 }, NOW, 8)).toBe(false);
    expect(storageMaintenanceInternals.clearableNewsPending({ stage: 'rendering', requestId: 9, ts: NOW - TEMP_RETENTION_MS - 1 }, NOW, 9)).toBe(true);
    expect(storageMaintenanceInternals.clearableNewsPending({ stage: 'collecting', ts: NOW - TEMP_RETENTION_MS - 1, lastAppliedUpdateId: 9 }, NOW)).toBe(true);
    expect(storageMaintenanceInternals.keepNewsDedupMarker({ lastAppliedUpdateId: 9 })).toEqual({ lastAppliedUpdateId: 9 });
  });
});
