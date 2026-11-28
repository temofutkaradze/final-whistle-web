import {AsyncLocalStorage} from 'node:async_hooks';
const context=new AsyncLocalStorage();
export const currentJob=()=>context.getStore();
export const runInJob=(job,work)=>context.run(job,work);
// One lane per conversation; one delegated lane leaves capacity for the owner.
// Owner preference is bounded: after three owner grants, a waiting delegate gets a turn.
export function createJobScheduler({activeLimit=2,delegateLimit=1,maxQueued=64,perUserQueued=8}={}){
 const queues=new Map(),running=new Set(),waiters=[];let active=0,delegates=0,queued=0,ownerStreak=0,closed=false;
 const idle=()=>{if(!active&&!queued)for(const resolve of waiters.splice(0))resolve();};
 function pump(){
  while(active<activeLimit){
   const available=[...queues.entries()].filter(([key,q])=>q.length&&!running.has(key)&&(q[0].owner||delegates<delegateLimit));
   const owners=available.filter(([,q])=>q[0].owner),guests=available.filter(([,q])=>!q[0].owner);
   const selected=ownerStreak>=3&&guests.length?guests[0]:owners[0]??guests[0];
   if(!selected)break;
   const [key,q]=selected,item=q.shift();queues.delete(key);if(q.length)queues.set(key,q);
   queued--;active++;running.add(key);if(item.owner)ownerStreak++;else{delegates++;ownerStreak=0;}
   Promise.resolve().then(()=>context.run({key,owner:item.owner},item.work)).then(item.resolve,item.reject).finally(()=>{
    active--;running.delete(key);if(!item.owner)delegates--;pump();idle();
   });
  }
  idle();
 }
 return {
  enqueue(key,owner,work){
   const ownerReserve=Math.min(perUserQueued,Math.max(1,Math.floor(maxQueued/4)));
   if(closed||typeof key!=='string'||key.length>200||queued>=maxQueued||(!owner&&queued>=maxQueued-ownerReserve)||(queues.get(key)?.length??0)>=perUserQueued)return null;
   let resolve,reject;const done=new Promise((a,b)=>{resolve=a;reject=b;});
   const q=queues.get(key)??[];q.push({owner,work,resolve,reject});queues.set(key,q);queued++;pump();return done;
  },
  idle:()=>!active&&!queued?Promise.resolve():new Promise(resolve=>waiters.push(resolve)),
  close(){closed=true;return this.idle();},
  get pending(){return queued+active;},
 };
}

// Bounded response budget for unapproved users; no timers and no growing identity history.
export function createReplyBudget(now=Date.now){
 const keys=new Map();let total=0,until=0;
 return key=>{const t=now();if(t>=until){total=0;until=t+60_000;}for(const [k,expiry]of keys)if(expiry<=t)keys.delete(k);
  if(total>=10||keys.has(key)||keys.size>=512)return false;keys.set(key,t+60_000);total++;return true;};
}
