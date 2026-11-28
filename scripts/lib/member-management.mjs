import {randomUUID} from 'node:crypto';
import {validTelegramId} from './member-access.mjs';
import {lockMatchAccount} from './match-pairing.mjs';

export async function managedOwner(db,ownerId) {
  const owner=await db.user.findUnique({where:{id:ownerId}});
  const news=await db.newsSettings.findUnique({where:{userId:ownerId}});
  if(!owner||(!owner.botToken&&!news?.botToken))throw Error('Owner access required');
  return {owner,news};
}
export async function saveTelegramMember(db,ownerId,input) {
  const telegramUserId=String(input.telegramUserId??'').trim();
  const displayName=String(input.displayName??'').trim();
  if(!validTelegramId(telegramUserId)||displayName.length>80||/[\u0000-\u001f]/.test(displayName))throw Error('Enter a valid Telegram User ID and name of at most 80 characters.');
  if(!['ACTIVE','SUSPENDED','REVOKED'].includes(input.status))throw Error('Invalid authorization status');
  if(typeof input.matchAccess!=='boolean'||typeof input.newsAccess!=='boolean')throw Error('Invalid permissions');
  return db.$transaction(async tx=>{
    if(!await lockMatchAccount(tx,ownerId))throw Error('Owner unavailable');
    const {owner,news}=await managedOwner(tx,ownerId);
    const binding=await tx.matchTelegramBinding.findUnique({where:{userId:ownerId}});
    if(binding?.telegramUserId===telegramUserId||news?.telegramChatId===telegramUserId)throw Error('The owner cannot be added, suspended or revoked.');
    if(input.matchAccess&&!owner.botToken||input.newsAccess&&!news?.botToken)throw Error('Connect the corresponding existing bot first.');
    let member=await tx.telegramMember.findUnique({where:{ownerId_telegramUserId:{ownerId,telegramUserId}}});
    const data={displayName:displayName||null,status:input.status,matchAccess:input.matchAccess,newsAccess:input.newsAccess};
    if(!member){
      if(await tx.telegramMember.count({where:{ownerId}})>=100)throw Error('At most 100 authorized users per owner.');
      const principal=await tx.user.create({data:{email:`${randomUUID()}@telegram.invalid`,name:displayName||null}});
      await tx.brand.create({data:{userId:principal.id,name:(displayName||owner.name||'Final Whistle').slice(0,60)}});
      await tx.newsSettings.create({data:{userId:principal.id,telegramChatId:telegramUserId}});
      member=await tx.telegramMember.create({data:{ownerId,principalId:principal.id,telegramUserId,...data}});
    }else member=await tx.telegramMember.update({where:{id:member.id},data:{...data,version:{increment:1}}});
    // Changes invalidate in-flight delegated operations. Disabling access retires pending work,
    // but retains historical receipts and files; restoration never replays old private jobs.
    if(member.status!=='ACTIVE'||!member.newsAccess)await tx.newsSettings.update({where:{userId:member.principalId},data:{pending:null}});
    if(member.status!=='ACTIVE'||!member.matchAccess){
      await tx.selection.updateMany({where:{userId:member.principalId,status:{in:['SELECTED','SENDING']}},data:{status:'DESELECTED',liveStatus:'FAILED'}});
      await tx.user.update({where:{id:member.principalId},data:{pendingBackgroundPath:null}});
    }
    return {id:member.id};
  });
}
