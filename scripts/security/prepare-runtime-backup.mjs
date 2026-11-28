// Approved pre-activation backup only. Does not modify roles or application data.
import '../lib/security-log-bootstrap.mjs';
import pg from 'pg';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {verifiedDatabaseUrl} from '../lib/database-tls.mjs';
const root=process.cwd();
assert.equal(root.toLowerCase(),'c:\\final-whistle-web');
const source=new URL(verifiedDatabaseUrl(process.env.DATABASE_URL));
assert.equal(source.hostname,'ep-old-moon-b1jt04s7-pooler.c-5.eu-central-1.aws.neon.tech');
assert.equal(source.pathname,'/neondb');
assert.equal(decodeURIComponent(source.username),'neondb_owner');
const direct=new URL(source);direct.hostname=direct.hostname.replace('-pooler','');
const dir=path.join(root,'storage/private-backups','runtime-role-'+new Date().toISOString().replaceAll(':','-'));
await mkdir(dir);
const encrypted=spawnSync('cipher.exe',['/e',dir],{encoding:'utf8',windowsHide:true});
assert.equal(encrypted.status,0,'EFS protection failed');
await copyFile(path.join(root,'.env'),path.join(dir,'runtime-before.env'));
const client=new pg.Client({connectionString:direct.toString(),connectionTimeoutMillis:15000,query_timeout:30000});
const ca=path.join(root,'storage/private-backups/telegram-members-2026-11-27T18-45-16-586Z/trusted-roots.pem');
const childEnv={...process.env,PGHOST:direct.hostname,PGPORT:'5432',PGDATABASE:'neondb',PGUSER:decodeURIComponent(direct.username),PGPASSWORD:decodeURIComponent(direct.password),PGSSLMODE:'verify-full',PGSSLROOTCERT:ca};
delete childEnv.DATABASE_URL;delete childEnv.MIGRATION_DATABASE_URL;
try{
 await client.connect();
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename);
 assert.equal(tables.length,18);
 const before={};
 for(const name of tables){
  const quoted='public."'+name.replaceAll('"','""')+'"';
  before[name]=(await client.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY md5(row_to_json(t)::text)),'')) AS checksum FROM ${quoted} t`)).rows[0];
 }
 const snapshot=(await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
 const dump=path.join(dir,'database-before.dump');
 const result=spawnSync('C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',['--format=custom','--no-password','--snapshot='+snapshot,'--file='+dump],{env:childEnv,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:1024*1024});
 assert.equal(result.status,0,'pg_dump failed; production permissions unchanged');
 await client.query('COMMIT');
 // Decode the entire archive, not just its table of contents; never execute its SQL.
 const verify=spawnSync('C:\\Program Files\\PostgreSQL\\16\\bin\\pg_restore.exe',['--file=NUL',dump],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:1024*1024});
 assert.equal(verify.status,0,'Complete backup decoding failed');
 const digest=createHash('sha256').update(await readFile(dump)).digest('hex');
 const roles=(await client.query("SELECT rolname,rolsuper,rolcreaterole,rolcreatedb,rolinherit,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows;
 const grants=(await client.query("SELECT grantee,table_name,privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' ORDER BY grantee,table_name,privilege_type")).rows;
 await writeFile(path.join(dir,'verification.json'),JSON.stringify({verifiedAt:new Date().toISOString(),target:'Final Whistle neondb',tables:before,roles,grants,sha256:digest,completeArchiveDecoded:true,independentEncryptedRecovery:false},null,2));
 await writeFile(path.join(dir,'README.txt'),'Pre-runtime-role activation backup. Restore only with the preserved migration owner, after stopping application services. runtime-before.env contains secrets: preserve ACL/EFS protection. Complete protect-backups.ps1 -ExportEfsCertificate before independent/off-device recovery is considered verified.\n');
 console.log(JSON.stringify({backup:dir,tables:tables.length,fullArchiveDecode:true,sha256:digest,productionChanged:false}));
}finally{await client.end();}
