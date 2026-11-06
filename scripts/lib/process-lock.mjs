// Dedicated, non-pooled PostgreSQL sessions own process locks. No schema objects.
import pg from 'pg';
const NAMESPACE=1179996748;
export const PROCESS_LOCKS={matchBot:1296127043,matchWorker:1297568331,news:1313167187};
export function lockConnectionString(value){
  const url=new URL(value);
  if(url.hostname.endsWith('.neon.tech'))url.hostname=url.hostname.replace(/-pooler(?=\.)/,'');
  return url.toString();
}
export function processLockClient(name){return new pg.Client({connectionString:lockConnectionString(process.env.DATABASE_URL),connectionTimeoutMillis:8000,query_timeout:8000,keepAlive:true,keepAliveInitialDelayMillis:5000,application_name:name});}
function safeReason(error,fallback){return {reason:fallback,databaseCode:/^[0-9A-Z]{5}$/.test(error?.code??'')?error.code:null,networkCode:['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','ENOTFOUND'].includes(error?.code)?error.code:null};}
export async function acquireProcessLock(client,{key,codePrefix='PROCESS',onLost=()=>{},heartbeatMs=5000}={}){
 let active=false,timer,busy=false,backendId;
 const failure=()=>Object.assign(new Error(codePrefix+'_LOCK_LOST'),{code:codePrefix+'_LOCK_LOST'});
 const lose=(detail)=>{if(active){active=false;clearInterval(timer);onLost(detail);}};
 client.on('error',error=>lose(safeReason(error,'connection_error')));client.on('end',()=>lose({reason:'connection_ended',databaseCode:null,networkCode:null}));
 async function heartbeat(){
  if(!active)throw failure();if(busy)return;busy=true;
  try{
   const result=await client.query("SELECT pg_backend_pid() AS backend_pid, EXISTS (SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND classid=$1::oid AND objid=$2::oid AND objsubid=2 AND granted) AS locked",[NAMESPACE,key]);
   const row=result.rows[0];if(!row?.locked||(backendId!=null&&row.backend_pid!==backendId)){lose({reason:'session_lock_missing',databaseCode:null,networkCode:null});throw failure();}
  }catch(error){lose(safeReason(error,'heartbeat_failed'));throw failure();}finally{busy=false;}
 }
 try{
  await client.connect();const result=await client.query('SELECT pg_try_advisory_lock($1, $2) AS locked, pg_backend_pid() AS backend_pid',[NAMESPACE,key]);
  if(!result.rows[0]?.locked){await client.end();return null;}backendId=result.rows[0].backend_pid;active=true;
  timer=setInterval(()=>{heartbeat().catch(()=>{});},heartbeatMs);timer.unref?.();
  return {active:()=>active,heartbeat,release:async()=>{active=false;clearInterval(timer);await client.end().catch(()=>{});}};
 }catch{active=false;clearInterval(timer);await client.end().catch(()=>{});throw Object.assign(new Error(codePrefix+'_DATABASE'),{code:codePrefix+'_DATABASE'});}
}
