import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLEANUP_AFTER_HOURS } from './config.mjs';
import { deleteExpiredMatchDeliveryReceipts, listExpiredMatchDeliveryReceipts } from './match-receipts.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const TEMP_RETENTION_MS = 24 * 60 * 60 * 1000;
const NEWS_CONVERSATION_IDLE_MS = 60 * 60 * 1000;
const MAX_SCAN_ENTRIES = 256;
const MAX_DELETE_BATCH = 25;
const MAX_DATABASE_BATCH = 50;
const LOCAL_WARNING_BYTES = 5 * 1024 ** 3;
const DEFAULT_DATABASE_WARNING_BYTES = 750 * 1024 ** 2;
const DATA_ROOTS = Object.freeze({
  newsTemp: path.join(PROJECT_ROOT, 'storage', 'news-tmp'),
  rendererTemp: path.join(PROJECT_ROOT, 'storage', 'renderer-tmp'),
  rendered: path.join(PROJECT_ROOT, 'render', 'rendered'),
  output: path.join(PROJECT_ROOT, 'render', 'output'),
});

const comparisonPath = value => process.platform === 'win32' ? value.toLowerCase() : value;
function isInside(root, file) {
  const rel = path.relative(root, file);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
function modeFromEnv() {
  return process.env.FW_STORAGE_MAINTENANCE_MODE === 'apply' ? 'apply' : 'dry-run';
}
function expired(timestamp, now, retentionMs = TEMP_RETENTION_MS) {
  return Number.isFinite(timestamp) && timestamp <= now - retentionMs;
}
function parsePendingAge(pending) {
  const timestamp = pending && typeof pending === 'object' && !Array.isArray(pending) ? Number(pending.ts) : NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}
function clearableNewsPending(pending, now, lastUpdateId) {
  if (!pending || typeof pending !== 'object' || Array.isArray(pending)) return false;
  const stage = typeof pending.stage === 'string' ? pending.stage : '';
  const timestamp = parsePendingAge(pending);
  if (typeof pending.outputPath === 'string' || timestamp === null || !expired(timestamp, now, NEWS_CONVERSATION_IDLE_MS)) return false;
  // A crashed render remains replayable until the durable Telegram update cursor passes it.
  if (stage === 'rendering') return Number.isSafeInteger(pending.requestId) && Number.isSafeInteger(lastUpdateId) && lastUpdateId >= pending.requestId;
  // Sending is an uncertainty fence and is never age-deleted.
  if (stage === 'sending') return false;
  return !stage || ['collecting', 'branding', 'editorial', 'breaking', 'delivered'].includes(stage);
}
function keepNewsDedupMarker(pending) {
  const id = pending && typeof pending === 'object' && !Array.isArray(pending)
    ? pending.lastAppliedUpdateId
    : undefined;
  return Number.isSafeInteger(id) ? { lastAppliedUpdateId: id } : null;
}

async function safeRoot(root) {
  const absolute = path.resolve(root);
  try {
    const info = await fs.lstat(absolute);
    if (!info.isDirectory() || info.isSymbolicLink()) return null;
    const real = await fs.realpath(absolute);
    if (comparisonPath(real) !== comparisonPath(absolute)) return null;
    return { absolute, real };
  } catch { return null; }
}

async function listDirectFiles(root, { now, entriesLeft }) {
  const safe = await safeRoot(root);
  if (!safe) return { files: [], skipped: true };
  let names;
  try { names = (await fs.readdir(safe.real)).sort(); } catch { return { files: [], skipped: true }; }
  const files = [];
  for (const name of names) {
    if (entriesLeft.count >= MAX_SCAN_ENTRIES) break;
    entriesLeft.count++;
    const file = path.join(safe.real, name);
    if (!isInside(safe.real, file)) continue;
    try {
      const info = await fs.lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || !expired(info.mtimeMs, now)) continue;
      const real = await fs.realpath(file);
      if (!isInside(safe.real, real) || comparisonPath(real) !== comparisonPath(file)) continue;
      files.push({ path: file, name, mtimeMs: info.mtimeMs, size: info.size });
    } catch { /* Concurrently removed, locked, or otherwise unreadable files are retained. */ }
  }
  return { files, skipped: false };
}

async function inspectTree(dir, root, now, budget, files = []) {
  if (budget.entries >= MAX_SCAN_ENTRIES || budget.depth > 8) return { safe: false, newest: Infinity, files };
  budget.entries++;
  const full = path.resolve(dir);
  if (!isInside(root, full)) return { safe: false, newest: Infinity, files };
  let info;
  try { info = await fs.lstat(full); } catch { return { safe: false, newest: Infinity, files };
  }
  if (info.isSymbolicLink()) return { safe: false, newest: Infinity, files };
  if (info.isFile()) {
    files.push({ path: full, mtimeMs: info.mtimeMs, size: info.size });
    return { safe: true, newest: info.mtimeMs, files };
  }
  if (!info.isDirectory()) return { safe: false, newest: Infinity, files };
  let names;
  try { names = (await fs.readdir(full)).sort(); } catch { return { safe: false, newest: Infinity, files };
  }
  let newest = info.mtimeMs;
  for (const name of names) {
    budget.depth++;
    const child = await inspectTree(path.join(full, name), root, now, budget, files);
    budget.depth--;
    if (!child.safe) return { safe: false, newest: Infinity, files };
    newest = Math.max(newest, child.newest);
  }
  return { safe: true, newest, files };
}

async function rendererTempCandidates(root, now) {
  const safe = await safeRoot(root);
  if (!safe) return { candidates: [], skipped: true };
  let names;
  try { names = (await fs.readdir(safe.real)).sort(); } catch { return { candidates: [], skipped: true }; }
  const direct = await listDirectFiles(safe.real, { now, entriesLeft: { count: 0 } });
  const candidates = direct.files.map(file => ({ ...file, kind: 'renderer-temp-file', files: [file.path] }));
  let entries = direct.files.length;
  for (const name of names) {
    if (entries >= MAX_SCAN_ENTRIES) break;
    const dir = path.join(safe.real, name);
    try { const info = await fs.lstat(dir); if (!info.isDirectory() || info.isSymbolicLink()) continue; } catch { continue; }
    const info = await inspectTree(dir, safe.real, now, { entries, depth: 0 });
    entries += Math.max(1, info.files.length);
    if (!info.safe || !info.files.length || !expired(info.newest, now)) continue;
    candidates.push({ path: dir, name, mtimeMs: info.newest, size: info.files.reduce((sum, file) => sum + file.size, 0), kind: 'renderer-profile', files: info.files.map(file => file.path) });
  }
  return { candidates, skipped: false };
}

function selectionFromRenderName(name) {
  const pieces = name.replace(/\.(?:png|jpe?g|html)$/i, '').split('_');
  if (pieces.length < 3 || !/^\d+$/.test(pieces[0]) || !/^[A-Za-z0-9-]{1,80}$/.test(pieces[1])) return null;
  return { selectionId: pieces[1], live: pieces[2] === 'live' };
}
function disposition(file, selections, referencedNewsPaths, unknownNewsPending) {
  if (file.name.startsWith('news_') && /\.(?:png|jpe?g)$/i.test(file.name)) {
    if (referencedNewsPaths.has(comparisonPath(path.resolve(file.path))) || unknownNewsPending) return 'protected-news-job';
    return 'expired-news-output';
  }
  const parsed = selectionFromRenderName(file.name);
  if (!parsed) return 'untracked-render-output';
  const selection = selections.get(parsed.selectionId);
  if (!selection) return 'missing-receipt';
  if (parsed.live) {
    if (selection.liveStatus === 'SENT') return 'confirmed-live-delivery';
    if (selection.liveStatus === 'FAILED' && !selection.liveDispatchAt) return 'terminal-live-failure';
    if (selection.status === 'DESELECTED' && !selection.liveDispatchAt) return 'cancelled-live-render';
    return 'live-state-unresolved';
  }
  if (selection.status === 'COMPLETED') return 'confirmed-final-delivery';
  if (selection.status === 'FAILED' && !selection.finalDispatchAt) return 'terminal-final-failure';
  if (selection.status === 'DESELECTED' && !selection.finalDispatchAt) return 'cancelled-final-render';
  return 'final-state-unresolved';
}

async function removeFileCandidate(candidate, allowedRoot, now = Date.now(), requireExpired = true) {
  const safe = await safeRoot(allowedRoot);
  if (!safe) return false;
  const file = path.resolve(candidate.path);
  if (!isInside(safe.real, file)) return false;
  try {
    const info = await fs.lstat(file);
    if (info.isSymbolicLink()) return false;
    if (info.isDirectory()) {
      const tree = await inspectTree(file, safe.real, Date.now(), { entries: 0, depth: 0 });
      if (!tree.safe || !tree.files.length || (requireExpired && !expired(tree.newest, now))) return false;
      await fs.rm(file, { recursive: true, force: false });
      return true;
    }
    if (!info.isFile()) return false;
    if (requireExpired && !expired(info.mtimeMs, now)) return false;
    const real = await fs.realpath(file);
    if (!isInside(safe.real, real) || comparisonPath(real) !== comparisonPath(file)) return false;
    await fs.unlink(file);
    return true;
  } catch { return false; }
}

async function applyDatabaseCandidates(prisma, candidates, now) {
  const result = { sessions: 0, pairingChallenges: 0, newsPending: 0, matchReceipts: 0 };
  if (candidates.sessions.length) {
    const deleted = await prisma.session.deleteMany({ where: { id: { in: candidates.sessions.map(row => row.id) }, expiresAt: { lte: new Date(now) } } });
    result.sessions = deleted.count;
  }
  if (candidates.pairingChallenges.length) {
    const deleted = await prisma.matchPairingChallenge.deleteMany({ where: { id: { in: candidates.pairingChallenges.map(row => row.id) }, expiresAt: { lte: new Date(now) } } });
    result.pairingChallenges = deleted.count;
  }
  for (const row of candidates.newsPending) {
    const updated = await prisma.newsSettings.updateMany({
      where: { userId: row.userId, lastUpdateId: row.lastUpdateId ?? null, pending: { equals: row.pending } },
      data: { pending: keepNewsDedupMarker(row.pending) },
    });
    result.newsPending += updated.count;
  }
  result.matchReceipts = await deleteExpiredMatchDeliveryReceipts(prisma, candidates.matchReceipts, now);
  return result;
}

export async function runStorageMaintenance({
  prisma,
  now = Date.now(),
  mode = modeFromEnv(),
  rendererExclusive = false,
  includeNewsTemp = true,
  root = PROJECT_ROOT,
  log = () => {},
} = {}) {
  if (!prisma) throw new TypeError('A database client is required for storage maintenance.');
  if (!['dry-run', 'apply'].includes(mode)) throw new TypeError('Invalid storage maintenance mode.');
  const timestamp = typeof now === 'function' ? now() : now;
  const safeRoots = Object.fromEntries(Object.entries(DATA_ROOTS).map(([key, value]) => [key, path.join(path.resolve(root), path.relative(PROJECT_ROOT, value))]));
  const dbCandidates = { sessions: [], pairingChallenges: [], newsPending: [], matchReceipts: [], matchRetention: [] };

  // Every query is bounded. Job, deduplication, and credential fields are not selected.
  dbCandidates.sessions = await prisma.session.findMany({ where: { expiresAt: { lte: new Date(timestamp) } }, select: { id: true, expiresAt: true }, take: MAX_DATABASE_BATCH });
  dbCandidates.pairingChallenges = await prisma.matchPairingChallenge.findMany({ where: { expiresAt: { lte: new Date(timestamp) } }, select: { id: true, expiresAt: true }, take: MAX_DATABASE_BATCH });
  const pendingRows = await prisma.newsSettings.findMany({ where: { pending: { not: null } }, select: { userId: true, pending: true, lastUpdateId: true }, take: MAX_DATABASE_BATCH });
  dbCandidates.newsPending = pendingRows.filter(row => clearableNewsPending(row.pending, timestamp, row.lastUpdateId));
  dbCandidates.matchReceipts = (await listExpiredMatchDeliveryReceipts(prisma, timestamp, MAX_DATABASE_BATCH)).candidates;
  const staleMatches = await prisma.match.findMany({
    where: { kickoff: { lt: new Date(timestamp - CLEANUP_AFTER_HOURS * 60 * 60 * 1000) } },
    select: { fixtureId: true, kickoff: true },
    take: MAX_DATABASE_BATCH,
  });
  const staleFixtureIds = staleMatches.map(row => row.fixtureId);
  const matchSelections = staleFixtureIds.length
    ? await prisma.selection.findMany({ where: { fixtureId: { in: staleFixtureIds } }, select: { id: true, fixtureId: true, status: true, liveStatus: true, finalDispatchAt: true, liveDispatchAt: true } })
    : [];
  dbCandidates.matchRetention = staleMatches.map(match => {
    const receipts = matchSelections.filter(row => row.fixtureId === match.fixtureId);
    return { fixtureId: match.fixtureId, kickoff: match.kickoff, action: receipts.length ? 'retain-until-approved-receipt-archive' : 'existing-48-hour-unselected-match-cleanup', selections: receipts };
  });
  const rawPendingNews = pendingRows.filter(row => row.pending && typeof row.pending === 'object' && ['rendering', 'sending'].includes(row.pending.stage));
  const referencedNewsPaths = new Set(rawPendingNews.map(row => row.pending.outputPath).filter(value => typeof value === 'string').map(value => comparisonPath(path.resolve(value))));
  for (const row of pendingRows) if (typeof row.pending?.outputPath === 'string') referencedNewsPaths.add(comparisonPath(path.resolve(row.pending.outputPath)));
  const protectAllNews = rawPendingNews.some(row => !clearableNewsPending(row.pending, timestamp, row.lastUpdateId));

  const entriesLeft = { count: 0 };
  const newsTemp = includeNewsTemp
    ? await listDirectFiles(safeRoots.newsTemp, { now: timestamp, entriesLeft })
    : { files: [], skipped: true };
  const rendered = await listDirectFiles(safeRoots.rendered, { now: timestamp, entriesLeft });
  const output = await listDirectFiles(safeRoots.output, { now: timestamp, entriesLeft });
  const rendererTemp = rendererExclusive
    ? await rendererTempCandidates(safeRoots.rendererTemp, timestamp)
    : { candidates: [], skipped: true };

  const parsedIds = new Set();
  for (const file of [...rendered.files, ...output.files]) {
    const parsed = selectionFromRenderName(file.name);
    if (parsed) parsedIds.add(parsed.selectionId);
  }
  const selections = new Map();
  const ids = [...parsedIds];
  for (let offset = 0; offset < ids.length; offset += MAX_DATABASE_BATCH) {
    const rows = await prisma.selection.findMany({
      where: { id: { in: ids.slice(offset, offset + MAX_DATABASE_BATCH) } },
      select: { id: true, status: true, liveStatus: true, finalDispatchAt: true, liveDispatchAt: true },
    });
    for (const row of rows) selections.set(row.id, row);
  }

  const files = [];
  for (const file of newsTemp.files) files.push({ ...file, root: safeRoots.newsTemp, reason: 'abandoned-news-upload' });
  for (const file of rendered.files) {
    if (/^manual_[A-Za-z0-9_-]+\.html$/i.test(file.name)) {
      files.push({ ...file, root: safeRoots.rendered, reason: 'completed-manual-render-html' });
      continue;
    }
    const status = disposition(file, selections, referencedNewsPaths, protectAllNews);
    if (['confirmed-final-delivery', 'confirmed-live-delivery', 'terminal-final-failure', 'terminal-live-failure', 'cancelled-final-render', 'cancelled-live-render'].includes(status)) files.push({ ...file, root: safeRoots.rendered, reason: status });
  }
  for (const file of output.files) {
    const status = disposition(file, selections, referencedNewsPaths, protectAllNews);
    if (['confirmed-final-delivery', 'confirmed-live-delivery', 'terminal-final-failure', 'terminal-live-failure', 'cancelled-final-render', 'cancelled-live-render', 'expired-news-output'].includes(status)) files.push({ ...file, root: safeRoots.output, reason: status });
  }
  for (const candidate of rendererTemp.candidates) files.push({ ...candidate, root: safeRoots.rendererTemp, reason: 'abandoned-renderer-temp' });

  const fileBatch = mode === 'apply' ? files.slice(0, MAX_DELETE_BATCH) : files;
  let deletedFiles = 0;
  if (mode === 'apply') {
    for (const candidate of fileBatch) if (await removeFileCandidate(candidate, candidate.root, timestamp)) deletedFiles++;
  }
  const deletedRows = mode === 'apply' ? await applyDatabaseCandidates(prisma, dbCandidates, timestamp) : { sessions: 0, pairingChallenges: 0, newsPending: 0, matchReceipts: 0 };
  const report = {
    mode,
    retentionHours: 24,
    database: {
      matchRetention48h: dbCandidates.matchRetention,
      expiredSessions: dbCandidates.sessions.map(({ id, expiresAt }) => ({ id, expiresAt })),
      expiredPairingChallenges: dbCandidates.pairingChallenges.map(({ id, expiresAt }) => ({ id, expiresAt })),
      expiredInactiveNewsConversations: dbCandidates.newsPending.map(({ userId, pending }) => ({ userId, lastAppliedUpdateId: keepNewsDedupMarker(pending)?.lastAppliedUpdateId ?? null })),
      expiredMatchDeliveryReceipts: dbCandidates.matchReceipts,
      deleted: deletedRows,
    },
    files: fileBatch.map(({ path: filePath, reason, size, mtimeMs }) => ({ path: filePath, reason, size, mtime: new Date(mtimeMs).toISOString() })),
    scannedEntries: entriesLeft.count,
    deferredFileCandidates: Math.max(0, files.length - fileBatch.length),
    scanLimitReached: entriesLeft.count >= MAX_SCAN_ENTRIES,
    deletedFiles,
    rendererTempSkipped: rendererTemp.skipped,
  };
  if (mode === 'dry-run') log(`[maintenance dry-run] files=${files.length} sessions=${dbCandidates.sessions.length} challenges=${dbCandidates.pairingChallenges.length} newsStates=${dbCandidates.newsPending.length}`);
  else log(`[maintenance] deleted files=${deletedFiles} sessions=${deletedRows.sessions} challenges=${deletedRows.pairingChallenges} newsStates=${deletedRows.newsPending}`);
  return report;
}

export async function runTemporaryDirectoryMaintenance({
  name,
  mode = modeFromEnv(),
  now = Date.now(),
  root = PROJECT_ROOT,
  log = () => {},
} = {}) {
  if (!['newsTemp', 'rendererTemp'].includes(name)) throw new TypeError('Only approved temporary directories can be maintained.');
  if (!['dry-run', 'apply'].includes(mode)) throw new TypeError('Invalid storage maintenance mode.');
  const timestamp = typeof now === 'function' ? now() : now;
  const directory = path.resolve(root, path.relative(PROJECT_ROOT, DATA_ROOTS[name]));
  const listed = name === 'rendererTemp'
    ? await rendererTempCandidates(directory, timestamp)
    : await listDirectFiles(directory, { now: timestamp, entriesLeft: { count: 0 } });
  const allCandidates = (name === 'rendererTemp' ? listed.candidates : listed.files).map(file => ({
    ...file,
    root: directory,
    reason: name === 'rendererTemp' ? 'abandoned-renderer-temp' : 'abandoned-news-upload',
  }));
  const candidates = mode === 'apply' ? allCandidates.slice(0, MAX_DELETE_BATCH) : allCandidates;
  let deleted = 0;
  if (mode === 'apply') for (const candidate of candidates) if (await removeFileCandidate(candidate, directory, timestamp)) deleted++;
  if (mode === 'dry-run' && candidates.length) log(`[maintenance dry-run] ${name} candidates=${candidates.length}`);
  return { mode, directory: name, candidates: candidates.map(({ path: file, files }) => ({ path: file, files, reason: name === 'rendererTemp' ? 'abandoned-renderer-temp' : 'abandoned-news-upload' })), deleted };
}

export async function cleanupDeliveredMatchArtifacts(imagePath, { mode = modeFromEnv(), root = PROJECT_ROOT, log = () => {} } = {}) {
  if (!['dry-run', 'apply'].includes(mode) || typeof imagePath !== 'string') return { deleted: 0, candidates: [] };
  const outputRoot = path.resolve(root, 'render', 'output');
  const image = path.resolve(imagePath);
  if (comparisonPath(path.dirname(image)) !== comparisonPath(outputRoot) || !isInside(outputRoot, image) || !/^[A-Za-z0-9_-]{1,180}\.(?:png|jpe?g)$/i.test(path.basename(image))) return { deleted: 0, candidates: [] };
  const base = path.basename(image, path.extname(image));
  const candidates = [
    { path: path.join(outputRoot, `${base}.png`), root: outputRoot },
    { path: path.join(outputRoot, `${base}.jpg`), root: outputRoot },
    { path: path.join(outputRoot, `${base}.jpeg`), root: outputRoot },
  ];
  let deleted = 0;
  const existing = [];
  for (const candidate of candidates) {
    try {
      const info = await fs.lstat(candidate.path);
      if (info.isFile() && !info.isSymbolicLink()) existing.push(candidate);
    } catch { /* Missing paired format is expected for PNG-only requests. */ }
  }
  if (mode === 'apply') for (const candidate of existing) if (await removeFileCandidate(candidate, candidate.root, Date.now(), false)) deleted++;
  if (mode === 'dry-run' && existing.length) log(`[maintenance dry-run] confirmed Match delivery cleanup candidates=${existing.length}`);
  return { deleted, candidates: existing.map(({ path: file }) => file) };
}

export async function cleanupMatchHtmlAfterRender(imagePath, { mode = modeFromEnv(), root = PROJECT_ROOT, log = () => {} } = {}) {
  if (!['dry-run', 'apply'].includes(mode) || typeof imagePath !== 'string') return { deleted: 0, candidates: [] };
  const outputRoot = path.resolve(root, 'render', 'output');
  const renderedRoot = path.resolve(root, 'render', 'rendered');
  const image = path.resolve(imagePath);
  if (comparisonPath(path.dirname(image)) !== comparisonPath(outputRoot) || !/^[A-Za-z0-9_-]{1,180}\.(?:png|jpe?g)$/i.test(path.basename(image))) return { deleted: 0, candidates: [] };
  const html = path.join(renderedRoot, `${path.basename(image, path.extname(image))}.html`);
  const candidate = { path: html, root: renderedRoot };
  try { const info = await fs.lstat(html); if (!info.isFile() || info.isSymbolicLink()) return { deleted: 0, candidates: [] }; }
  catch { return { deleted: 0, candidates: [] }; }
  let deleted = 0;
  if (mode === 'apply' && await removeFileCandidate(candidate, renderedRoot, Date.now(), false)) deleted = 1;
  if (mode === 'dry-run') log('[maintenance dry-run] completed Match render HTML cleanup candidate=1');
  return { deleted, candidates: [html] };
}

export async function measureStorageCapacity({ prisma, root = PROJECT_ROOT, warn = console.warn } = {}) {
  let local = null;
  try {
    const stat = await fs.statfs(path.resolve(root, 'storage'));
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    local = { freeBytes, totalBytes: Number(stat.blocks) * Number(stat.bsize) };
    if (freeBytes < LOCAL_WARNING_BYTES) warn(`[storage] Low local disk space; freeMiB=${Math.floor(freeBytes / 1024 ** 2)}`);
  } catch { /* Storage monitoring is advisory and must not block the worker. */ }
  let database = null;
  try {
    const rows = await prisma.$queryRaw`SELECT pg_database_size(current_database())::bigint AS bytes`;
    const bytes = Number(rows?.[0]?.bytes);
    if (Number.isFinite(bytes)) {
      database = { bytes, warningBytes: Number(process.env.FW_DATABASE_WARNING_BYTES) || DEFAULT_DATABASE_WARNING_BYTES };
      if (bytes >= database.warningBytes) warn(`[storage] Database size is above its warning threshold; MiB=${Math.floor(bytes / 1024 ** 2)}`);
    }
  } catch { /* The runtime role or provider may not expose this metric. */ }
  return { local, database };
}

export const storageMaintenanceInternals = Object.freeze({ clearableNewsPending, keepNewsDedupMarker, selectionFromRenderName, disposition, expired, modeFromEnv });
