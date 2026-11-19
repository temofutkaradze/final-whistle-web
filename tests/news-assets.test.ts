import {createRequire} from 'node:module';
import {expect,it,vi} from 'vitest';
import {buildHtml} from '../src/lib/news/html';
import {buildOriginalJob} from '../src/lib/news/parse';
const {createNewsAssets}=createRequire(import.meta.url)('../render/news-assets.js');
it('serves exact source bytes only within the owning render',async()=>{
  const assets=createNewsAssets(),other=createNewsAssets(),bytes=Buffer.from([137,80,78,71,1,2]);
  const url=assets.add(bytes),fulfill=vi.fn(),abort=vi.fn();
  const route={request:()=>({url:()=>url}),fulfill,abort};
  await assets.route(route);expect(fulfill).toHaveBeenCalledWith({status:200,body:bytes,contentType:'image/png'});
  await other.route(route);expect(abort).toHaveBeenCalledOnce();
  for(const url of ['file:///secret','https://example.com/photo','https://news-assets.invalid/missing'])await assets.route({request:()=>({url:()=>url}),abort});
  expect(abort).toHaveBeenCalledTimes(4);
});
it('changes only image references in template HTML, including Breaking and editorial',()=>{
  const bg=Buffer.from([137,80]),circle=Buffer.from([137,80,1]);
  for(const job of [buildOriginalJob('A | Quote',false),buildOriginalJob('L: A | Quote',true),
    {...buildOriginalJob('BREAKING | Text',false),breakingText:true},
    {...buildOriginalJob('A | Text',false),editorial:{template:'news-red' as const,version:2 as const,headline:'TEXT',subtitle:''}}]){
    const urls=new Map<Buffer,string>();const asset=(b:Buffer)=>{const u='https://news-assets.invalid/'+urls.size;urls.set(b,u);return u;};
    const routed=buildHtml(job,bg,circle,asset);
    let embedded=routed;for(const [b,u]of urls)embedded=embedded.replaceAll(u,'data:image/png;base64,'+b.toString('base64'));
    expect(embedded).toBe(buildHtml(job,bg,circle));
  }
});
