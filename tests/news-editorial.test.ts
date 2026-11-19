import {describe,it,expect} from 'vitest';
import {buildHtml} from '../src/lib/news/html';
import {editorialTransition,EDITORIAL_TEMPLATES} from '../src/lib/news/editorial';
import type {Job} from '../src/lib/news/parse';

describe('additional News editorial designs',()=>{
  for(const template of Object.keys(EDITORIAL_TEMPLATES) as (keyof typeof EDITORIAL_TEMPLATES)[])it('builds safe, bounded '+template+' with multiline highlights',()=>{
    const job:Job={layout:'single',author:'',quote:'Headline',caption:'',pos:{b:[50,50,1],c:[50,30,1]},editorial:{template,headline:'THE *NEXT\nCHAPTER* <script>alert(1)</script>',subtitle:'Editable *subtitle*'}};
    const html=buildHtml(job,Buffer.from('unchanged-background'),null);
    expect(html).toContain('<span class="yellow">NEXT\nCHAPTER</span>');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('border:3px solid');expect(html).toContain('height:3px;background:');expect(html).toContain('rgba(0,0,0,.92) 90%,#000 100%');expect(html).toContain('.frame #headline{font-size:68px;line-height:1.04;text-align:center}');expect(html).toContain('data-ready');expect(html).toContain(Buffer.from('unchanged-background').toString('base64'));
    expect(()=>buildHtml({...job,editorial:{...job.editorial!,headline:'x'.repeat(301)}},Buffer.from('photo'),null)).toThrow('Invalid editorial');
  });
  for(const template of ['news-red','did-you-know'] as const)it('selects and renders both versions of '+template,()=>{
    const now=4_000_000;
    const choice=editorialTransition({text:EDITORIAL_TEMPLATES[template]},{background:'source',ts:now},now)!;
    expect(choice.pending).toMatchObject({step:'version'});
    expect(editorialTransition({text:'invalid'},choice.pending,now)).toHaveProperty('replyOptions');
    for(const version of [1,2] as const){
      const selected=editorialTransition({text:'Version '+version},choice.pending,now)!;
      expect(selected.pending).toMatchObject({step:'headline',version});
      const result=editorialTransition({text:'A *great* headline'},selected.pending,now)!;
      expect(result).toHaveProperty('job.editorial.version',version);
      if(!('job' in result)||!result.job)throw Error('Missing job');
      const html=buildHtml(result.job,Buffer.from('source'),null);
      expect(html).toContain('<span class="yellow">great</span>');
      expect(html.includes('border-radius:2px;background:')).toBe(version===2);
      if(version===2)expect(html).toContain(template==='news-red'?'#e8444b':'#e8c451');
    }
  });
  it('keeps standings, legacy text, cancel, expiration and replacement uploads available',()=>{
    const now=4_000_000,p={background:'source',ts:now};
    expect(editorialTransition({text:'Author | old workflow'},p,now)).toBeNull();
    expect(editorialTransition({text:'NEWS (Red)'},{...p,kind:'standings'},now)).toBeNull();
    const choice=editorialTransition({text:'Headline + Subtitle'},p,now)!;
    expect(editorialTransition({text:'/cancel'},choice.pending,now)).toBeNull();
    expect(editorialTransition({photo:[{file_id:'replacement'}]},choice.pending,now)).toBeNull();
    expect(editorialTransition({text:'Old'},choice.pending,now+3_600_001)).toBeNull();
    expect(editorialTransition({text:'x'.repeat(301)},choice.pending,now)).toHaveProperty('reply');
  });
});
