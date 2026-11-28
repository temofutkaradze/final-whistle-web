import { processLockClient } from './process-lock.mjs';

export const MATCH_RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MATCH_RECEIPT_LOCK_NAMESPACE = 1179996749;

// A separate preflight "no Selection" query is not safe: a new Selection can
// commit before DELETE and be cascaded away. Lock parent rows, then re-read children.
export async function deleteUnselectedOldMatches(prisma,fixtureIds,cutoff){
 if(!fixtureIds.length)return 0;
 return prisma.$transaction(async tx=>{
  const locked=await tx.$queryRaw`SELECT "fixtureId", pg_try_advisory_xact_lock(${MATCH_RECEIPT_LOCK_NAMESPACE}, "fixtureId") AS leased
   FROM "public"."Match" WHERE "fixtureId" IN (SELECT value::integer FROM jsonb_array_elements_text(${JSON.stringify(fixtureIds)}::jsonb))
   AND "kickoff" < ${cutoff} ORDER BY "fixtureId" FOR UPDATE`;
  const ids=locked.filter(row=>row.leased).map(row=>row.fixtureId);
  if(!ids.length)return 0;
  const selected=await tx.selection.findMany({where:{fixtureId:{in:ids}},select:{fixtureId:true}});
  const protectedIds=new Set(selected.map(row=>row.fixtureId)),safe=ids.filter(id=>!protectedIds.has(id));
  if(!safe.length)return 0;
  return (await tx.match.deleteMany({where:{fixtureId:{in:safe},kickoff:{lt:cutoff}}})).count;
 },{isolationLevel:'ReadCommitted'});
}
const unavailableClients = new WeakSet();
const availableClients = new WeakSet();
const missingTable = error => ['P2021', 'P2022', '42P01', '42703'].includes(error?.code);

export async function matchReceiptStorageReady(prisma) {
  if (!prisma || typeof prisma !== 'object' || unavailableClients.has(prisma)) return false;
  if (availableClients.has(prisma)) return true;
  const delegate = prisma.matchDeliveryReceipt;
  if (!delegate || typeof delegate.count !== 'function') return false;
  try {
    await delegate.count({ where: { fixtureId: -1 } });
    availableClients.add(prisma);
    return true;
  } catch (error) {
    if (missingTable(error)) { unavailableClients.add(prisma); return false; }
    throw error;
  }
}

export async function findActiveMatchReceipt(prisma, userId, fixtureId, now = Date.now()) {
  if (!prisma || unavailableClients.has(prisma) || !prisma.matchDeliveryReceipt?.findUnique) return null;
  try {
    const receipt = await prisma.matchDeliveryReceipt.findUnique({
      where: { userId_fixtureId: { userId, fixtureId } },
      select: { userId: true, fixtureId: true, finalStatus: true, liveStatus: true, expiresAt: true },
    });
    return receipt && receipt.expiresAt.getTime() > now ? receipt : null;
  } catch (error) {
    if (missingTable(error)) { unavailableClients.add(prisma); return null; }
    throw error;
  }
}

export function classifySelectionForReceipt(selection, match) {
  if (!selection || !match || ['SELECTED', 'SENDING'].includes(selection.status)) return 'retain';
  if (!['COMPLETED', 'FAILED', 'DESELECTED'].includes(selection.status)) return 'retain';
  if (selection.finalDispatchAt && selection.status !== 'COMPLETED') return 'retain';
  if (['SENDING', 'UNCERTAIN'].includes(selection.liveStatus)) return 'retain';
  if (selection.liveDispatchAt && selection.liveStatus !== 'SENT') return 'retain';
  if (!['PENDING', 'SENT', 'FAILED'].includes(selection.liveStatus)) return 'retain';

  const liveStillDue = selection.status !== 'DESELECTED' && selection.liveStatus === 'PENDING' &&
    match.liveCheckpointAt && (!selection.selectedAt || selection.selectedAt <= match.liveCheckpointAt);
  if (liveStillDue) return 'retain';
  return selection.status === 'COMPLETED' || selection.liveStatus === 'SENT' ? 'receipt' : 'delete';
}

function receiptData(selection, now) {
  return {
    userId: selection.userId,
    fixtureId: selection.fixtureId,
    finalStatus: selection.status,
    finalSentAt: selection.sentAt,
    finalDispatchAt: selection.finalDispatchAt,
    liveStatus: selection.liveStatus,
    liveSentAt: selection.liveSentAt,
    liveDispatchAt: selection.liveDispatchAt,
    expiresAt: new Date(now + MATCH_RECEIPT_RETENTION_MS),
  };
}

export async function archiveOldMatchSelections(prisma, fixtureId, cutoff, now = Date.now()) {
  if (!await matchReceiptStorageReady(prisma) || typeof prisma.$transaction !== 'function') {
    return { archived: 0, deletedSelections: 0, deletedMatch: 0, retained: true, unavailable: true };
  }
  return prisma.$transaction(async tx => {
    // Lock the shared Match row before inspecting selections. A concurrent Selection insert
    // must acquire its FK lock and therefore cannot race the receipt copy/deletion transaction.
    const locked = await tx.$queryRaw`SELECT "fixtureId" FROM "public"."Match" WHERE "fixtureId" = ${fixtureId} AND "kickoff" < ${cutoff} FOR UPDATE`;
    if (!locked.length) return { archived: 0, deletedSelections: 0, deletedMatch: 0, retained: true };
    const lease = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${MATCH_RECEIPT_LOCK_NAMESPACE}, ${fixtureId}) AS locked`;
    if (!lease?.[0]?.locked) return { archived: 0, deletedSelections: 0, deletedMatch: 0, retained: true, manualActive: true };
    // Also serialize status transitions so a worker cannot claim SENDING between
    // classification and deletion of a terminal Selection row.
    await tx.$queryRaw`SELECT "id" FROM "public"."Selection" WHERE "fixtureId" = ${fixtureId} FOR UPDATE`;
    const match = await tx.match.findUnique({ where: { fixtureId }, select: { fixtureId: true, kickoff: true, liveCheckpointAt: true } });
    if (!match || match.kickoff >= cutoff) return { archived: 0, deletedSelections: 0, deletedMatch: 0, retained: true };
    const selections = await tx.selection.findMany({ where: { fixtureId }, select: {
      id: true, userId: true, fixtureId: true, status: true, sentAt: true, finalDispatchAt: true,
      liveStatus: true, liveSentAt: true, liveDispatchAt: true, selectedAt: true,
    } });
    if (!selections.length) {
      const deletedMatch = await tx.match.deleteMany({ where: { fixtureId, kickoff: { lt: cutoff } } });
      return { archived: 0, deletedSelections: 0, deletedMatch: deletedMatch.count, retained: false };
    }

    const archived = [], disposable = [];
    for (const selection of selections) {
      const state = classifySelectionForReceipt(selection, match);
      if (state === 'retain') continue;
      disposable.push(selection);
      if (state === 'receipt') archived.push(selection);
    }
    if (archived.length) {
      for (const selection of archived) {
        const data = receiptData(selection, now);
        await tx.matchDeliveryReceipt.upsert({
          where: { userId_fixtureId: { userId: selection.userId, fixtureId } },
          create: data,
          update: {
            finalStatus: data.finalStatus, finalSentAt: data.finalSentAt, finalDispatchAt: data.finalDispatchAt,
            liveStatus: data.liveStatus, liveSentAt: data.liveSentAt, liveDispatchAt: data.liveDispatchAt, expiresAt: data.expiresAt,
          },
        });
      }
      const verified = await tx.matchDeliveryReceipt.findMany({
        where: { OR: archived.map(row => ({ userId: row.userId, fixtureId })) },
        select: { userId: true, fixtureId: true },
      });
      const verifiedKeys = new Set(verified.map(row => `${row.userId}:${row.fixtureId}`));
      if (archived.some(row => !verifiedKeys.has(`${row.userId}:${fixtureId}`))) throw new Error('Match receipt verification failed; retain source selections.');
    }

    let deletedSelections = 0;
    if (disposable.length) {
      const removed = await tx.selection.deleteMany({ where: { id: { in: disposable.map(row => row.id) }, fixtureId } });
      if (removed.count !== disposable.length) throw new Error('Match selection changed during receipt archival; transaction rolled back.');
      deletedSelections = removed.count;
    }
    const remaining = await tx.selection.count({ where: { fixtureId } });
    const deletedMatch = remaining === 0
      ? (await tx.match.deleteMany({ where: { fixtureId, kickoff: { lt: cutoff } } })).count
      : 0;
    return { archived: archived.length, deletedSelections, deletedMatch, retained: remaining > 0 };
  },{isolationLevel:'ReadCommitted'});
}

export async function createMatchReceiptLease(prisma, clientFactory = processLockClient) {
  if (!await matchReceiptStorageReady(prisma)) return null;
  const client = clientFactory('final-whistle-manual-match-receipt-lease');
  const held = new Set();
  let active=true;
  const lost=()=>{active=false;};
  client.on?.('error',lost);client.on?.('end',lost);
  const failure=()=>Object.assign(Error('Manual delivery lease was lost'),{deliveryNotAttempted:true});
  try { await client.connect(); }
  catch (error) { await client.end().catch(() => {}); throw error; }
  return {
    acquire: async fixtureId => {
      if(!active)throw failure();
      // Concurrent manual renders may share the fixture; archival takes an exclusive lock.
      const result = await client.query('SELECT pg_try_advisory_lock_shared($1, $2) AS locked', [MATCH_RECEIPT_LOCK_NAMESPACE, fixtureId]);
      if(!active)throw failure();
      if (!result.rows[0]?.locked) return null;
      held.add(fixtureId);
      return async () => {
        if (!held.delete(fixtureId)) return;
        await client.query('SELECT pg_advisory_unlock_shared($1, $2)', [MATCH_RECEIPT_LOCK_NAMESPACE, fixtureId]).catch(() => {});
      };
    },
    assertHeld: async fixtureId => {
      if(!active||!held.has(fixtureId))throw failure();
      try{
        const result=await client.query("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype='advisory' AND mode='ShareLock' AND pid=pg_backend_pid() AND classid=$1::oid AND objid=$2::oid AND objsubid=2 AND granted) AS locked",[MATCH_RECEIPT_LOCK_NAMESPACE,fixtureId]);
        if(!active||!result.rows[0]?.locked)throw failure();
      }catch{active=false;throw failure();}
    },
    close: async () => {
      active=false;
      for (const fixtureId of held) await client.query('SELECT pg_advisory_unlock_shared($1, $2)', [MATCH_RECEIPT_LOCK_NAMESPACE, fixtureId]).catch(() => {});
      held.clear();
      await client.end().catch(() => {});
    },
  };
}

const safeExpiredReceiptWhere = cutoff => ({
  expiresAt: { lte: cutoff },
  AND: [
    { OR: [{ finalDispatchAt: null }, { finalStatus: 'COMPLETED' }] },
    { OR: [{ liveDispatchAt: null }, { liveStatus: 'SENT' }] },
  ],
});

export async function listExpiredMatchDeliveryReceipts(prisma, now = Date.now(), limit = 50) {
  if (!await matchReceiptStorageReady(prisma)) return { candidates: [], unavailable: true };
  const cutoff = new Date(now);
  const candidates = await prisma.matchDeliveryReceipt.findMany({
    where: safeExpiredReceiptWhere(cutoff),
    select: { userId: true, fixtureId: true },
    take: Math.min(50, Math.max(1, limit)),
  });
  return { candidates, unavailable: false };
}

export async function deleteExpiredMatchDeliveryReceipts(prisma, candidates, now = Date.now()) {
  if (!candidates?.length || !await matchReceiptStorageReady(prisma)) return 0;
  const deleted = await prisma.matchDeliveryReceipt.deleteMany({ where: {
    ...safeExpiredReceiptWhere(new Date(now)),
    OR: candidates.map(row => ({ userId: row.userId, fixtureId: row.fixtureId })),
  } });
  return deleted.count;
}

export async function expireMatchDeliveryReceipts(prisma, now = Date.now(), limit = 50) {
  const { candidates, unavailable } = await listExpiredMatchDeliveryReceipts(prisma, now, limit);
  const deleted = await deleteExpiredMatchDeliveryReceipts(prisma, candidates, now);
  return { deleted, candidates, unavailable };
}
