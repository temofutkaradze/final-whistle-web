// Telegram's offset is advanced only for the completed prefix of accepted work.
// An in-memory poll offset allows other conversations to be admitted meanwhile.
export function createOrderedUpdateCursor(initialOffset,persist){
 let fetchOffset=initialOffset,checkpointOffset=initialOffset,chain=Promise.resolve();
 const pending=[];
 const flush=()=>{
  chain=chain.catch(()=>{}).then(async()=>{
   while(pending[0]?.done){const item=pending[0];await persist(item.updateId+1);checkpointOffset=item.updateId+1;pending.shift();}
  });
  return chain;
 };
 return {
  get fetchOffset(){return fetchOffset;},
  // Only this offset is safe to send to Telegram: fetching acknowledges older updates.
  get checkpointOffset(){return checkpointOffset;},
  get pending(){return pending.length;},
  accept(updateId){
   if(!Number.isSafeInteger(updateId)||updateId<fetchOffset)return null;
   const item={updateId,done:false};pending.push(item);fetchOffset=updateId+1;
   return {complete:async()=>{item.done=true;await flush();}};
  },
  retry:flush,
 };
}
