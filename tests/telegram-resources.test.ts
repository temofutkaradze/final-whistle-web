import {afterEach,describe,expect,it,vi} from 'vitest';
const files=vi.hoisted(()=>({readFile:vi.fn(async()=>Buffer.from('jpg')),mkdir:vi.fn(),writeFile:vi.fn()}));
vi.mock('node:fs/promises',()=>files);
import {sendMessage,sendDocument} from '@/lib/telegram';
import {makeTelegram,readTelegramImage,MAX_TELEGRAM_IMAGE,matchImageUpload} from '../scripts/lib/telegram.mjs';
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();files.writeFile.mockClear();files.mkdir.mockClear();});
describe('website Telegram deadlines without retries',()=>{
 it('sends PNG bytes with the correct MIME without changing JPEG delivery',async()=>{
  const fetcher=vi.fn(async(..._args:unknown[])=>new Response(JSON.stringify({ok:true})));vi.stubGlobal('fetch',fetcher);
  for(const suffix of ['png','jpg']){
   await makeTelegram('fake').sendDocument('1','/fake/post.'+suffix,'caption','news-post.'+suffix);
   const body=(fetcher.mock.calls.at(-1)![1] as RequestInit).body as FormData;
   const document=body.get('document') as File;
   expect(document.type).toBe(suffix==='png'?'image/png':'image/jpeg');expect(document.name).toBe('news-post.'+suffix);
   expect(Buffer.from(await document.arrayBuffer())).toEqual(Buffer.from('jpg'));
  }
 });
 it('identifies document read failures before any Telegram dispatch',async()=>{
  files.readFile.mockRejectedValueOnce(Object.assign(new Error('missing file'),{code:'ENOENT'}));
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  await expect(makeTelegram('fake').sendDocument('1','/missing.jpg','caption')).rejects.toMatchObject({deliveryNotAttempted:true});expect(fetcher).not.toHaveBeenCalled();
 });
 it('uses explicit 30s message and 90s document deadlines',async()=>{
  const timer=vi.spyOn(AbortSignal,'timeout');const fetcher=vi.fn(async()=>new Response(JSON.stringify({ok:true})));vi.stubGlobal('fetch',fetcher);
  await sendMessage('1','hello','fake');await sendDocument('1','/fake/post.jpg','caption','fake');expect(timer.mock.calls.map(c=>c[0])).toEqual([30000,90000]);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('does not retry a timed-out send with unknown delivery status',async()=>{
  const fetcher=vi.fn(async()=>{throw new DOMException('timed out','TimeoutError');});vi.stubGlobal('fetch',fetcher);await expect(sendMessage('1','hello','fake')).rejects.toThrow('timed out');expect(fetcher).toHaveBeenCalledTimes(1);
 });
});
describe('bounded streaming Telegram images',()=>{
 it('accepts document filename or MIME metadata, and normal Photos, without silent ignoring',()=>{
  for(const name of ['IMAGE.JPG','IMAGE.JPEG','image.png','image.webp']){
   expect(matchImageUpload({document:{file_id:'doc',file_name:name,mime_type:'application/octet-stream'}}).fileId).toBe('doc');
   expect(matchImageUpload({document:{file_id:'doc',file_name:name}}).fileId).toBe('doc');
  }
  expect(matchImageUpload({document:{file_id:'doc',mime_type:'image/jpeg'}})).toEqual({fileId:'doc',extension:'.jpg'});
  expect(matchImageUpload({photo:[{file_id:'small'},{file_id:'large'}]}).fileId).toBe('large');
  expect(()=>matchImageUpload({document:{file_id:'pdf',file_name:'file.pdf',mime_type:'application/pdf'}})).toThrow('Unsupported file');
 });
 it('preserves document bytes when Telegram supplies a generic download suffix',async()=>{
  const bytes=Buffer.from([255,216,255,224,17,22,33]);
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ok:true,result:{file_size:bytes.length,file_path:'documents/file.bin'}}))).mockResolvedValueOnce(new Response(bytes));vi.stubGlobal('fetch',fetcher);
  const saved=await makeTelegram('fake').downloadTelegramFile('doc','/fake','original',{imageExtension:'.jpeg'});
  expect(saved).toMatch(/original\.jpeg$/);expect(files.writeFile).toHaveBeenCalledWith(saved,bytes);
 });
 it('cancels an oversized stream before buffering the remaining body',async()=>{
  let cancelled=false,pulls=0;const body=new ReadableStream<Uint8Array>({pull(c){pulls++;c.enqueue(new Uint8Array(4));},cancel(){cancelled=true;}});
  await expect(readTelegramImage(new Response(body),5)).rejects.toThrow('15 MB');expect(cancelled).toBe(true);expect(pulls).toBeLessThanOrEqual(3);
 });
 it('accepts an exact-limit stream and rejects oversized content-length before reading',async()=>{
  expect(await readTelegramImage(new Response(new Uint8Array([1,2,3,4])),4)).toEqual(Buffer.from([1,2,3,4]));const cancel=vi.fn();const res=new Response(new ReadableStream({cancel}),{headers:{'content-length':'6'}});await expect(readTelegramImage(res,5)).rejects.toThrow('15 MB');expect(cancel).toHaveBeenCalledOnce();
 });
 it('rejects oversized getFile metadata before downloading or writing files',async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({ok:true,result:{file_size:MAX_TELEGRAM_IMAGE+1,file_path:'photo.jpg'}})));vi.stubGlobal('fetch',fetcher);
  await expect(makeTelegram('fake').downloadTelegramFile('1','/fake','file')).rejects.toThrow('15 MB');expect(fetcher).toHaveBeenCalledOnce();expect(files.writeFile).not.toHaveBeenCalled();
 });
 it('writes a small complete file only after bounded streaming succeeds',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ok:true,result:{file_size:3,file_path:'photo.jpg'}}))).mockResolvedValueOnce(new Response(new Uint8Array([1,2,3])));vi.stubGlobal('fetch',fetcher);
  await makeTelegram('fake').downloadTelegramFile('1','/fake','file');expect(files.writeFile).toHaveBeenCalledWith(expect.any(String),Buffer.from([1,2,3]));
 });
});
