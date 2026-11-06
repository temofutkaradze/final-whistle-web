import type {Prisma,PrismaClient} from '@prisma/client';
type Db=Pick<PrismaClient,'$transaction'>;
// Both generators must take the same bot-ID lock before checking either table or writing a binding.
export async function registerBot(db:Db,userId:string,botId:string,kind:'match'|'news',save:(tx:Prisma.TransactionClient)=>Promise<unknown>):Promise<boolean>{
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'fw-bot-registration:'+botId},0))`;
  const match=await tx.user.findFirst({where:{botId,...(kind==='match'?{NOT:{id:userId}}:{})},select:{id:true}});
  const news=await tx.newsSettings.findFirst({where:{botId,...(kind==='news'?{NOT:{userId}}:{})},select:{userId:true}});
  if(match||news)return false;
  await save(tx);return true;
 },{isolationLevel:'ReadCommitted'});
}
export async function createWithinTemplateQuota<T>(db:Db,userId:string,kind:'match'|'news',limit:number,save:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T|null>{
 return db.$transaction(async tx=>{
  const owner=await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "public"."User" WHERE "id"=${userId} FOR UPDATE`;
  if(!owner.length)throw new Error('Account unavailable');
  const count=kind==='match'?await tx.template.count({where:{userId}}):await tx.newsTemplate.count({where:{userId}});
  if(count>=limit)return null;
  return save(tx);
 },{isolationLevel:'ReadCommitted'});
}
