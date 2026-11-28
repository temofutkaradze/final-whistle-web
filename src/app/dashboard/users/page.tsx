import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import BackToDashboard from '@/app/back-to-dashboard';
import SubmitButton from '@/app/submit-button';
import { managedOwner } from '../../../../scripts/lib/member-management.mjs';
import { saveAccess } from './actions';

export const dynamic = 'force-dynamic';

export default async function UserManagement({searchParams}: {searchParams: Promise<{saved?:string;error?:string}>}) {
  const user = await requireUser();
  try { await managedOwner(prisma, user.id); } catch { redirect('/dashboard'); }
  const params = await searchParams;
  let members;
  try {
    members = await prisma.telegramMember.findMany({where:{ownerId:user.id},orderBy:{createdAt:'asc'},
      select:{id:true,telegramUserId:true,displayName:true,status:true,matchAccess:true,newsAccess:true}});
  } catch (error) {
    if ((error as {code?:string}).code !== 'P2021') throw error;
    return <div className="container dash-page"><BackToDashboard/><h1>User Management</h1><p className="notice">Shared access is not activated. The additive Telegram member migration requires administrator approval first.</p></div>;
  }
  const fields=(member?: (typeof members)[number])=><>
    <label>Telegram User ID<input name="telegramUserId" required pattern="[1-9][0-9]{0,15}" maxLength={16} defaultValue={member?.telegramUserId} readOnly={Boolean(member)}/></label>
    <label>Display name (optional)<input name="displayName" maxLength={80} defaultValue={member?.displayName??''}/></label>
    <label className="check"><input name="matchAccess" type="checkbox" defaultChecked={member?.matchAccess??false}/>Match Generator</label>
    <label className="check"><input name="newsAccess" type="checkbox" defaultChecked={member?.newsAccess??false}/>News Generator</label>
    <label>Status<select name="status" defaultValue={member?.status??'ACTIVE'}><option value="ACTIVE">Active / restore access</option><option value="SUSPENDED">Suspended</option><option value="REVOKED">Revoked</option></select></label>
  </>;
  return <div className="container dash-page"><BackToDashboard/><h1>User Management</h1>
    <p className="lead">Authorize private Telegram accounts to use your existing bots. Your owner access remains protected.</p>
    {params.saved&&<p className="notice ok" role="status">Access saved. Changes apply without restarting the bots.</p>}
    {params.error&&<p className="notice error" role="alert">Could not save access. Check the ID, permissions and connected bots. The owner's own Telegram IDs cannot be managed here.</p>}
    <section className="card"><h2 className="card-title">Add user</h2><form action={saveAccess}>{fields()}<SubmitButton label="Add user" pendingLabel="Saving..."/></form></section>
    {members.map(member=><section className="card" key={member.id} style={{marginTop:20}}><h2 className="card-title">{member.displayName||member.telegramUserId}</h2><p className="muted">{member.status} · Match: {member.matchAccess?'enabled':'disabled'} · News: {member.newsAccess?'enabled':'disabled'}</p><form action={saveAccess}>{fields(member)}<SubmitButton label="Save access" pendingLabel="Saving..."/></form></section>)}
  </div>;
}
