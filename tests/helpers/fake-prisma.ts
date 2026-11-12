// A tiny in-memory stand-in for the Prisma client, just big enough for the worker and the bot logic.
// It understands the query shapes those files really use (equals, not, in, notIn, gt/gte/lt/lte, nested user/match filters,
// include, orderBy/take) and keeps updatedAt like the real @updatedAt does. It can also be told to fail on purpose.

type Row = Record<string, any>;
type Where = Record<string, any>;

export class FakeDbError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

export function createFakeDb(clock: { now: number }) {
  const tables: Record<string, Row[]> = { user: [], brand: [], match: [], selection: [], template: [], fixtureDay: [], apiUsage: [], matchPairingChallenge: [], matchTelegramBinding: [] };
  const failures: { model: string; method: string; when: (args: any) => boolean; times: number; error: Error }[] = [];
  const calls: Record<string, number> = {};
  let pairingSequence=0;

  const keyOf: Record<string, string> = { user: "id", brand: "id", match: "fixtureId", selection: "id", template: "id", fixtureDay: "date", apiUsage: "day", matchPairingChallenge: "id", matchTelegramBinding: "userId" };
  const time = (v: unknown) => (v instanceof Date ? v.getTime() : v);

  function related(model: string, row: Row, key: string): Row | undefined {
    if (model === "selection" && key === "user") return tables.user.find((u) => u.id === row.userId);
    if (model === "selection" && key === "match") return tables.match.find((m) => m.fixtureId === row.fixtureId);
    return undefined;
  }

  function matches(model: string, row: Row, where: Where = {}): boolean {
    for (const [key, cond] of Object.entries(where)) {
      if (key === "AND") {
        if (!(cond as Where[]).every((w) => matches(model, row, w))) return false;
        continue;
      }
      if (key === "OR") {
        if (!(cond as Where[]).some((w) => matches(model, row, w))) return false;
        continue;
      }
      const isOps = cond !== null && typeof cond === "object" && !(cond instanceof Date);
      if (!isOps) {
        if (time(row[key] ?? null) !== time(cond)) return false;
        continue;
      }
      const rel = related(model, row, key);
      if (rel !== undefined || (model === "selection" && (key === "user" || key === "match"))) {
        if (!rel || !matches(key, rel, cond as Where)) return false;
        continue;
      }
      const v = time(row[key] ?? null) as any;
      const c = cond as Row;
      if ("equals" in c && v !== time(c.equals)) return false;
      if ("not" in c && v === time(c.not)) return false;
      if ("in" in c && !(c.in as unknown[]).map(time).includes(v)) return false;
      if ("notIn" in c && (c.notIn as unknown[]).map(time).includes(v)) return false;
      if ("gt" in c && !(v > (time(c.gt) as any))) return false;
      if ("gte" in c && !(v >= (time(c.gte) as any))) return false;
      if ("lt" in c && !(v < (time(c.lt) as any))) return false;
      if ("lte" in c && !(v <= (time(c.lte) as any))) return false;
    }
    return true;
  }

  function include(model: string, row: Row, inc: Row | undefined): Row {
    if (!inc) return { ...row };
    const out: Row = { ...row };
    for (const [key, spec] of Object.entries(inc)) {
      if (!spec) continue;
      if (model === "selection" && key === "match") out.match = { ...related(model, row, "match") };
      if (model === "selection" && key === "user") {
        const u = { ...related(model, row, "user") };
        const sub = spec === true ? undefined : (spec as Row).include;
        if (sub?.brands) {
          let b = tables.brand.filter((x) => x.userId === u.id).map((x) => ({ ...x }));
          const ob = sub.brands.orderBy?.createdAt;
          if (ob) b = b.sort((x, y) => (ob === "desc" ? y.createdAt - x.createdAt : x.createdAt - y.createdAt));
          if (sub.brands.take) b = b.slice(0, sub.brands.take);
          u.brands = b;
        }
        out.user = u;
      }
    }
    return out;
  }

  function maybeFail(model: string, method: string, args: any) {
    for (const f of failures) {
      if (f.model === model && f.method === method && f.times > 0 && f.when(args)) {
        f.times--;
        throw f.error;
      }
    }
  }

  function delegate(model: string) {
    const k = keyOf[model];
    const wrap = <T extends (args: any) => any>(method: string, fn: T) =>
      async (args: any) => {
        calls[`${model}.${method}`] = (calls[`${model}.${method}`] ?? 0) + 1;
        maybeFail(model, method, args);
        return fn(args);
      };
    const find = (args: any) => tables[model].filter((r) => matches(model, r, args?.where));
    return {
      findMany: wrap("findMany", (args: any) => {
        let rows = find(args).map((r) => include(model, r, args?.include));
        if (args?.select) rows = rows.map((r) => Object.fromEntries(Object.keys(args.select).map((s) => [s, r[s]])));
        return rows;
      }),
      findFirst: wrap("findFirst", (args: any) => {
        const r = find(args)[0];
        if (!r) return null;
        if (args?.select) return Object.fromEntries(Object.keys(args.select).map((s) => [s, r[s]]));
        return include(model, r, args?.include);
      }),
      findUnique: wrap("findUnique", (args: any) => {
        const flat: Row = {};
        for (const [a, b] of Object.entries(args.where)) {
          if (b && typeof b === "object") Object.assign(flat, b); // compound key such as userId_fixtureId
          else flat[a] = b;
        }
        const r = tables[model].find((x) => Object.entries(flat).every(([a, b]) => x[a] === b));
        return r ? { ...r } : null;
      }),
      count: wrap("count", (args: any) => find(args).length),
      create: wrap("create", (args: any) => {
        const row = { createdAt: new Date(clock.now), updatedAt: new Date(clock.now), ...args.data };
        if (model === "selection" && tables.selection.some((x) => x.userId === row.userId && x.fixtureId === row.fixtureId)) {
          throw new FakeDbError("Unique constraint failed on (userId, fixtureId)", "P2002");
        }
        if (model === "selection" && row.id === undefined) row.id = `sel-${tables.selection.length + 1}-${clock.now}`;
        if (model === "selection") Object.assign(row, { status: "SELECTED", attempts: 0, liveStatus:'PENDING',liveAttempts:0,selectedAt:new Date(clock.now), ...args.data });
        if(model==='matchPairingChallenge'){
          if(tables[model].some(x=>x.codeHash===row.codeHash||(x.userId===row.userId&&x.botId===row.botId&&x.telegramUserId===row.telegramUserId)))throw new FakeDbError('Pairing uniqueness','P2002');
          row.id ??= 'challenge-'+(++pairingSequence);
        }
        if(model==='matchTelegramBinding'&&tables[model].some(x=>x.userId===row.userId||x.botId===row.botId))throw new FakeDbError('Binding uniqueness','P2002');
        tables[model].push(row);
        return { ...row };
      }),
      update: wrap("update", (args: any) => {
        const row = tables[model].find((x) => Object.entries(args.where).every(([a, b]) => x[a] === b));
        if (!row) throw new FakeDbError(`Record to update not found (${model})`, "P2025");
        Object.assign(row, args.data, { updatedAt: new Date(clock.now) });
        return { ...row };
      }),
      updateMany: wrap("updateMany", (args: any) => {
        const rows = find(args);
        for (const r of rows) Object.assign(r, args.data, { updatedAt: new Date(clock.now) });
        return { count: rows.length };
      }),
      deleteMany: wrap("deleteMany", (args: any) => {
        const rows = find(args);
        tables[model] = tables[model].filter((r) => !rows.includes(r));
        if (model === "match") {
          const ids = new Set(rows.map((r) => r.fixtureId));
          tables.selection = tables.selection.filter((s) => !ids.has(s.fixtureId)); // onDelete: Cascade
        }
        return { count: rows.length };
      }),
      delete: wrap("delete", (args: any) => {
        const row = tables[model].find((x) => Object.entries(args.where).every(([a, b]) => x[a] === b));
        if (!row) throw new FakeDbError(`Record to delete not found (${model})`, "P2025");
        tables[model] = tables[model].filter((r) => r !== row);
        return { ...row };
      }),
    };
  }

  const prisma: any = {};
  for (const m of Object.keys(tables)) prisma[m] = delegate(m);
  let transactionQueue=Promise.resolve();
  prisma.$transaction=(callback:any)=>{
    const run=transactionQueue.then(async()=>{
      const snapshot=structuredClone(tables);
      try{return await callback(prisma);}catch(error){for(const key of Object.keys(tables))tables[key]=snapshot[key];throw error;}
    });
    transactionQueue=run.then(()=>{},()=>{});return run;
  };
  prisma.$queryRaw=async(_strings:unknown,...values:unknown[])=>tables.user.filter(u=>u.id===values[0]).map(u=>({id:u.id}));
  void keyOf;

  return {
    prisma,
    tables,
    calls,
    /** Make the next `times` calls of model.method fail (when the predicate on the arguments is true). */
    failNext(model: string, method: string, error: Error, times = 1, when: (args: any) => boolean = () => true) {
      failures.push({ model, method, when, times, error });
    },
    clearFailures() {
      failures.length = 0;
    },
  };
}
