import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';
const sql=readFileSync(resolve(__dirname,'../prisma/auth-identity.sql'),'utf8').replace(/--[^\n]*/g,'');
describe('H1 additive migration safety',()=>{
 it('contains only transactional, bounded identity-table DDL',()=>{
  expect(sql.trim().startsWith('BEGIN;')).toBe(true);expect(sql.trim().endsWith('COMMIT;')).toBe(true);
  const statements=sql.split(';').map(x=>x.trim()).filter(Boolean);
  for(const statement of statements)expect(statement).toMatch(/^(?:BEGIN$|COMMIT$|SET LOCAL (?:lock_timeout|statement_timeout) =|CREATE TABLE "public"\."AuthIdentity"|CREATE UNIQUE INDEX "AuthIdentity_\w+" ON "public"\."AuthIdentity"|ALTER TABLE "public"\."AuthIdentity")/);
  expect(sql).not.toMatch(/\b(?:DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+"|DROP|TRUNCATE)\b/i);
  expect(sql.match(/CREATE TABLE/g)).toHaveLength(1);
 });
 it('enforces unique subjects, one identity per user/provider and a real user FK',()=>{
  expect(sql).toContain('ON "public"."AuthIdentity"("provider", "subject")');expect(sql).toContain('ON "public"."AuthIdentity"("userId", "provider")');
  expect(sql).toContain('REFERENCES "public"."User"("id")');expect(sql).toContain('CHECK ("provider" = \'google\')');expect(sql).toContain('char_length("subject") BETWEEN 1 AND 255');
 });
});
