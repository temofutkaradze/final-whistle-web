// Synchronous, bounded admission before any expensive asynchronous work. No queues or background timers.
export class Admission {
  private entries = new Map<string,{count:number;until:number;active:number}>();
  private total = 0;
  private totalUntil = 0;
  private active = 0;
  constructor(private options:{perKey:number;windowMs:number;total:number;totalWindowMs:number;active:number;activePerKey:number;keys?:number}, private now=()=>Date.now()) {}
  acquire(key:string):(()=>void)|null {
    const t=this.now();
    for(const [id,e] of this.entries) if(e.until<=t&&!e.active)this.entries.delete(id);
    if(t>=this.totalUntil){this.total=0;this.totalUntil=t+this.options.totalWindowMs;}
    let e=this.entries.get(key);
    if(this.active>=this.options.active||this.total>=this.options.total||(e?.active??0)>=this.options.activePerKey)return null;
    if(e&&t>=e.until){e.count=0;e.until=t+this.options.windowMs;}
    if(e&&e.count>=this.options.perKey)return null;
    if(!e){if(this.entries.size>=(this.options.keys??4096))return null;e={count:0,until:t+this.options.windowMs,active:0};this.entries.set(key,e);}
    e.count++;e.active++;this.active++;this.total++;
    let released=false;
    return ()=>{if(!released){released=true;e!.active--;this.active--;}};
  }
}
export const authAdmission=new Admission({perKey:8,windowMs:15*60_000,total:120,totalWindowMs:60_000,active:4,activePerKey:1});
export const matchSampleAdmission=new Admission({perKey:4,windowMs:60_000,total:60,totalWindowMs:60_000,active:2,activePerKey:1});
