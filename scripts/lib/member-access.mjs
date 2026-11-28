import {authorizationDatabase} from './member-context.mjs';
// Delegates never persist the owner's token. Every check reads current permissions.
export const validTelegramId = value => typeof value === 'string' && /^[1-9][0-9]{0,15}$/.test(value) && Number.isSafeInteger(Number(value));
export const approvalMessage = id => `Your Telegram User ID: ${id}\nAdministrator approval is required to use this generator.`;
export async function memberRecord(db, where) {
  db=authorizationDatabase(db);
  if (!db.telegramMember) return null;
  try { return await db.telegramMember.findUnique({where}); }
  catch (error) { if (error?.code === 'P2021') return null; throw error; }
}
export async function memberAccess(db, member, generator, scope = {}) {
  db=authorizationDatabase(db);
  if (!member || member.status !== 'ACTIVE' || !member[generator + 'Access'] || !validTelegramId(member.telegramUserId) || member.ownerId === member.principalId) return null;
  if (scope.memberVersion !== undefined && member.version !== scope.memberVersion) return null;
  if (scope.identity && (scope.identity.chatId !== member.telegramUserId || scope.identity.telegramUserId !== member.telegramUserId)) return null;
  const owner = generator === 'match'
    ? await db.user.findUnique({where:{id:member.ownerId}})
    : await db.newsSettings.findUnique({where:{userId:member.ownerId}});
  if (!owner?.botId || !owner.botToken || (scope.botId && owner.botId !== scope.botId) || (scope.connectionToken && owner.botToken !== scope.connectionToken)) return null;
  return {member, owner};
}
export async function approvedMemberMatchUser(db, user, scope) {
  const access = await memberAccess(db, await memberRecord(db,{principalId:user.id}), 'match', scope);
  return access ? {...user, botId:access.owner.botId, botToken:access.owner.botToken, telegramChatId:access.member.telegramUserId, accessVersion:access.member.version} : null;
}
export async function resolveMatchMember(db, ownerId, identity, scope) {
  const member = await memberRecord(db,{ownerId_telegramUserId:{ownerId,telegramUserId:identity.telegramUserId}});
  const access = await memberAccess(db,member,'match',{...scope,identity});
  if (!access) return null;
  const user = await db.user.findUnique({where:{id:member.principalId}});
  return user ? {...user, botId:access.owner.botId, botToken:access.owner.botToken, telegramChatId:member.telegramUserId, accessVersion:member.version} : null;
}
export function createMemberAdmission(now = Date.now) {
  const keys = new Map(); let active = 0;
  return key => {
    const time = now();
    for (const [id,item] of keys) if (!item.active && item.until <= time) keys.delete(id);
    let item = keys.get(key);
    if (active >= 2 || item?.active || (item && item.count >= 20) || (!item && keys.size >= 512)) return null;
    if (!item) {item={until:time+60_000,count:0,active:false};keys.set(key,item);}
    item.count++; item.active=true; active++;
    let released=false;
    return () => {if (!released) {released=true;item.active=false;active--;}};
  };
}
