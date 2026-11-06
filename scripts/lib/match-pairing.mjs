import {createHash,randomBytes} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const validId=value=>typeof value==='string'&&/^[1-9][0-9]{0,15}$/.test(value)&&Number.isSafeInteger(Number(value));
const validCode=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
export function privateMatchIdentity(message){
 if(message?.chat?.type!=='private'||message.from?.is_bot||!Number.isSafeInteger(message.from?.id)||!Number.isSafeInteger(message.chat.id)||message.from.id!==message.chat.id||message.from.id<=0)return null;
 return {telegramUserId:String(message.from.id),chatId:String(message.chat.id)};
}
export async function lockMatchAccount(tx,userId){
 const rows=await tx.$queryRaw`SELECT "id" FROM "public"."User" WHERE "id" = ${userId} FOR UPDATE`;
 return rows.length===1;
}
function matchesConnection(user,scope){return Boolean(user?.botToken&&user.botId&&(!scope?.botId||scope.botId===user.botId)&&(!scope?.connectionToken||scope.connectionToken===user.botToken));}
export async function approvedMatchUser(db,userId,scope={}){
 const user=await db.user.findUnique({where:{id:userId}});
 if(!matchesConnection(user,scope))return null;
 const binding=await db.matchTelegramBinding.findUnique({where:{userId}});
 if(!binding||binding.botId!==user.botId||!validId(binding.chatId)||binding.chatId!==binding.telegramUserId)return null;
 if(scope.identity&&(scope.identity.chatId!==binding.chatId||scope.identity.telegramUserId!==binding.telegramUserId))return null;
 return {...user,telegramChatId:binding.chatId};
}
export async function issueMatchChallenge(db,scope,identity,clock=Date.now){
 if(!scope.botId||!scope.connectionToken||!identity||!validId(identity.chatId)||identity.chatId!==identity.telegramUserId)return null;
 return db.$transaction(async tx=>{
  if(!await lockMatchAccount(tx,scope.ownerId))return null;
  const user=await tx.user.findUnique({where:{id:scope.ownerId}});
  if(!matchesConnection(user,scope)||await tx.matchTelegramBinding.findUnique({where:{userId:user.id}}))return null;
  const now=new Date(clock());
  await tx.matchPairingChallenge.deleteMany({where:{userId:user.id,expiresAt:{lte:now}}});
  const previous=await tx.matchPairingChallenge.findFirst({where:{userId:user.id,botId:user.botId,telegramUserId:identity.telegramUserId}});
  if(previous&&now.getTime()-previous.createdAt.getTime()<30000)return null;
  if(!previous&&await tx.matchPairingChallenge.count({where:{userId:user.id}})>=50)return null;
  const code=randomBytes(32).toString('base64url'),expiresAt=new Date(clock()+10*60000);
  await tx.matchPairingChallenge.deleteMany({where:{userId:user.id,botId:user.botId,telegramUserId:identity.telegramUserId}});
  await tx.matchPairingChallenge.create({data:{userId:user.id,botId:user.botId,connectionHash:hash(user.botToken),...identity,codeHash:hash(code),expiresAt}});
  return {code,expiresAt};
 });
}
async function checkedChallenge(db,userId,code,clock){
 if(!validCode(code))return null;
 const user=await db.user.findUnique({where:{id:userId}});
 if(!matchesConnection(user))return null;
 const challenge=await db.matchPairingChallenge.findUnique({where:{codeHash:hash(code)}});
 if(!challenge||challenge.userId!==userId||challenge.botId!==user.botId||challenge.connectionHash!==hash(user.botToken)||challenge.expiresAt.getTime()<=clock()||!validId(challenge.chatId)||challenge.chatId!==challenge.telegramUserId)return null;
 return {user,challenge};
}
export async function reviewMatchChallenge(db,userId,code,clock=Date.now){
 const checked=await checkedChallenge(db,userId,code,clock);
 if(!checked)return null;
 return {telegramUserId:checked.challenge.telegramUserId,chatId:checked.challenge.chatId,botUsername:checked.user.botUsername,expiresAt:checked.challenge.expiresAt.toISOString()};
}
// userId must come from requireUser(), never from a submitted form or Telegram update.
export async function confirmMatchChallenge(db,userId,code,clock=Date.now){
 if(!validCode(code))return false;
 try{return await db.$transaction(async tx=>{
  if(!await lockMatchAccount(tx,userId))return false;
  const checked=await checkedChallenge(tx,userId,code,clock);
  if(!checked||await tx.matchTelegramBinding.findUnique({where:{userId}}))return false;
  const {user,challenge}=checked;
  const claimed=await tx.matchPairingChallenge.deleteMany({where:{id:challenge.id,userId,codeHash:hash(code),expiresAt:{gt:new Date(clock())}}});
  if(claimed.count!==1)return false;
  await tx.matchTelegramBinding.create({data:{userId,botId:user.botId,telegramUserId:challenge.telegramUserId,chatId:challenge.chatId}});
  await tx.user.update({where:{id:userId},data:{telegramChatId:challenge.chatId,telegramLinkedAt:new Date(clock()),pendingBackgroundPath:null}});
  await tx.matchPairingChallenge.deleteMany({where:{userId}});
  return true;
 });}catch(error){if(error?.code==='P2002')return false;throw error;}
}
export function createMatchAccessHandler({prisma,onAuthorized,clock=Date.now}){
 return async function handle(ctx,update){
  if(!ctx.botId||!ctx.connectionToken)return;
  const cb=update.callback_query,msg=cb?{chat:cb.message?.chat,from:cb.from}:update.message;
  const identity=privateMatchIdentity(msg);
  if(!identity)return;
  const scope={ownerId:ctx.ownerId,botId:ctx.botId,connectionToken:ctx.connectionToken,identity};
  const user=await approvedMatchUser(prisma,ctx.ownerId,scope);
  if(user)return onAuthorized(ctx,update,user);
  if(cb){await ctx.tg.api('answerCallbackQuery',{callback_query_id:cb.id,text:'Confirm pairing on your Match dashboard first.'});return;}
  if(/^\/start(?:@\w+)?(?:\s+\S+)?$/i.test(String(msg.text??'').trim())){
   const challenge=await issueMatchChallenge(prisma,scope,identity,clock);
   if(challenge){await ctx.tg.sendMessage(identity.chatId,'Match pairing code (valid for 10 minutes):\n'+challenge.code+'\n\nSign in to your Final Whistle Match dashboard, enter this code and explicitly confirm your Telegram identity. Do not share the code.');return;}
  }
  await ctx.tg.sendMessage(identity.chatId,'This bot is private. Send /start to request a pairing code, then confirm it on your authenticated Match dashboard. If already requested, wait 30 seconds before requesting another code.');
 };
}
