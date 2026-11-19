import {afterEach,expect,it,vi} from 'vitest';
// @ts-expect-error Runtime module has no declaration file.
import {renderPost} from '../scripts/lib/render.mjs';
import {renderSamplePost} from '../src/lib/render';

afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('automatic/manual worker and dashboard wrappers require PNG-only output',async()=>{
  vi.stubEnv('NEWS_RENDER_SECRET','test-only');
  const fetcher=vi.fn(async()=>Response.json({png_path:'/fake/post.png',jpg_path:null}));
  vi.stubGlobal('fetch',fetcher);
  const calls=[()=>renderPost({fixture_id:'automatic',output_format:'jpeg'}),
    ()=>renderPost({fixture_id:'manual'}),
    ()=>renderSamplePost({id:'brand',name:'Test',templateRef:'classic',brandMode:'name',logoPath:null,backgroundUrl:null})];
  for(const call of calls){
    expect(await call()).toBe('/fake/post.png');
    const request=fetcher.mock.calls.at(-1) as unknown as [string,RequestInit];
    expect(JSON.parse(request[1].body as string).output_format).toBe('png');
    fetcher.mockImplementationOnce(async()=>Response.json({jpg_path:'/fake/post.jpg'}));
    await expect(call()).rejects.toThrow();
  }
});
