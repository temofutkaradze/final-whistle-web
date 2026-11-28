import fs from 'node:fs/promises';
import path from 'node:path';
import {currentJob} from './job-scheduler.mjs';
export {renderSecurityHeaders} from './render-security-headers.mjs';
// Restrictive quotas remain opt-in until the owner approves their values.
export const proposedQuotas=Object.freeze({imagesPerMinute:4,imagesPerHour:40,globalImagesPerHour:120,uploadMiB:250,minFreeMiB:2048});
const buckets=new Map();let global={hour:0,count:0};
export async function admitUpload(directory,baseName,bytes){
 const info=await fs.statfs(directory);
 const job=currentJob(),enforce=process.env.FW_ENFORCE_DELEGATE_QUOTAS==='true'&&job&&!job.owner;
 const minimum=enforce?2048*1024*1024:64*1024*1024;
 if(info.bavail*info.bsize<minimum+bytes)throw Error('Not enough free disk space for this upload.');
 if(!enforce||!baseName.includes('_'))return;
 const prefix=baseName.slice(0,baseName.lastIndexOf('_'))+'_';let used=0;
 for(const entry of await fs.readdir(directory,{withFileTypes:true}))if(entry.isFile()&&entry.name.startsWith(prefix))used+=(await fs.stat(path.join(directory,entry.name))).size;
 if(used+bytes>250*1024*1024)throw Error('Your upload storage budget is full. Ask the owner to review your files.');
}
export async function admitImage({directory='storage',cost=1,now=Date.now()}={}){
 if(!Number.isSafeInteger(cost)||cost<1)throw Error('Invalid image budget cost');
 const info=await fs.statfs(path.resolve(directory));
 if(info.bavail*info.bsize<128*1024*1024)throw Error('Not enough free disk space for a new image.');
 if(process.env.FW_ENFORCE_DELEGATE_QUOTAS!=='true')return;
 const job=currentJob();if(!job||job.owner)return;
 for(const [key,row]of buckets)if(now-row.time>=3600_000)buckets.delete(key);
 if(!buckets.has(job.key)&&buckets.size>=512)throw Error('Resource budget unavailable');
 const row=buckets.get(job.key)??{time:now,minute:now,minuteCount:0,count:0};
 if(now-row.minute>=60_000){row.minute=now;row.minuteCount=0;}
 if(now-global.hour>=3600_000)global={hour:now,count:0};
 if(row.minuteCount+cost>4||row.count+cost>40||global.count+cost>120)throw Error('Image budget reached. Please try later.');
 if(info.bavail*info.bsize<2048*1024*1024)throw Error('Not enough free disk space for a new image.');
 row.minuteCount+=cost;row.count+=cost;global.count+=cost;buckets.set(job.key,row);
}
