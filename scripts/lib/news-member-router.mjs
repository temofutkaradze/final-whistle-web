import {createReplyBudget,runInJob,currentJob} from './job-scheduler.mjs';
import {createNewsHandler} from './news-core.mjs';
import {privateMatchIdentity,lockMatchAccount} from './match-pairing.mjs';
import {memberRecord,memberAccess,approvalMessage,createMemberAdmission} from './member-access.mjs';
import {createMemberDatabase,guardedTelegram} from './member-data.mjs';

// One poller remains attached to the original owner. The cursor is bot-global;
// each delegated principal retains its own durable conversation and update claim.
export function createNewsMemberRouter(deps) {
  const {prisma,tg,ownerId,connectionToken}=deps;
  let ownerClaim=null;
  const ownerSettings={
    findUnique:async args=>{const row=await prisma.newsSettings.findUnique(args);return row?{...row,lastUpdateId:ownerClaim}:null;},
    updateMany:async args=>{
      const {lastUpdateId:expected,OR,...where}=args.where;
      if(expected!==undefined&&expected!==ownerClaim)return {count:0};
      const {lastUpdateId:next,...data}=args.data;
      if(next!==undefined){if(ownerClaim!==null&&next<=ownerClaim)return {count:0};ownerClaim=next;}
      if(!Object.keys(data).length){
        const current=await prisma.newsSettings.findUnique({where:{userId:ownerId}});
        return {count:current?.botToken===where.botToken?1:0};
      }
      return prisma.newsSettings.updateMany({where,data});
    },
  };
  const ownerDb=new Proxy(prisma,{get:(target,key)=>key==='newsSettings'?ownerSettings:target[key]});
  const ownerHandler=createNewsHandler({...deps,prisma:ownerDb}),admit=createMemberAdmission(deps.now),replyAllowed=createReplyBudget(deps.now);
  return async update=>{
    if(!Number.isSafeInteger(update.update_id)||deps.isActive?.()===false)return;
    const owner=await prisma.newsSettings.findUnique({where:{userId:ownerId}});
    if(!owner?.botToken||owner.botToken!==connectionToken)return;
    const identity=privateMatchIdentity(update.message);
    try{
      if(!identity)return;
      if(owner.telegramChatId===identity.chatId||(!owner.telegramChatId&&/^\/start(?:@\w+)?\s+[a-f0-9]{48}$/i.test(update.message.text??'')))return await ownerHandler(update);
      const member=await memberRecord(prisma,{ownerId_telegramUserId:{ownerId,telegramUserId:identity.telegramUserId}});
      const scope={connectionToken,botId:owner.botId,identity,memberVersion:member?.version};
      if(!await memberAccess(prisma,member,'news',scope)){
        if(replyAllowed(identity.telegramUserId))await tg.sendMessage(identity.chatId,approvalMessage(identity.telegramUserId));return;
      }
      const release=admit(member.principalId);if(!release)return;
      try{
        const {database,check}=createMemberDatabase(prisma,{member,generator:'news',scope,lock:lockMatchAccount});
        const settings={
          findUnique:async args=>{await check();const own=await database.newsSettings.findUnique(args);return own?{...own,botToken:connectionToken}:null;},
          updateMany:async args=>{
            const {botToken,...where}=args.where;
            if(botToken!==undefined&&botToken!==connectionToken)return {count:0};
            // The global Telegram cursor is committed after work completes; this claim is transient.
            if(args.data?.lastUpdateId===update.update_id){await check();return {count:1};}
            if(where.lastUpdateId===update.update_id)delete where.lastUpdateId;
            return database.newsSettings.updateMany({...args,where});
          },
        };
        const scoped=new Proxy(database,{get(target,key){return key==='newsSettings'?settings:target[key];}});
        return await runInJob({...currentJob(),key:member.principalId,owner:false},()=>createNewsHandler({...deps,prisma:scoped,ownerId:member.principalId,
          tg:guardedTelegram(tg,identity.chatId,check),download:async id=>{await check();return deps.download(id);}})(update));
      }finally{release();}
    }finally{
      if(!deps.manageCursorExternally)await prisma.newsSettings.updateMany({where:{userId:ownerId,botToken:connectionToken,OR:[{lastUpdateId:null},{lastUpdateId:{lt:update.update_id}}]},data:{lastUpdateId:update.update_id}});
    }
  };
}
