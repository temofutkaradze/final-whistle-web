import {memberRecord,memberAccess} from './member-access.mjs';
import {registerMemberContext} from './member-context.mjs';

// Permission updates and delegated writes serialize on the existing owner account lock.
// This prevents an upload/callback from recreating work after revocation clears it.
export function createMemberDatabase(db,{member,generator,scope,lock}) {
  const check=async database=>{
    const current=await memberRecord(database,{principalId:member.principalId});
    if(!await memberAccess(database,current,generator,{...scope,memberVersion:member.version}))throw Object.assign(new Error('Access revoked'),{code:'TELEGRAM_ACCESS_REVOKED'});
  };
  const transaction=work=>db.$transaction(async tx=>{if(!await lock(tx,member.ownerId))throw Error('Owner unavailable');await check(tx);return work(tx);});
  const writes=new Set(['create','createMany','update','updateMany','upsert','delete','deleteMany']);
  const owned=new Set(['selection','brand','subscription','favoriteTeam','template','newsTemplate','newsSettings','matchDeliveryReceipt']);
  function scopedWrite(model,operation,args){
    if(model==='matchDeliveryReceipt')throw Error('Delivery receipts are read-only for delegated users');
    if(model==='user'){
      if(!['update','updateMany'].includes(operation)||args.where?.id!==member.principalId)throw Error('Wrong account owner');
      const allowed=new Set(['pendingBackgroundPath']);
      if(Object.keys(args.data??{}).some(key=>!allowed.has(key)))throw Error('Protected account fields');
      return args;
    }
    if(!owned.has(model))throw Error('Protected database model');
    if(['create','createMany','upsert'].includes(operation)){
      if(operation!=='create'||args.data?.userId!==member.principalId)throw Error('Wrong job owner');
      return args;
    }
    if(args.where?.userId!==undefined&&args.where.userId!==member.principalId)throw Error('Wrong job owner');
    if(args.data?.userId!==undefined&&args.data.userId!==member.principalId)throw Error('Wrong job owner');
    return {...args,where:{...args.where,userId:member.principalId}};
  }
  const reads=new Set(['findUnique','findUniqueOrThrow','findFirst','findFirstOrThrow','findMany','count','aggregate','groupBy']);
  const shared=new Set(['match','team']);
  const relations=new Set(['user','match','owner','principal','brands','subscriptions','selections','favoriteTeams','sessions','templates','newsSettings','newsTemplates','authIdentities','matchPairingChallenges','matchTelegramBinding','matchDeliveryReceipts','telegramMembers','telegramMembership','_count']);
  function scopedRead(model,args={}){
    if(args.select&&Object.entries(args.select).some(([key,value])=>value&&relations.has(key)&&!(model==='selection'&&key==='match'&&value===true)))throw Error('Related private data is unavailable');
    if(shared.has(model)){
      if(args.include||args.select&&Object.values(args.select).some(v=>v&&typeof v==='object'))throw Error('Related private data is unavailable');
      return args;
    }
    if(model!=='user'&&!owned.has(model))throw Error('Protected database model');
    if(args.include&&Object.keys(args.include).some(k=>model!=='selection'||k!=='match'||args.include[k]!==true))throw Error('Related private data is unavailable');
    if(args.select&&Object.values(args.select).some(v=>v&&typeof v==='object'))throw Error('Related private data is unavailable');
    const field=model==='user'?'id':'userId';
    const where=args.where??{};
    if(where[field]!==undefined&&where[field]!==member.principalId)throw Error('Wrong account owner');
    if(where.userId_fixtureId&&where.userId_fixtureId.userId!==member.principalId)throw Error('Wrong job owner');
    return {...args,where:{...where,[field]:member.principalId}};
  }
  function wrap(target,inTransaction=false){
    const cache=new Map();
    const database=new Proxy(target,{get(_target,key){
      if(key==='$transaction')return work=>inTransaction?work(database):transaction(tx=>work(wrap(tx,true)));
      if(key==='matchDeliveryReceipt'&&!target[key])return undefined;
      if(typeof key!=='string'||key.startsWith('$')||!['user',...owned,...shared].includes(key))throw Error('Protected database capability');
      if(!cache.has(key))cache.set(key,new Proxy({}, {get(_model,operation){
        if(!reads.has(operation)&&!writes.has(operation))throw Error('Protected database operation');
        return async args=>{
          if(writes.has(operation)){
            const safe=scopedWrite(key,operation,args);
            if(Object.keys(safe.data??{}).some(k=>['user','owner','principal','match','selections','brands','subscriptions','telegramMembers','authIdentities'].includes(k)))throw Error('Nested private writes are unavailable');
            return inTransaction?(await check(target),target[key][operation](safe)):transaction(tx=>tx[key][operation](safe));
          }
          await check(target);return target[key][operation](scopedRead(key,args));
        };
      }}));
      return cache.get(key);
    }});
    registerMemberContext(database,{authorization:db,background:(key,work)=>transaction(async tx=>{
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${key})`;
      return work(wrap(tx,true));
    })});
    return database;
  }
  const database=wrap(db);
  return {database,check:()=>check(db)};
}

export function guardedTelegram(tg,chatId,check) {
  return new Proxy(tg,{get(target,key){
    const fn=target[key];if(typeof fn!=='function')return fn;
    return async(...args)=>{
      await check();
      if(['sendMessage','sendDocument'].includes(key)&&String(args[0])!==chatId)throw Error('Wrong private recipient');
      if(key==='api'&&args[1]?.chat_id!==undefined&&String(args[1].chat_id)!==chatId)throw Error('Wrong private recipient');
      if(key==='sendDocument'){
        const previous=args[4]?.beforeDispatch;
        args[4]={beforeDispatch:async()=>{await check();await previous?.();}};
      }
      return fn.apply(target,args);
    };
  }});
}
