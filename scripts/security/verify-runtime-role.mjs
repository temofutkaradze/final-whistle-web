// Isolated SQL privilege test: no TCP server, no production credentials or writes.
// Uses the already installed PGlite verification tool; does not install dependencies.
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {freemem} from 'node:os';
const root=fileURLToPath(new URL('../../',import.meta.url));
process.chdir(root);
const fixtureUrl='postgresql://fixture:fixture@127.0.0.1:1/fixture';
if(freemem()<320*1024*1024)throw Error('Isolated schema/role verification deferred: less than 320 MiB available');
const generated=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','diff','--from-empty','--to-schema','prisma/schema.prisma','--script'],{
 env:{...process.env,DATABASE_URL:fixtureUrl,MIGRATION_DATABASE_URL:fixtureUrl},encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024,
});
if(generated.status!==0)throw Error('Isolated schema generation failed; no database was contacted');
const {PGlite}=await import('@electric-sql/pglite');
const db=new PGlite();let checks=0;
const pass=()=>checks++;
async function denied(sql){
 try{await db.exec(sql);}catch(e){assert.equal(e.code,'42501','Expected PostgreSQL insufficient_privilege');pass();return;}
 throw Error('Prohibited fixture operation unexpectedly succeeded: '+sql);
}
try{
 await db.exec(generated.stdout);
 // Match the production metadata inspected read-only: PUBLIC has USAGE, not CREATE.
 await db.exec('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
 const name=(await db.query('SELECT current_database() AS db')).rows[0].db;
 // Only replace the database identifier for the disposable PGlite database.
 const proposal=(await readFile('prisma/security-runtime-role-proposal.sql','utf8')).replace('ON DATABASE neondb','ON DATABASE "'+name.replaceAll('"','""')+'"');
 await db.exec(proposal);pass();
 await db.exec('CREATE TABLE public.private_admin_fixture (secret text)');
 // SET ROLE alone leaves a superuser session_user able to SET ROLE back to postgres.
 // Change session authorization too, so membership denials exercise the runtime identity.
 await db.exec('SET SESSION AUTHORIZATION final_whistle_runtime');
 const roles=(await db.query('SELECT rolsuper,rolcreaterole,rolcreatedb,rolinherit,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
 assert.ok(Object.values(roles).every(value=>value===false));pass();
 const tables=(await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'private_admin_fixture'`)).rows;
 assert.equal(tables.length,18);
 for(const {tablename}of tables){
  const rights=(await db.query(`SELECT has_table_privilege(current_user,$1,'SELECT,INSERT,UPDATE,DELETE') AS ok`,['public."'+tablename+'"'])).rows[0];
  assert.equal(rights.ok,true);await db.query('SELECT * FROM public."'+tablename+'" LIMIT 0');pass();
 }
 await db.exec(`BEGIN;
 INSERT INTO "User" (id,email) VALUES ('privilege-user','fixture@example.invalid');
 SELECT id FROM "User" WHERE id='privilege-user' FOR UPDATE;
 SELECT pg_advisory_xact_lock(1179996749,123);
 SELECT "fixtureId",pg_try_advisory_xact_lock(1179996749,"fixtureId") AS leased FROM "Match"
 WHERE "fixtureId" IN (SELECT value::integer FROM jsonb_array_elements_text('[123]'::jsonb)) AND kickoff<CURRENT_TIMESTAMP ORDER BY "fixtureId" FOR UPDATE;
 INSERT INTO "Session" (id,"userId","tokenHash","expiresAt") VALUES ('fixture-session','privilege-user','fixture-hash',CURRENT_TIMESTAMP-INTERVAL '1 day');
 DELETE FROM "Session" WHERE "expiresAt"<CURRENT_TIMESTAMP;
 INSERT INTO "MatchDeliveryReceipt" ("userId","fixtureId","finalStatus","liveStatus","expiresAt") VALUES ('privilege-user',123,'COMPLETED','SENT',CURRENT_TIMESTAMP+INTERVAL '30 days')
 ON CONFLICT ("userId","fixtureId") DO UPDATE SET "expiresAt"=EXCLUDED."expiresAt";
 UPDATE "User" SET name='Fixture' WHERE id='privilege-user';
 DELETE FROM "MatchDeliveryReceipt" WHERE "userId"='privilege-user';
 ROLLBACK;`);pass();
 assert.equal((await db.query('SELECT count(*)::int AS n FROM "User"')).rows[0].n,0);pass();
 await db.query('SELECT pg_try_advisory_lock(1179996748,123) AS locked');
 await db.query('SELECT pg_advisory_unlock(1179996748,123)');pass();
 assert.equal((await db.query('SELECT pg_try_advisory_lock_shared(1179996749,123) AS locked')).rows[0].locked,true);
 await db.query('SELECT pg_advisory_unlock_shared(1179996749,123)');pass();
 for(const sql of ['CREATE TABLE public.forbidden (id int)','CREATE SCHEMA forbidden','CREATE ROLE forbidden','ALTER TABLE "User" ADD COLUMN forbidden text','DROP TABLE "Session"','TRUNCATE "User" CASCADE','SET ROLE postgres','SELECT * FROM public.private_admin_fixture'])await denied(sql);
 await db.exec('RESET SESSION AUTHORIZATION');
 assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_class WHERE relnamespace='public'::regnamespace AND relowner=(SELECT oid FROM pg_roles WHERE rolname='final_whistle_runtime')`)).rows[0].n,0);pass();
 console.log(JSON.stringify({isolated:true,checks,applicationTables:tables.length,productionChanged:false,limitations:['No TCP authentication or Prisma adapter against the runtime login; test these on approved activation.','CREATE DATABASE capability checked through rolcreatedb=false; PGlite does not implement multiple databases.']}));
}finally{await db.close();}
