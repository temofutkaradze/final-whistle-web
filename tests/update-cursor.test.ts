import {describe,expect,it} from 'vitest';import {mkdtemp,readFile} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
// @ts-expect-error Native runtime JavaScript helper has no declaration file.
import {updateCursor} from '../scripts/lib/update-cursor.mjs';
describe('durable Match update cursors',()=>{
 it('restores the acknowledged offset across manager instances without saving credentials',async()=>{const directory=await mkdtemp(path.join(tmpdir(),'fw-stage1-cursor-'));const first=await updateCursor('owner','bot',directory);expect(first.offset).toBe(0);await first.checkpoint(101);const second=await updateCursor('owner','bot',directory);expect(second.offset).toBe(101);await expect(second.checkpoint(100)).rejects.toThrow();const file=path.join(directory,createHash('sha256').update('owner:bot').digest('hex')+'.json');expect(JSON.parse(await readFile(file,'utf8'))).toEqual({offset:101,acknowledgedAt:expect.any(Number)});});
});

 it('discards a week-old local cursor because Telegram can reseed update IDs after inactivity',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'fw-stage1-expired-'));const first=await updateCursor('owner','bot',directory);await first.checkpoint(101);const file=path.join(directory,createHash('sha256').update('owner:bot').digest('hex')+'.json');const {writeFile}=await import('node:fs/promises');await writeFile(file,JSON.stringify({offset:101,acknowledgedAt:Date.now()-8*24*60*60*1000}));expect((await updateCursor('owner','bot',directory)).offset).toBe(0);
 });
