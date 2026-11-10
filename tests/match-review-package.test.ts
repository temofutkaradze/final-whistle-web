import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import sharp from 'sharp';
import {afterEach,describe,expect,it} from 'vitest';
import {packageReview,reviewCases} from '../scripts/previews/package-match-review.mjs';
const temporary:string[]=[];
async function fixture(){const root=await mkdtemp(join(tmpdir(),'fw-review-package-'));temporary.push(root);return root;}
afterEach(async()=>{for(const root of temporary.splice(0))await rm(root,{recursive:true,force:true});});
describe('private local fictional Match review bundle',()=>{
 it('rejects CLI output outside the ignored private preview directory before writing',()=>{
  for(const args of [
   ['scripts/previews/package-match-review.mjs','--source','missing-source','--output','docs/previews/forbidden'],
   ['scripts/previews/match-references.mjs','--review-only','--output-dir','docs/previews/forbidden'],
  ]){
   const result=spawnSync(process.execPath,args,{encoding:'utf8',timeout:30000});
   expect(result.status).not.toBe(0);
   expect(result.stderr).toContain('must use a subfolder of preview-images/');
  }
 });
 it('covers 17 event scenarios and eight distinct league/fallback samples',()=>{
  expect(reviewCases).toHaveLength(25);
  expect(new Set(reviewCases.map(c=>c.file)).size).toBe(25);
  expect(reviewCases.every(c=>/^(?:9\d{3}|league-\d+)\.jpg$/.test(c.file)&&c.description.length>10)).toBe(true);
  expect(reviewCases.filter(c=>c.id.startsWith('league-')).map(c=>c.leagueId)).toEqual(expect.arrayContaining([2,5,39,61,78,135,140,999]));
 });
 it('rejects incomplete input without creating a misleading bundle',async()=>{
  const root=await fixture();await expect(packageReview(root,join(root,'bundle'))).rejects.toThrow();
  await expect(readFile(join(root,'bundle','MOCK-SCENARIOS.json'))).rejects.toThrow();
 });
 it('packages unmodified full-resolution images and a verified ZIP without overwriting reviews',async()=>{
  const root=await fixture(),source=join(root,'source'),output=join(root,'bundle');await mkdir(source);
  const image=await sharp({create:{width:1080,height:1350,channels:3,background:'#123456'}}).jpeg().toBuffer();
  for(const item of reviewCases)await writeFile(join(source,item.file),image);
  const result=await packageReview(source,output);
  expect(result.images).toBe(25);
  expect(await readFile(join(output,'full-resolution',reviewCases[0].file))).toEqual(image);
  const manifest=JSON.parse(await readFile(join(output,'MOCK-SCENARIOS.json'),'utf8'));
  expect(manifest).toMatchObject({fictional:true,approval:'PENDING_USER_REVIEW'});
  expect(manifest.cases).toHaveLength(25);
  expect(JSON.stringify(manifest)).not.toContain(root);
  const contact=await sharp(join(output,'CONTACT-SHEET.jpg')).metadata();
  expect(contact).toMatchObject({width:1300,height:2075});
  const verify=spawnSync('python',['-B','-c','import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert len(z.namelist()) == 29; assert all(not n.startswith("/") and ".." not in n.split("/") for n in z.namelist())',result.zip],{encoding:'utf8'});
  expect(verify.status,verify.stderr).toBe(0);
  const before=await readFile(join(output,'README.md'));
  await expect(packageReview(source,output)).rejects.toThrow();
  expect(await readFile(join(output,'README.md'))).toEqual(before);
 });
});
