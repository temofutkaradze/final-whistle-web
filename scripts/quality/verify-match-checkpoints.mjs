// Opt-in real PostgreSQL validation. Never reads DATABASE_URL, never connects to an existing cluster.
// Usage: node scripts/quality/verify-match-checkpoints.mjs --pg-bin "C:/Program Files/PostgreSQL/16/bin"
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {createWorkerCore} from '../lib/worker-core.mjs';
import {toggleSelection} from '../lib/selection.mjs';
import {checkpointFromFixture} from '../lib/live-checkpoint.mjs';
import {buildEventsHtml} from '../lib/events.mjs';
import * as config from '../lib/config.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const bin=process.argv[process.argv.indexOf('--pg-bin')+1];
assert.ok(process.argv.includes('--pg-bin')&&path.isAbsolute(bin),'Provide the installed PostgreSQL bin directory');
const baseline='a56a757573be2132f5492ae808c2e19f501e73fc';
const env={...process.env};
for(const key of Object.keys(env))if(/^PG|^(DATABASE_URL|DIRECT_URL|SHADOW_DATABASE_URL)$/i.test(key))delete env[key];
const run=(exe,args)=>execFileSync(exe,args,{cwd:root,env,windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000});
// Windows postgres inherits handles from pg_ctl. Do not leave captured pipes open in its daemon.
const control=args=>execFileSync(path.join(bin,'pg_ctl.exe'),args,{cwd:root,env,windowsHide:true,stdio:'ignore',timeout:30000});
const ram=()=>os.freemem()/1048576;
const guard=async()=>{const deadline=Date.now()+45000;let available;
  do{available=Math.round(ram());if(available>=448)return;await new Promise(resolve=>setTimeout(resolve,1000));}while(Date.now()<deadline);
  assert.fail(`At least 448 MiB available RAM required (${available} MiB available); no existing services will be stopped`);
};
await guard();
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'fw-checkpoints-pg-'));
const data=path.join(temp,'data');
const log=path.join(temp,'postgres.log');
const report={postgres:run(path.join(bin,'postgres.exe'),['--version']).trim(),baseline,checks:[],metrics:{},success:false};
const check=(name)=>{report.checks.push(name);console.log('PASS '+name);};
let started=false;const connections=[];let prisma;
const startedAt=performance.now();
const hash=value=>createHash('sha256').update(value).digest('hex');
const migration=await fs.readFile(path.join(root,'prisma/match-checkpoints.sql'),'utf8');
report.migrationSha256=hash(migration);
const q=name=>'"'+name.replaceAll('"','""')+'"';
try{
  // Schema generation is datamodel-only; a separate config prevents loading the application's .env.
  const beforeSchema=path.join(temp,'before.prisma'),afterSchema=path.join(temp,'after.prisma');
  await fs.writeFile(beforeSchema,run('git',['show',baseline+':prisma/schema.prisma']));
  await fs.copyFile(path.join(root,'prisma/schema.prisma'),afterSchema);
  const isolatedConfig=path.join(temp,'prisma.config.mjs');
  await fs.writeFile(isolatedConfig,'export default '+JSON.stringify({schema:beforeSchema,datasource:{url:'postgresql://checkpoint_test@127.0.0.1:1/unused'}})+';');
  const ddl=schema=>run(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'migrate','diff','--from-empty','--to-schema',schema,'--script','--config',isolatedConfig]);
  const beforeSQL=ddl(beforeSchema),afterSQL=ddl(afterSchema);
  assert.ok(beforeSQL.includes('CREATE TABLE "User"'),`Baseline DDL missing User: ${beforeSQL.slice(0,300)}`);
  assert.ok(afterSQL.includes('"liveDispatchAt"'),'Expected-schema DDL missing new fields');
  await guard();
  const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  report.port=port;
  run(path.join(bin,'initdb.exe'),['-D',data,'-U','checkpoint_test','--auth=trust','--encoding=UTF8','--locale=C']);
  // The temporary cluster listens only on loopback and has no application credentials or real data.
  started=true;
  control(['-D',data,'-l',log,'-o',`-h 127.0.0.1 -p ${port} -c shared_buffers=16MB -c max_connections=8 -c work_mem=1MB -c maintenance_work_mem=16MB -c autovacuum=off`,'-w','start']);
  const connect=async(database)=>{
    assert.ok(['postgres','checkpoint_success','checkpoint_expected','checkpoint_rollback','checkpoint_lock'].includes(database));
    const client=new pg.Client({host:'127.0.0.1',port,user:'checkpoint_test',database,connectionTimeoutMillis:5000});
    await client.connect();connections.push(client);
    const identity=(await client.query('SELECT current_database() AS db, inet_server_port() AS port, current_setting(\'data_directory\') AS dir')).rows[0];
    assert.equal(identity.db,database);assert.equal(identity.port,port);assert.equal(path.resolve(identity.dir),path.resolve(data));
    return client;
  };
  const admin=await connect('postgres');
  for(const name of ['checkpoint_success','checkpoint_expected','checkpoint_rollback','checkpoint_lock'])await admin.query('CREATE DATABASE '+q(name));
  const success=await connect('checkpoint_success');await success.query(beforeSQL);
  assert.equal((await success.query('SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema=\'public\'')).rows[0].n,(beforeSQL.match(/CREATE TABLE /g)||[]).length,'Baseline tables must exist before any seed/migration');
  const seed=`
    INSERT INTO "User" (id,email,"botToken","botId","telegramChatId","createdAt")
      SELECT 'u'||n,'synthetic-'||n||'@example.invalid','TEST_ONLY_NOT_A_CREDENTIAL','test-bot-'||n,(100+n)::text,'2026-11-01 01:02:03.456' FROM generate_series(1,10) n;
    INSERT INTO "Brand" (id,"userId",name,"backgroundPath","createdAt") SELECT 'b'||n,'u'||n,'Test page '||n,'storage/backgrounds/test-'||n||'.jpg',now() FROM generate_series(1,10) n;
    INSERT INTO "Match" ("fixtureId",day,"leagueId","leagueName","leagueLogo","homeTeam","awayTeam","homeLogo","awayLogo",kickoff,"statusShort","homeScore","awayScore","eventsJson")
      SELECT n,'2026-11-12',39,'Test league','league.png','Home '||n,'Away '||n,'home.png','away.png','2026-11-12 19:00:00','FT',2,1,'[]'::jsonb FROM generate_series(1,1000) n;
    INSERT INTO "Selection" (id,"userId","fixtureId",status,"backgroundPath",attempts,"lastError","sentAt","createdAt","updatedAt")
      SELECT 's'||n,'u'||(1+n%10),n,(ARRAY['SELECTED','SENDING','COMPLETED','FAILED'])[1+n%4],CASE WHEN n%2=0 THEN NULL ELSE 'storage/backgrounds/test-'||n||'.jpg' END,n%5,CASE WHEN n%4=3 THEN 'synthetic failure' ELSE NULL END,CASE WHEN n%4=2 THEN '2026-11-12 21:00:00'::timestamp ELSE NULL END,'2026-11-12 18:00:00.123','2026-11-12 21:00:00.987' FROM generate_series(1,1000) n;
    INSERT INTO "NewsSettings" ("userId","botToken","botId",pending,"lastUpdateId") VALUES ('u1','SYNTHETIC_NEWS_PLACEHOLDER','test-news','{"mode":"collecting","photo":"synthetic"}',42);
    INSERT INTO "NewsTemplate" (id,"userId",name,layout,config) VALUES ('nt','u1','Test news','single','{"font":"test"}');
    INSERT INTO "Template" (id,"userId",name,html,config) VALUES ('mt','u1','Test match','<p>Test</p>','{"style":"test"}');
    INSERT INTO "Subscription" (id,"userId","leagueIds") VALUES ('sub','u1',ARRAY[39,140]);
    INSERT INTO "Session" (id,"userId","tokenHash","expiresAt") VALUES ('session','u1','synthetic-session-hash','2027-01-01');
    INSERT INTO "AuthIdentity" (id,"userId",provider,subject) VALUES ('identity','u1','google','synthetic-subject');
    INSERT INTO "FavoriteTeam" (id,"userId","teamId") VALUES ('fav','u1',1);
    INSERT INTO "FixtureDay" (date) VALUES ('utc:2026-11-12|39,140');
    INSERT INTO "ApiUsage" (day,count) VALUES ('2026-11-12',20);
    INSERT INTO "Team" (id,name,logo,"leagueId") VALUES (1,'Synthetic team','team.png',39);
    INSERT INTO "MatchTelegramBinding" ("userId","botId","telegramUserId","chatId") VALUES ('u1','test-bot-1','101','101'),('u2','test-bot-2','102','102');
    INSERT INTO "MatchPairingChallenge" (id,"userId","botId","connectionHash","telegramUserId","chatId","codeHash","expiresAt") VALUES ('challenge','u3','test-bot-3',repeat('a',64),'103','103',repeat('b',64),now()+interval '1 hour');
  `;
  await success.query(seed);
  const columns=(await success.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`)).rows;
  const tables=[...new Set(columns.map(r=>r.table_name))];
  const snapshot=async(client)=>{
    const result={};
    for(const table of tables){const names=columns.filter(r=>r.table_name===table).map(r=>q(r.column_name)).join(',');
      result[table]=(await client.query(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text AS data FROM (SELECT ${names} FROM ${q(table)}) t`)).rows[0].data;}
    return result;
  };
  const structure=async client=>(await client.query(`SELECT c.relname AS name, pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname`)).rows;
  const before=await snapshot(success),indexes=await structure(success);
  const t=performance.now();await success.query(migration);report.metrics.migrationMs=+(performance.now()-t).toFixed(2);
  assert.deepEqual(await snapshot(success),before);assert.deepEqual(await structure(success),indexes);
  report.tablesPreserved=tables.length;report.existingSelections=1000;report.oldDataSha256=hash(JSON.stringify(before));
  check('All original rows/columns in every table, timestamps, JSON, backgrounds, statuses and indexes preserved exactly');
  const fields=(await success.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE "selectedAt"="createdAt" AND "liveStatus"='PENDING' AND "liveAttempts"=0 AND "liveSentAt" IS NULL AND "liveDispatchAt" IS NULL AND "finalDispatchAt" IS NULL)::int AS valid FROM "Selection"`)).rows[0];
  assert.deepEqual(fields,{total:1000,valid:1000});check('All 1000 old selections retain actual selectedAt and receive safe unsent stage defaults');
  const expected=await connect('checkpoint_expected');await expected.query(afterSQL);
  const schema=async client=>({columns:(await client.query(`SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,column_name`)).rows,
    constraints:(await client.query(`SELECT t.relname,c.conname,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' ORDER BY t.relname,c.conname`)).rows,indexes:await structure(client)});
  assert.deepEqual(await schema(success),await schema(expected));check('Migrated columns, defaults, nullability, constraints and indexes match current Prisma schema');
  const migrated=await snapshot(success);
  await assert.rejects(success.query(migration),e=>e.code==='42701');await success.query('ROLLBACK');assert.deepEqual(await snapshot(success),migrated);
  check('Accidental second application fails without modifying data (migration is deliberately not idempotent)');
  const rollback=await connect('checkpoint_rollback');await rollback.query(beforeSQL);await rollback.query(seed);
  const rollbackSchema=await schema(rollback),rollbackRows=await snapshot(rollback);
  await assert.rejects(rollback.query(migration.replace('COMMIT;','SELECT 1/0; COMMIT;')),e=>e.code==='22012');await rollback.query('ROLLBACK');
  assert.deepEqual(await schema(rollback),rollbackSchema);assert.deepEqual(await snapshot(rollback),rollbackRows);check('Injected failure after backfill rolls back every DDL and data change');
  const locked=await connect('checkpoint_lock');await locked.query(beforeSQL);await locked.query(seed);
  const lockRows=await snapshot(locked),lockSchema=await schema(locked);
  const holder=await connect('checkpoint_lock');await holder.query('BEGIN; LOCK TABLE "Match" IN ACCESS SHARE MODE');
  const lockStart=performance.now();await assert.rejects(locked.query(migration),e=>e.code==='55P03');report.metrics.lockTimeoutMs=Math.round(performance.now()-lockStart);
  await locked.query('ROLLBACK');await holder.query('ROLLBACK');await holder.end();connections.splice(connections.indexOf(holder),1);
  assert.deepEqual(await snapshot(locked),lockRows);assert.deepEqual(await schema(locked),lockSchema);check('Real lock contention aborts at the 5-second lock timeout and leaves baseline unchanged');
  await expected.end();connections.splice(connections.indexOf(expected),1);await rollback.end();connections.splice(connections.indexOf(rollback),1);await locked.end();connections.splice(connections.indexOf(locked),1);

  // The real generated Prisma client, explicit isolated connection; all external effects are stubs.
  prisma=new PrismaClient({adapter:new PrismaPg({host:'127.0.0.1',port,user:'checkpoint_test',database:'checkpoint_success',max:2})});
  const now=Date.parse('2026-11-12T21:00:00Z');
  await prisma.match.create({data:{fixtureId:9001,day:'2026-11-12',leagueId:39,leagueName:'Test',leagueLogo:'l',homeTeam:'Alpha',awayTeam:'Beta',homeLogo:'h',awayLogo:'a',kickoff:new Date(now-120*60000),statusShort:'2H'}});
  for(const id of ['u1','u2'])await prisma.selection.create({data:{userId:id,fixtureId:9001,selectedAt:new Date(now-60000),backgroundPath:'storage/backgrounds/'+id+'.jpg'}});
  const shot=checkpointFromFixture({fixture:{status:{short:'2H',elapsed:90,extra:3}},goals:{home:2,away:1}},new Date(now));
  await prisma.match.update({where:{fixtureId:9001},data:{liveCheckpointAt:new Date(now),liveCheckpointJson:shot,elapsedMinutes:90,lastCheckedAt:new Date(now)}});
  // Exclude unrelated historical fixtures from the worker without changing their preserved snapshots.
  let statusCalls=0,eventsCalls=0;const delivered=[],renders=[];
  const makeCore=()=>createWorkerCore({prisma,config,now:()=>now,localDate:date=>date.toISOString().slice(0,10),
    football:{isFinished:s=>config.FINISHED.has(s),isDead:s=>config.DEAD.has(s),refreshStatuses:async()=>{statusCalls++;},fetchEvents:async()=>{eventsCalls++;return [];},saveEvents:async()=>{}},
    renderPost:async payload=>{renders.push(payload);return '/synthetic.jpg';},buildEventsHtml,
    brandLookFields:async brand=>({page_name:brand.name}),pickBackground:async sel=>({background_path:sel.backgroundPath}),
    telegramForUser:()=>({sendDocument:async(chat,file,caption)=>delivered.push({chat,caption}),sendMessage:async()=>{}}),unlink:async()=>{},sleep:async()=>{},log:()=>{},error:()=>{}});
  // Keep preservation fixtures out of the separate worker behavior exercise.
  await prisma.selection.updateMany({where:{fixtureId:{lte:1000}},data:{status:'DESELECTED'}});
  await Promise.all([makeCore().tick(),makeCore().tick()]);
  assert.equal(delivered.length,2);assert.deepEqual(renders.map(r=>r.background_path).sort(),['storage/backgrounds/u1.jpg','storage/backgrounds/u2.jpg']);
  assert.equal((await prisma.selection.count({where:{fixtureId:9001,status:'SELECTED',liveStatus:'SENT'}})),2);
  await makeCore().tick();assert.equal(delivered.length,2);
  await prisma.match.update({where:{fixtureId:9001},data:{statusShort:'FT',homeScore:2,awayScore:2,eventsJson:[]}});
  await makeCore().tick();await makeCore().tick();assert.equal(delivered.length,4);assert.equal(await prisma.selection.count({where:{fixtureId:9001,status:'COMPLETED'}}),2);
  assert.equal(statusCalls,0);assert.equal(eventsCalls,0);check('Real Prisma: concurrent live claims send once per user, preserve own backgrounds, and restart delivers final independently');
  await prisma.selection.update({where:{userId_fixtureId:{userId:'u1',fixtureId:9001}},data:{status:'SELECTED'}});
  await toggleSelection({prisma,userId:'u1',fixtureId:9001,maxAgeHours:24,now});
  assert.equal((await prisma.selection.findUnique({where:{userId_fixtureId:{userId:'u1',fixtureId:9001}}})).status,'DESELECTED');
  await toggleSelection({prisma,userId:'u1',fixtureId:9001,maxAgeHours:24,now});await makeCore().tick();assert.equal(delivered.length,4);
  check('Real Prisma: deselection/reselection preserves live and final dispatch fences');
  report.success=true;
}finally{
  await prisma?.$disconnect();for(const client of connections)await client.end().catch(()=>{});
  if(started&&spawnSync(path.join(bin,'pg_ctl.exe'),['-D',data,'status'],{windowsHide:true,stdio:'ignore',env}).status===0)control(['-D',data,'-m','fast','-w','stop']);
  report.metrics.totalMs=Math.round(performance.now()-startedAt);
  const output=path.join(root,'preview-images/match-checkpoints-validation');await fs.mkdir(output,{recursive:true});
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  // Only the unique temporary directory created by this process is removable.
  assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));assert.ok(path.basename(temp).startsWith('fw-checkpoints-pg-'));
  await fs.rm(temp,{recursive:true,maxRetries:10,retryDelay:200});
  console.log(JSON.stringify(report,null,2));
}
