import path from 'node:path';
import {createHash} from 'node:crypto';
import * as files from 'node:fs/promises';

const ROOT = path.resolve('storage/backgrounds');
const key = p => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
// Uploads/downloads are flat files. Never follow a database path into a subdirectory or outside this root.
function confined(p) {
  if (typeof p !== 'string' || !p || p.includes('\0')) return null;
  const resolved = path.resolve(p);
  const name = path.basename(resolved);
  if (/[. ]$/.test(name) || name.includes('~') || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) return null;
  return key(path.dirname(resolved)) === key(ROOT) && !/[:\\]/.test(path.basename(resolved)) ? resolved : null;
}

export async function withBackgroundFile(db, file, work) {
  const resolved = confined(file);
  if (!resolved) throw new Error('Invalid background file path');
  const lock = createHash('sha256').update('final-whistle-background:' + key(resolved)).digest().readBigInt64BE();
  return db.$transaction(async tx => {
    // Same database/file lock in the bot and worker; held until commit or rollback. No schema objects are created.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${lock})`;
    return work(tx, resolved);
  }, {isolationLevel:'ReadCommitted'});
}

export async function assignPendingBackground(db, userId, file, fixtureId) {
  return withBackgroundFile(db, file, async (tx, resolved) => {
    // Conditional consumption also serializes concurrent callbacks and avoids overwriting a newer upload.
    const consumed = await tx.user.updateMany({where:{id:userId,pendingBackgroundPath:file},data:{pendingBackgroundPath:null}});
    if (!consumed.count) return {count:0};
    // Replacing a background never resets status, attempts or delivery receipts, including after FT.
    return tx.selection.updateMany({where:{userId,status:{not:'DESELECTED'},...(fixtureId === 'all' ? {} : {fixtureId})},data:{backgroundPath:resolved}});
  });
}

export async function deleteUnusedBackground(db, file, io = files) {
  const resolved = confined(file);
  if (!resolved) return false;
  return withBackgroundFile(db, resolved, async tx => {
    // Normalize existing path spellings as well as new canonical paths. Include pending and page backgrounds.
    for (const [model, field] of [['selection','backgroundPath'],['user','pendingBackgroundPath'],['brand','backgroundPath']]) {
      const refs = await tx[model].findMany({where:{[field]:{not:null}},select:{[field]:true}});
      if (refs.some(row => typeof row[field] === 'string' && key(row[field]) === key(resolved))) return false;
    }
    try {
      const [root, actual, stat] = await Promise.all([io.realpath(ROOT),io.realpath(resolved),io.lstat(resolved)]);
      if (!stat.isFile() || stat.isSymbolicLink() || key(actual) !== key(path.join(root,path.basename(resolved)))) return false;
      await io.unlink(resolved);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error; // retain the file on inspection/deletion failure
    }
  });
}
