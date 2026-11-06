import {acquireProcessLock,PROCESS_LOCKS} from './process-lock.mjs';
// Preserve the original News lock ID across versions; never reacquire after loss.
export function acquireNewsManagerLock(client,options={}){return acquireProcessLock(client,{...options,key:PROCESS_LOCKS.news,codePrefix:'NEWS_MANAGER'});}
