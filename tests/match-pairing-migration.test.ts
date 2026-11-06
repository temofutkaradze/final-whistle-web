import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';
const sql=readFileSync(resolve(__dirname,'../prisma/match-pairing.sql'),'utf8').replace(/--[^\n]*/g,'');
describe('H2 additive SQL',()=>{
 it('creates only the two new tables and constraints inside a bounded transaction',()=>{
  expect(sql.trim().startsWith('BEGIN;')).toBe(true);expect(sql.trim().endsWith('COMMIT;')).toBe(true);expect(sql.match(/CREATE TABLE/g)).toHaveLength(2);
  for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))expect(statement).toMatch(/^(?:BEGIN$|COMMIT$|SET LOCAL (?:lock_timeout|statement_timeout) =|CREATE TABLE "public"\."Match(?:PairingChallenge|TelegramBinding)"|CREATE (?:UNIQUE )?INDEX "Match\w+" ON "public"\."Match(?:PairingChallenge|TelegramBinding)"|ALTER TABLE "public"\."Match(?:PairingChallenge|TelegramBinding)")/);
 });
 it('has identity/hash/expiry guards, unique challenges and bindings, and real user FKs',()=>{
  expect(sql).toContain('"codeHash" CHAR(64) NOT NULL');expect(sql).toContain('"MatchPairingChallenge_codeHash_key"');expect(sql).toContain('"MatchPairingChallenge_userId_botId_telegramUserId_key"');expect(sql).toContain('"MatchTelegramBinding_botId_key"');expect(sql).toContain('CHECK ("expiresAt" > "createdAt")');expect(sql.match(/REFERENCES "public"\."User"/g)).toHaveLength(2);
 });
});
