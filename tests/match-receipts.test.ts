import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { classifySelectionForReceipt, archiveOldMatchSelections, createMatchReceiptLease, expireMatchDeliveryReceipts, MATCH_RECEIPT_RETENTION_MS } from '../scripts/lib/match-receipts.mjs';
import { toggleSelection } from '../scripts/lib/selection.mjs';

const NOW = Date.UTC(2026, 10, 28);
const oldMatch = { fixtureId: 7, kickoff: new Date(NOW - 60 * 60 * 1000), liveCheckpointAt: null };
function receiptSelection(userId = 'u1', extra: Record<string, unknown> = {}) {
  return {
    id: `selection-${userId}`, userId, fixtureId: 7, status: 'COMPLETED', sentAt: new Date(NOW - 50_000),
    finalDispatchAt: new Date(NOW - 50_000), liveStatus: 'SENT', liveSentAt: new Date(NOW - 60_000),
    liveDispatchAt: new Date(NOW - 60_000), selectedAt: new Date(NOW - 2 * 60 * 60 * 1000), ...extra,
  };
}

describe('Match delivery receipt retention', () => {
  it('fails closed on a lost manual lock or disconnected PostgreSQL lease',async()=>{
    const listeners:Record<string,()=>void>={},client={on:(event:string,fn:()=>void)=>{listeners[event]=fn;},connect:vi.fn(async()=>{}),end:vi.fn(async()=>{}),query:vi.fn(async()=>({rows:[{locked:true}]}))};
    const lease=await createMatchReceiptLease({matchDeliveryReceipt:{count:async()=>0}},()=>client);
    await lease!.acquire(7);await lease!.assertHeld(7);listeners.error();
    await expect(lease!.assertHeld(7)).rejects.toMatchObject({deliveryNotAttempted:true});await expect(lease!.acquire(8)).rejects.toThrow('lease');await lease!.close();
    const second=await createMatchReceiptLease({matchDeliveryReceipt:{count:async()=>0}},()=>client);
    await second!.acquire(7);client.query.mockResolvedValueOnce({rows:[{locked:false}]});
    await expect(second!.assertHeld(7)).rejects.toMatchObject({deliveryNotAttempted:true});await second!.close();
  });
  it('uses a 30-day receipt window for the 24-hour retry and 48-hour Match lifecycle', () => {
    expect(MATCH_RECEIPT_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
  it('archives only terminal, fully resolved delivery states', () => {
    const sent = receiptSelection();
    expect(classifySelectionForReceipt(sent, oldMatch)).toBe('receipt');
    expect(classifySelectionForReceipt({ ...sent, status: 'SELECTED' }, oldMatch)).toBe('retain');
    expect(classifySelectionForReceipt({ ...sent, status: 'FAILED', finalDispatchAt: new Date() }, oldMatch)).toBe('retain');
    expect(classifySelectionForReceipt({ ...sent, liveStatus: 'UNCERTAIN' }, oldMatch)).toBe('retain');
    expect(classifySelectionForReceipt({ ...sent, status: 'COMPLETED', liveStatus: 'PENDING', liveSentAt: null, liveDispatchAt: null, selectedAt: new Date(NOW - 4 * 60 * 60 * 1000) }, { ...oldMatch, liveCheckpointAt: new Date(NOW - 3 * 60 * 60 * 1000) })).toBe('retain');
    expect(classifySelectionForReceipt({ ...sent, status: 'FAILED', finalDispatchAt: null, liveStatus: 'FAILED', liveDispatchAt: null }, oldMatch)).toBe('delete');
  });

  it('copies two users receipts and deletes source rows only after verification in one transaction', async () => {
    const selections = [receiptSelection('owner'), receiptSelection('delegate')];
    const receipts = new Map<string, any>();
    const order: string[] = [];
    const tx = {
      $queryRaw: vi.fn(async (query: TemplateStringsArray) => { order.push('lock'); return String(query).includes('pg_try_advisory_xact_lock') ? [{ locked: true }] : [{ fixtureId: 7 }]; }),
      match: { findUnique: vi.fn(async () => oldMatch), deleteMany: vi.fn(async () => ({ count: 1 })) },
      selection: {
        findMany: vi.fn(async () => selections),
        deleteMany: vi.fn(async ({ where }: any) => { order.push('delete-selections'); return { count: where.id.in.length }; }),
        count: vi.fn(async () => 0),
      },
      matchDeliveryReceipt: {
        upsert: vi.fn(async ({ where, create }: any) => { order.push('receipt'); receipts.set(`${where.userId_fixtureId.userId}:${where.userId_fixtureId.fixtureId}`, create); return create; }),
        findMany: vi.fn(async () => [...receipts.values()].map(({ userId, fixtureId }) => ({ userId, fixtureId }))),
      },
    };
    const prisma = {
      matchDeliveryReceipt: { count: vi.fn(async () => 0) },
      $transaction: (work: (value: any) => Promise<any>) => work(tx),
    };
    const result = await archiveOldMatchSelections(prisma, 7, new Date(NOW), NOW);
    expect(result).toMatchObject({ archived: 2, deletedSelections: 2, deletedMatch: 1, retained: false });
    expect(order[0]).toBe('lock');
    expect(order.indexOf('receipt')).toBeLessThan(order.indexOf('delete-selections'));
    expect(receipts.size).toBe(2);
    expect([...receipts.values()][0].expiresAt.getTime()).toBe(NOW + 30 * 24 * 60 * 60 * 1000);
  });

  it('retains a Match while a manual-render advisory lease is active', async () => {
    const tx = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ fixtureId: 7 }])
        .mockResolvedValueOnce([{ locked: false }]),
      match: { findUnique: vi.fn(), deleteMany: vi.fn() },
      selection: { findMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
      matchDeliveryReceipt: { upsert: vi.fn(), findMany: vi.fn() },
    };
    const prisma: any = {
      matchDeliveryReceipt: { count: vi.fn(async () => 0) },
      $transaction: (work: (value: any) => Promise<any>) => work(tx),
    };
    const result = await archiveOldMatchSelections(prisma, 7, new Date(NOW), NOW);
    expect(result).toMatchObject({ retained: true, manualActive: true, deletedMatch: 0 });
    expect(tx.selection.findMany).not.toHaveBeenCalled();
  });

  it('acquires and releases one session lease for manual generation', async () => {
    const client = { connect: vi.fn(async () => {}), end: vi.fn(async () => {}), query: vi.fn(async () => ({ rows: [{ locked: true }] })) };
    const prisma = { matchDeliveryReceipt: { count: vi.fn(async () => 0) } };
    const lease = await createMatchReceiptLease(prisma, () => client);
    expect(lease).not.toBeNull();
    const release = await lease!.acquire(7);
    expect(release).toBeTypeOf('function');
    await release!(); await lease!.close();
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query).toHaveBeenNthCalledWith(1,'SELECT pg_try_advisory_lock_shared($1, $2) AS locked',expect.any(Array));
    expect(client.query).toHaveBeenNthCalledWith(2,'SELECT pg_advisory_unlock_shared($1, $2)',expect.any(Array));
    expect(client.query).toHaveBeenNthCalledWith(1,'SELECT pg_try_advisory_lock_shared($1, $2) AS locked',expect.any(Array));
    expect(client.query).toHaveBeenNthCalledWith(2,'SELECT pg_advisory_unlock_shared($1, $2)',expect.any(Array));
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('blocks reselection during the 30-day receipt window and allows it after expiry', async () => {
    const receipt = { userId: 'u1', fixtureId: 7, finalStatus: 'COMPLETED', liveStatus: 'SENT', expiresAt: new Date(NOW + 1000) };
    const prisma: any = {
      matchDeliveryReceipt: { count: vi.fn(async () => 1), findUnique: vi.fn(async () => receipt) },
      match: { findUnique: vi.fn(async () => oldMatch) },
      selection: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({})) },
    };
    expect(await toggleSelection({ prisma, userId: 'u1', fixtureId: 7, maxAgeHours: 24, now: NOW })).toEqual({ result: 'already-sent' });
    expect(prisma.selection.create).not.toHaveBeenCalled();
    prisma.matchDeliveryReceipt.findUnique.mockResolvedValueOnce({ ...receipt, expiresAt: new Date(NOW - 1) });
    expect(await toggleSelection({ prisma, userId: 'u1', fixtureId: 7, maxAgeHours: 24, now: NOW })).toEqual({ result: 'selected' });
    expect(prisma.selection.create).toHaveBeenCalledOnce();
  });

  it('expires only settled receipt rows after their retention deadline', async () => {
    const receipt = { userId: 'u1', fixtureId: 7 };
    const delegate = {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => [receipt]),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    };
    const result = await expireMatchDeliveryReceipts({ matchDeliveryReceipt: delegate }, NOW);
    expect(result.deleted).toBe(1);
    const where = (delegate.deleteMany.mock.calls[0] as any)[0].where;
    expect(where.expiresAt.lte).toEqual(new Date(NOW));
    expect(where.AND).toEqual(expect.arrayContaining([
      { OR: [{ finalDispatchAt: null }, { finalStatus: 'COMPLETED' }] },
      { OR: [{ liveDispatchAt: null }, { liveStatus: 'SENT' }] },
    ]));
  });

  it('keeps the SQL migration additive and avoids Match or Selection foreign keys', async () => {
    const sql = await readFile(new URL('../prisma/match-delivery-receipts.sql', import.meta.url), 'utf8');
    expect(sql).toContain('CREATE TABLE "public"."MatchDeliveryReceipt"');
    expect(sql).toContain('PRIMARY KEY ("userId", "fixtureId")');
    expect(sql).toContain('"expiresAt"');
    expect(sql).toContain('REFERENCES "public"."User"');
    expect(sql).not.toMatch(/\b(DROP\s+TABLE|DELETE\s+FROM|TRUNCATE)\b/i);
    expect(sql).not.toContain('REFERENCES "public"."Match"');
    expect(sql).not.toContain('REFERENCES "public"."Selection"');
  });
});
