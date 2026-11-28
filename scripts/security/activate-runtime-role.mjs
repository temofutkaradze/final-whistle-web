// Owner-approved one-time activation. No services, application jobs or migrations.
import '../lib/security-log-bootstrap.mjs';
import {registerSecret} from '../lib/security-log.cjs';
import pg from 'pg';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {readFile,writeFile,readdir,access} from 'node:fs/promises';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import {verifiedDatabaseUrl} from '../lib/database-tls.mjs';
const root=process.cwd();assert.equal(root.toLowerCase(),'c:\\final-whistle-web');
const adminUrl=new URL(verifiedDatabaseUrl(process.env.DATABASE_URL));
assert.equal(adminUrl.hostname,'ep-old-moon-b1jt04s7-pooler.c-5.eu-central-1.aws.neon.tech');
assert.equal(adminUrl.pathname,'/neondb');assert.equal(decodeURIComponent(adminUrl.username),'neondb_owner');
const backups=path.join(root,'storage/private-backups');
const names=(await readdir(backups)).filter(n=>n.startsWith('runtime-role-')).sort();
assert.ok(names.length,'Verified pre-change backup required');
const backup=path.join(backups,names.at(-1));
const evidence=JSON.parse(await readFile(path.join(backup,'verification.json'),'utf8'));
assert.equal(evidence.completeArchiveDecoded,true);
assert.ok(Date.now()-Date.parse(evidence.verifiedAt)<3600000,'Fresh backup required');
assert.equal(createHash('sha256').update(await readFile(path.join(backup,'database-before.dump'))).digest('hex'),evidence.sha256);
const oldEnv=await readFile('.env','utf8');
assert.equal(oldEnv,await readFile(path.join(backup,'runtime-before.env'),'utf8'),'Configuration changed after backup');
try{await access('.env.migration');throw Error('Migration configuration already exists; review before activation');}catch(e){if(e.code!=='ENOENT')throw e;}
const role='final_whistle_runtime';
const secret=randomBytes(48).toString('base64url');registerSecret(secret);
const runtimeUrl=new URL(adminUrl);runtimeUrl.username=role;runtimeUrl.password=secret;
const adminDirect=new URL(adminUrl);adminDirect.hostname=adminDirect.hostname.replace('-pooler','');
const runtimeDirect=new URL(runtimeUrl);runtimeDirect.hostname=runtimeDirect.hostname.replace('-pooler','');
const makeClient=url=>new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:15000,query_timeout:20000});
const admin=makeClient(adminDirect),runtime=makeClient(runtimeDirect),other=makeClient(runtimeDirect);
const prisma=new PrismaClient({adapter:new PrismaPg({connectionString:runtimeUrl.toString(),connectionTimeoutMillis:15000})});
let roleCreated=false,configChanged=false,checks=0;
async function unchanged(){
 for(const [name,expected] of Object.entries(evidence.tables)){
  const table='public."'+name.replaceAll('"','""')+'"';
  const actual=(await admin.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY md5(row_to_json(t)::text)),'')) AS checksum FROM ${table} t`)).rows[0];
  assert.deepEqual(actual,expected,'Application records changed: '+name);
 }
}
try{
 await admin.connect();await unchanged();checks++;
 assert.equal((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount,0,'Runtime role already exists');
 const proposal=await readFile('prisma/security-runtime-role-proposal.sql','utf8');
 assert.equal((proposal.match(/COMMIT;/g)||[]).length,1);
 // Password stays in process memory and the TLS connection, never command arguments/files/logs.
 await admin.query(proposal.replace('COMMIT;',`ALTER ROLE ${role} LOGIN PASSWORD '${secret}'; COMMIT;`));roleCreated=true;
 await runtime.connect();await other.connect();checks++;
 const flags=(await runtime.query('SELECT rolsuper,rolcreaterole,rolcreatedb,rolinherit,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
 assert.ok(Object.values(flags).every(v=>v===false));checks++;
 for(const name of Object.keys(evidence.tables)){
  const table='public."'+name.replaceAll('"','""')+'"';
  const rights=(await runtime.query('SELECT has_table_privilege(current_user,$1,\'SELECT\') AND has_table_privilege(current_user,$1,\'INSERT\') AND has_table_privilege(current_user,$1,\'UPDATE\') AND has_table_privilege(current_user,$1,\'DELETE\') AS allowed, has_table_privilege(current_user,$1,\'TRUNCATE\') AS truncate',[table])).rows[0];
  assert.equal(rights.allowed,true);assert.equal(rights.truncate,false);
  await runtime.query('SELECT * FROM '+table+' LIMIT 0');checks++;
 }
 assert.equal((await runtime.query("SELECT has_schema_privilege(current_user,'public','CREATE') AS allowed")).rows[0].allowed,false);checks++;
 for(const sql of ['CREATE TABLE public.fw_security_denied (id int)','CREATE ROLE fw_security_denied','SET ROLE neondb_owner']){
  await runtime.query('BEGIN');let denied=false;
  try{await runtime.query(sql);}catch(e){assert.equal(e.code,'42501');denied=true;}finally{await runtime.query('ROLLBACK');}
  assert.equal(denied,true,'Administrative operation was not denied');checks++;
 }
 // Two real backends: shared manual delivery leases exclude archival's exclusive lease.
 const fixture=-2147483001;
 assert.equal((await runtime.query('SELECT pg_try_advisory_lock_shared(1179996749,$1) AS ok',[fixture])).rows[0].ok,true);
 try{assert.equal((await other.query('SELECT pg_try_advisory_lock(1179996749,$1) AS ok',[fixture])).rows[0].ok,false);}finally{await runtime.query('SELECT pg_advisory_unlock_shared(1179996749,$1)',[fixture]);}
 assert.equal((await other.query('SELECT pg_try_advisory_lock(1179996749,$1) AS ok',[fixture])).rows[0].ok,true);
 await other.query('SELECT pg_advisory_unlock(1179996749,$1)',[fixture]);checks++;
 // Exercise real pooled Prisma transactions; every fixture write is rolled back.
 const id='security-'+randomUUID(),rollback=Error('Intentional fixture rollback');
 try{await prisma.$transaction(async tx=>{
  await tx.user.create({data:{id,email:id+'@example.invalid'}});
  await tx.session.create({data:{id,userId:id,tokenHash:id,expiresAt:new Date(0)}});
  await tx.session.deleteMany({where:{id}});
  await tx.matchDeliveryReceipt.upsert({where:{userId_fixtureId:{userId:id,fixtureId:fixture}},create:{userId:id,fixtureId:fixture,finalStatus:'COMPLETED',liveStatus:'SENT',expiresAt:new Date(Date.now()+30*86400000)},update:{liveStatus:'SENT'}});
  await tx.user.update({where:{id},data:{name:'Temporary verification'}});
  await tx.matchDeliveryReceipt.delete({where:{userId_fixtureId:{userId:id,fixtureId:fixture}}});
  throw rollback;
 },{isolationLevel:'ReadCommitted',timeout:20000});}catch(e){if(e!==rollback)throw e;}
 assert.equal(await prisma.user.count({where:{id}}),0);checks++;
 await unchanged();checks++;
 // Store administrative tooling credentials separately, outside Next automatic env names.
 // Windows ignores POSIX mode bits: restrict an EMPTY file before writing secrets.
 await writeFile('.env.migration','',{flag:'wx',mode:0o600});
 const acl=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; Set-Acl -LiteralPath '.env.migration' -AclObject (Get-Acl -LiteralPath '.env')"],{encoding:'utf8',windowsHide:true,timeout:15000});
 assert.equal(acl.status,0,'Migration credential ACL installation failed');
 await writeFile('.env.migration','MIGRATION_DATABASE_URL='+JSON.stringify(adminUrl.toString())+'\n');
 const lines=oldEnv.split(/\r?\n/);const matches=lines.filter(l=>/^\s*(?:export\s+)?DATABASE_URL\s*=/.test(l));assert.equal(matches.length,1);
 const newEnv=lines.map(l=>/^\s*(?:export\s+)?DATABASE_URL\s*=/.test(l)?'DATABASE_URL='+JSON.stringify(runtimeUrl.toString()):l).join(oldEnv.includes('\r\n')?'\r\n':'\n');
 await writeFile('.env',newEnv);configChanged=true;
 await writeFile(path.join(backup,'activation-result.json'),JSON.stringify({activatedAt:new Date().toISOString(),checks,role,tables:18,existingDataUnchanged:true,prismaTransactionRollback:true,crossBackendAdvisoryLocks:true,adminPreserved:true},null,2));
 console.log(JSON.stringify({activated:true,role,tables:18,checks,existingDataUnchanged:true,adminPreserved:true,backup,servicesStarted:false}));
}catch(error){
 if(configChanged)await writeFile('.env',oldEnv);
 if(roleCreated){await admin.query(`ALTER ROLE ${role} NOLOGIN`);await admin.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${role}`);await admin.query(`REVOKE USAGE ON SCHEMA public FROM ${role}`);await admin.query(`REVOKE CONNECT ON DATABASE neondb FROM ${role}`);}
 console.error('Activation failed; runtime configuration restored and new role disabled. Original administrator preserved.');throw error;
}finally{await prisma.$disconnect();await runtime.end();await other.end();await admin.end();}
