import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import {readFileSync,readdirSync,rmSync} from 'node:fs';
import {resolve,dirname,basename,join} from 'node:path';
import {beforeAll,afterAll,it,expect} from 'vitest';
import sharp from 'sharp';
import {sampleMatchFields} from '../src/lib/sample-match';
const root=resolve(__dirname,'..'),secret='isolated-lifecycle-key';
let child:ChildProcess,port:number,log='',image:string;
const files=new Set<string>();
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const auth={'content-type':'application/json','x-news-render-secret':secret};
const health=()=>fetch('http://127.0.0.1:'+port+'/render-health',{headers:auth}).then(r=>r.json());
const post=(route:string,body:unknown)=>fetch('http://127.0.0.1:'+port+route,{method:'POST',headers:auth,body:JSON.stringify(body)});
const match=(id:string,team:string)=>({...sampleMatchFields(),fixture_id:'vitest_lifecycle_'+id,home_team:team});
const news=()=>({job:{layout:'single',quote:'LIFECYCLE NEWS',author:'AUTHOR',caption:'',pos:{b:[50,50,1],c:[50,30,1]}},background:image,circle:null});
async function output(response:Response){const data=await response.json();if(data.jpg_path)files.add(data.jpg_path);if(data.png_path)files.add(data.png_path);if(data.html_path)files.add(data.html_path);return {...data,image_path:data.png_path??data.jpg_path};}
beforeAll(async()=>{
 image=(await sharp({create:{width:16,height:16,channels:3,background:'red'}}).png().toBuffer()).toString('base64');
 port=await new Promise<number>((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const n=(s.address() as {port:number}).port;s.close(()=>resolve(n));});});
 child=spawn(process.execPath,['--require',join(root,'tests/helpers/fake-playwright.cjs'),join(root,'render/render-server.js')],{cwd:root,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,RENDER_PORT:String(port),NEWS_RENDER_SECRET:secret,FW_RENDER_CHILD:'1',FW_TEST_PAGE_DEADLINE:'2000'}});
 child.stdout?.on('data',data=>{log+=data;});child.stderr?.on('data',data=>{log+=data;});
 const start=Date.now();while(!/Warm-up (done|skipped)/.test(log)){if(child.exitCode!==null||Date.now()-start>45000)throw Error('Disposable renderer startup failed: '+log);await pause(50);}
});
afterAll(async()=>{
 if(child?.exitCode===null){const done=new Promise(r=>child.once('exit',r));if(child.connected)child.send('shutdown');await Promise.race([done,pause(3000)]);if(child.exitCode===null)child.kill();}
 for(const file of files){const dir=dirname(file),name=basename(file);if((dir===resolve(root,'render/output')||dir===resolve(root,'render/rendered'))&&(/^(?:vitest_lifecycle_|news_[a-f\d-]+\.(jpg|png)$)/i.test(name)))rmSync(file,{force:true});}
 // Failed disposable requests leave only their own UUID HTML diagnostic files.
 for(const name of readdirSync(join(root,'render/rendered')))if(name.startsWith('vitest_lifecycle_'))rmSync(join(root,'render/rendered',name),{force:true});
});
it('a Match page deadline leaves concurrent News and subsequent Match work healthy',async()=>{
 const [bad,good]=await Promise.all([post('/render',match('hang','HANG_MATCH')),post('/render-news',news())]);
 expect(bad.status).toBe(500);expect(good.status).toBe(200);const rendered=await output(good);expect(await sharp(readFileSync(rendered.image_path)).metadata()).toMatchObject({width:2160,height:2700,format:'png'});
 const recovered=await post('/render',match('recovered','RECOVERED'));expect(recovered.status).toBe(200);await output(recovered);expect(log).toContain('Render page deadline exceeded');expect(log).not.toContain('Shared browser was closed');
});
it('repeated shutdown requests drain active and queued Match/News jobs before browser closure',async()=>{
 const tasks=[post('/render',match('drain_a','DRAIN_MATCH')),post('/render',match('drain_b','DRAIN_MATCH')),post('/render',match('drain_c','DRAIN_MATCH')),post('/render-news',news())];
 const start=Date.now();while((await health()).inflight<4){if(Date.now()-start>3000)throw Error('Expected four admitted requests');await pause(20);}
 const exit=new Promise<number|null>(resolve=>child.once('exit',resolve));child.send('shutdown');child.send('shutdown');
 const responses=await Promise.all(tasks);expect(responses.map(r=>r.status)).toEqual([200,200,200,200]);const results=await Promise.all(responses.map(output));expect(new Set(results.map(r=>r.image_path)).size).toBe(4);for(const result of results)expect(readFileSync(result.image_path).length).toBeGreaterThan(0);
 expect(await exit).toBe(0);expect(log).not.toContain('Shared browser was closed');
});
