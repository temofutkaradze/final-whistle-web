// Only disposable client/cache data belongs here. Never use this for delivery acknowledgements.
export function createIdleCache({max=512,ttlMs=30*60_000,now=()=>Date.now()}={}){
 if(!Number.isInteger(max)||max<1||max>4096||!Number.isFinite(ttlMs)||ttlMs<=0)throw new Error('Invalid cache bounds');
 const entries=new Map();
 const prune=()=>{const t=now();for(const [key,e] of entries)if(t-e.used>=ttlMs)entries.delete(key);};
 return {
  get(key){prune();const e=entries.get(key);if(!e)return undefined;e.used=now();entries.delete(key);entries.set(key,e);return e.value;},
  set(key,value){prune();entries.delete(key);while(entries.size>=max)entries.delete(entries.keys().next().value);entries.set(key,{value,used:now()});},
  get size(){return entries.size;},prune,
 };
}
export function retireCooldowns(entries,wanted,now=Date.now()){
 for(const [key,until] of entries)if(until<=now||!wanted.has(key))entries.delete(key);
}
