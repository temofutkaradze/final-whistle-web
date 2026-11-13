import {afterEach,it,expect,vi} from 'vitest';
import path from 'node:path';
import {renderNewsPost} from '../src/lib/news/render';
import {buildOriginalJob} from '../src/lib/news/parse';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('accepts native PNG output and retains the existing renderer path restrictions',async()=>{
  vi.stubEnv('NEWS_RENDER_SECRET','fictional-test-key');
  const job=buildOriginalJob('Author | Quote',false),file=path.resolve('render/output/news_abcd.png');
  const fetcher=vi.fn(async()=>Response.json({png_path:file}));vi.stubGlobal('fetch',fetcher);
  expect(await renderNewsPost(job,Buffer.from('original'),null)).toBe(file);
  fetcher.mockImplementationOnce(async()=>Response.json({png_path:path.resolve('storage/news_abcd.png')}));
  await expect(renderNewsPost(job,Buffer.from('original'),null)).rejects.toThrow('Unexpected News renderer output path');
  fetcher.mockImplementationOnce(async()=>Response.json({png_path:path.resolve('render/output/news_abcd.jpg')}));
  await expect(renderNewsPost(job,Buffer.from('original'),null)).rejects.toThrow('Unexpected News renderer output path');
});
