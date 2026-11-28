// A customer taps a match button in Telegram: select it, or take the selection back.
// Returns what happened, so bot.mjs can answer the tap. Written to survive double taps and a post that is being sent.
import {findActiveMatchReceipt} from './match-receipts.mjs';

export async function toggleSelection({ prisma, userId, fixtureId, maxAgeHours, now = Date.now() }) {
  if (await findActiveMatchReceipt(prisma, userId, fixtureId, now)) return { result: "already-sent" };
  const match = await prisma.match.findUnique({ where: { fixtureId } });
  if (!match) return { result: "no-match" };

  const existing = await prisma.selection.findUnique({ where: { userId_fixtureId: { userId, fixtureId } } });
  if (existing) {
    if (existing.status === "COMPLETED") return { result: "already-sent" };
    // The worker is sending it right now: removing it here would break that send.
    if (existing.status === "SENDING" || existing.liveStatus === 'SENDING') return { result: "sending" };
    if (existing.status === 'DESELECTED') {
      if (match.kickoff.getTime() < now - maxAgeHours * 3600e3) return {result:'too-old'};
      await prisma.selection.updateMany({where:{id:existing.id,status:'DESELECTED'},data:{status:'SELECTED',selectedAt:new Date(now)}});
      return {result:'selected'};
    }
    // Retain delivery fences through deselection/reselection. Deleting them could send twice.
    if (existing.liveDispatchAt || existing.finalDispatchAt || ['SENT','UNCERTAIN'].includes(existing.liveStatus)) {
      const changed = await prisma.selection.updateMany({where:{id:existing.id,status:{in:['SELECTED','FAILED']},liveStatus:{not:'SENDING'}},data:{status:'DESELECTED'}});
      if (!changed.count) {
        const current = await prisma.selection.findUnique({where:{userId_fixtureId:{userId,fixtureId}}});
        if(current?.status==='COMPLETED')return {result:'already-sent'};
        if(current?.status==='SENDING'||current?.liveStatus==='SENDING')return {result:'sending'};
      }
      return {result:'removed'};
    }
    const removed = await prisma.selection.deleteMany({
      where: { id: existing.id, userId, fixtureId, status: { in: ["SELECTED", "FAILED"] },liveStatus:{in:['PENDING','FAILED']},liveDispatchAt:null,finalDispatchAt:null },
    });
    if (!removed.count) {
      const current = await prisma.selection.findUnique({ where: { userId_fixtureId: { userId, fixtureId } } });
      if (current?.status === "COMPLETED") return { result: "already-sent" };
      if (current?.status === "SENDING" || current?.liveStatus === 'SENDING') return { result: "sending" };
      if (current) return { result: "selected" }; // a replacement or another state: leave it intact
    }
    return { result: "removed" };
  }

  if (match.kickoff.getTime() < now - maxAgeHours * 3600e3) return { result: "too-old" };
  try {
    await prisma.selection.create({ data: { userId, fixtureId } });
  } catch (e) {
    if (e?.code === "P2002") return { result: "selected" }; // a second tap selected it a moment earlier
    if (e?.code === 'P2003') {
      if (await findActiveMatchReceipt(prisma, userId, fixtureId, now)) return { result: 'already-sent' };
      if (!await prisma.match.findUnique({ where: { fixtureId } })) return { result: 'no-match' };
    }
    throw e;
  }
  return { result: "selected" };
}

// Callback replay is common after a cursor write is interrupted. Use the original
// button state as the desired state, so redelivery of one callback cannot toggle twice.
export async function setSelectionState({prisma,userId,fixtureId,selected,maxAgeHours,now=Date.now()}){
  const existing=await prisma.selection.findUnique({where:{userId_fixtureId:{userId,fixtureId}}});
  const current=Boolean(existing&&existing.status!=='DESELECTED');
  if(current===selected){
    if(!selected)return {result:'removed'};
    if(existing.status==='COMPLETED')return {result:'already-sent'};
    if(existing.status==='SENDING'||existing.liveStatus==='SENDING')return {result:'sending'};
    return {result:'selected'};
  }
  return toggleSelection({prisma,userId,fixtureId,maxAgeHours,now});
}
