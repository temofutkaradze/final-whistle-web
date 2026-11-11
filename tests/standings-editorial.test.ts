import {describe,it,expect,vi} from 'vitest';
import sharp from 'sharp';
import {tinyApng} from './helpers/image-fixtures';
import {newsImageFileId,originalNewsTransition} from '../src/lib/news/conversation';
import {standingsTransition,createStandingsService} from '../src/lib/news/standings';
import {buildStandingsHtml,standingsGeometry,standingsComposition} from '../src/lib/news/standings-html';
import {CLUB_DISPLAY_NAMES,clubDisplayName,displayNameCollisions} from '../src/lib/news/club-display-names';
import {fictionalTable} from './standings-fixture';
// @ts-expect-error Existing CommonJS renderer helper has no declaration file.
import {prepareStandingsBackground,normalizeStandingsCrest} from '../render/standings-artwork.js';

describe('shared News and standings image-input hints',()=>{
  for(const mime of ['image/jpeg','image/jpg','image/pjpeg','application/octet-stream',undefined])it('accepts IMG_8334.JPG with '+String(mime)+' without trusting its bytes',()=>{
    const message={document:{file_id:'original-jpg',file_name:'IMG_8334.JPG',mime_type:mime},caption:'Premier League 1 2 3'};
    expect(newsImageFileId(message)).toBe('original-jpg');
    expect(originalNewsTransition(message,null,Date.now())).toMatchObject({pending:{background:'original-jpg'}});
    expect(standingsTransition(message,null,Date.now())).toMatchObject({background:'original-jpg',request:{leagueId:39,positions:[1,2,3]}});
  });
  it('supports PNG/WebP filenames, largest photo and denies non-image documents',()=>{
    for(const name of ['photo.PNG','photo.webp','photo.jpeg'])expect(newsImageFileId({document:{file_id:'image',file_name:name}})).toBe('image');
    expect(newsImageFileId({photo:[{file_id:'small'},{file_id:'large'}]})).toBe('large');
    expect(newsImageFileId({document:{file_id:'pdf',file_name:'x.pdf',mime_type:'application/pdf'}})).toBeUndefined();
  });
});
describe('standings-only photo and crest preparation',()=>{
  it('does not resize, blur or manufacture another photograph layer',async()=>{
    const bytes=await sharp({create:{width:200,height:100,channels:3,background:'#448899'}}).jpeg().toBuffer();
    const metadata=await sharp(bytes).metadata();
    const blur=vi.spyOn(sharp.prototype,'blur'),resize=vi.spyOn(sharp.prototype,'resize');
    try{expect(await prepareStandingsBackground(bytes,metadata)).toEqual({primary:bytes});expect(blur).not.toHaveBeenCalled();expect(resize).not.toHaveBeenCalled();}
    finally{blur.mockRestore();resize.mockRestore();}
  });
  for(const [width,height] of [[160,240],[200,200],[320,180]])it('keeps original JPEG bytes and aspect '+width+'x'+height,async()=>{
    const bytes=await sharp({create:{width,height,channels:3,background:'#427d96'}}).jpeg().toBuffer();
    const result=await prepareStandingsBackground(bytes,await sharp(bytes).metadata());expect(result.primary).toBe(bytes);
    expect(await sharp(result.primary).metadata()).toMatchObject({width,height,format:'jpeg'});expect(Object.keys(result)).toEqual(['primary']);
  });
  it('normalizes EXIF orientation losslessly before primary display',async()=>{
    const bytes=await sharp({create:{width:120,height:60,channels:3,background:'#427d96'}}).jpeg().withMetadata({orientation:6}).toBuffer();
    const result=await prepareStandingsBackground(bytes,await sharp(bytes).metadata());expect(await sharp(result.primary).metadata()).toMatchObject({width:60,height:120,format:'png'});
    expect((await sharp(result.primary).metadata()).orientation).toBeUndefined();
  });
  it('rejects animation even if Sharp reports only the first PNG frame',async()=>{
    const bytes=tinyApng(2);await expect(prepareStandingsBackground(bytes,await sharp(bytes).metadata())).rejects.toThrow();
  });
  it('removes only transparent crest padding, retaining every painted pixel',async()=>{
    const core=await sharp({create:{width:16,height:24,channels:4,background:'#ff8800'}}).png().toBuffer();
    const padded=await sharp({create:{width:100,height:100,channels:4,background:'#00000000'}}).composite([{input:core,left:35,top:25}]).png().toBuffer();
    const result=await normalizeStandingsCrest(padded);const clean=result.png;expect(result.lightBacking).toBe(false);expect(await sharp(clean).metadata()).toMatchObject({width:16,height:24});
    expect(await sharp(clean).raw().toBuffer()).toEqual(await sharp(core).raw().toBuffer());
  });
  it('adds a neutral backing only for dark monochrome marks without recoloring them',async()=>{
    const dark=await sharp({create:{width:8,height:12,channels:4,background:'#111111'}}).png().toBuffer();
    const result=await normalizeStandingsCrest(dark);expect(result.lightBacking).toBe(true);expect(await sharp(result.png).raw().toBuffer()).toEqual(await sharp(dark).raw().toBuffer());
  });
  it('rejects corrupt inputs, transparent logos and pixel bombs',async()=>{
    await expect(normalizeStandingsCrest(Buffer.from('not an image'))).rejects.toThrow();
    const empty=await sharp({create:{width:8,height:8,channels:4,background:'#00000000'}}).png().toBuffer();await expect(normalizeStandingsCrest(empty)).rejects.toThrow('Empty');
    const big=await sharp({create:{width:1025,height:1025,channels:3,background:'#fff'}}).png().toBuffer();await expect(normalizeStandingsCrest(big)).rejects.toThrow();
  });
});
describe('editorial standings layout contract',()=>{
  for(const league of [39,140,135,78,61,2])it('retains data and shared accents for league '+league,async()=>{
    const job=await createStandingsService({id:'fixture',getCurrentTable:()=>fictionalTable(league)})(league,[3,1,2]);
    const html=buildStandingsHtml(job,Buffer.from('photo'));
    expect(html).toContain('.table:after{content:');expect(html).toContain('inset:0;border:2px solid transparent;border-radius:inherit');expect(html).toContain('mask-composite:exclude');
    expect(html).toContain('.background{position:absolute;inset:0;width:100%;height:100%;object-fit:cover');expect(html).not.toContain('backdrop');expect(html).not.toMatch(/blur\(/);expect(html).toContain('white-space:nowrap');expect(html).not.toContain('Retrieved');expect(html).not.toContain('<footer>');expect(html).toContain('FICTIONAL PREVIEW');expect(job.caption).toContain(job.standings.source);
    expect([...html.matchAll(/class="number rank">(\d+)</g)].map(m=>Number(m[1]))).toEqual([3,1,2]);expect(html).not.toMatch(/src="https?:/);
  });
  it('keeps mandatory provider attribution in the Telegram caption rather than the artwork',async()=>{
    const t=await fictionalTable();t.source='Football data provided by the Football-Data.org API';
    const job=await createStandingsService({id:'fixture',getCurrentTable:async()=>t})(39,[1,2,3]);
    expect(job.caption).toContain(t.source);expect(buildStandingsHtml(job,Buffer.from('photo'))).not.toContain(t.source);
  });
  it('keeps dense full-league geometry on canvas and compact selections lower',()=>{
    for(const count of [1,3,4,6,18,20,36])expect(standingsGeometry(count).rowHeight*count+130).toBeLessThan(1200);
    expect(standingsGeometry(6).rowHeight).toBeLessThan(standingsGeometry(3).rowHeight);
  });
});


describe('deterministic composition controls',()=>{
  it('uses a top-biased portrait default and compact dedicated 3/4-row geometry',()=>{
    expect(standingsComposition()).toEqual({backgroundX:50,backgroundY:22,panelOffset:0});
    expect(standingsGeometry(3)).toEqual({rowHeight:72,font:29,headerHeight:78,bottom:46,padding:10});
    expect(standingsGeometry(4)).toEqual({rowHeight:68,font:28,headerHeight:78,bottom:46,padding:10});
    for(const count of [1,2,3,4,6,18,20,36]){const g=standingsGeometry(count);expect(g.rowHeight*count+g.headerHeight+g.padding+g.bottom+2+200).toBeLessThan(1350);}
  });
  it('accepts only bounded finite numeric controls',()=>{
    expect(standingsComposition({backgroundX:0,backgroundY:100,panelOffset:80})).toEqual({backgroundX:0,backgroundY:100,panelOffset:80});
    for(const bad of [{backgroundX:-1},{backgroundY:101},{panelOffset:-21},{panelOffset:201},{backgroundY:NaN},{backgroundX:Infinity},{backgroundX:'50%;color:red'},null,[]])expect(()=>standingsComposition(bad as never)).toThrow();
    for(const bad of [0,65,1.5,NaN])expect(()=>standingsGeometry(bad)).toThrow();
  });
  it('renders one photo with explicit X/Y and panel offset without mutating source data',async()=>{
    const job=await createStandingsService({id:'fixture',getCurrentTable:()=>fictionalTable()})(39,[3,1,2]);
    job.composition={backgroundX:25,backgroundY:10,panelOffset:20};
    const original=structuredClone(job);const html=buildStandingsHtml(job,Buffer.from('photo'));
    expect(html).toContain('object-position:25% 10%');expect(html).toContain('bottom:66px');
    expect([...html.matchAll(/class="background"/g)]).toHaveLength(1);expect(html).not.toContain('class="backdrop"');expect(job).toEqual(original);
  });
});

describe('English artwork display names',()=>{
  const required={"81": "Barcelona", "78": "Atletico M.", "86": "Real Madrid", "90": "Real Betis", "108": "Inter Milan", "65": "Man City", "66": "Man United", "57": "Arsenal", "64": "Liverpool", "61": "Chelsea", "73": "Tottenham", "67": "Newcastle", "397": "Brighton", "76": "Wolves", "351": "Nottingham Forest", "5": "Bayern Munich", "4": "Dortmund", "3": "Leverkusen", "524": "PSG", "516": "Marseille", "523": "Lyon", "548": "Monaco", "109": "Juventus", "98": "AC Milan", "100": "Roma", "113": "Napoli", "102": "Atalanta"};
  for(const [teamId,name] of Object.entries(required))it('uses the approved label for '+teamId,()=>{
    expect(clubDisplayName({teamId,name:'Original provider identity'})).toEqual({name,needsReview:false});
  });
  it('retains unknown provider names, meaningful prefixes and HTML-escaped output',async()=>{
    for(const teamId of ['999999','toString','__proto__'])expect(clubDisplayName({teamId,name:'Real Athletic Football Club'})).toEqual({name:'Real Athletic Football Club',needsReview:true});
    const t=await fictionalTable();t.rows[0].name='Real Athletic <Club>';const job=await createStandingsService({id:'fixture',getCurrentTable:async()=>t})(39,[1]);
    expect(buildStandingsHtml(job,Buffer.from('photo'))).toContain('data-name-review="true">Real Athletic &lt;Club&gt;');
  });
  it('changes artwork names only, never official positions, ordering, names or statistics',async()=>{
    const t=await fictionalTable();Object.assign(t.rows[0],{teamId:'108',name:'FC Internazionale Milano'});
    const job=await createStandingsService({id:'fixture',getCurrentTable:async()=>t})(39,[1,3,2]);const snapshot=structuredClone(job);
    const html=buildStandingsHtml(job,Buffer.from('photo'));expect(html).toContain('data-name-review="false">Inter Milan');expect(html).not.toContain('FC Internazionale Milano');expect(job).toEqual(snapshot);
  });
  it('has no colliding reviewed labels and detects potential future collisions',()=>{
    expect(displayNameCollisions()).toEqual([]);expect(displayNameCollisions({'1':'United','2':' united '})).toEqual([['1','2']]);
    expect(new Set(Object.values(CLUB_DISPLAY_NAMES)).size).toBe(Object.keys(CLUB_DISPLAY_NAMES).length);
  });
  // Independent current-season membership snapshot from six read-only /teams responses, 2026-11-11.
  const currentInventories={"PL": [57, 58, 61, 62, 63, 64, 65, 66, 67, 71, 73, 322, 341, 349, 351, 354, 397, 402, 1044, 1076], "PD": [77, 78, 79, 80, 81, 82, 84, 86, 87, 88, 90, 92, 94, 95, 263, 285, 558, 559, 560, 5335], "SA": [98, 99, 100, 102, 103, 104, 107, 108, 109, 110, 112, 113, 115, 454, 470, 471, 586, 5890, 5911, 7397], "BL1": [1, 2, 3, 4, 5, 6, 7, 10, 12, 15, 16, 17, 18, 19, 28, 29, 719, 721], "FL1": [511, 512, 516, 519, 521, 522, 523, 524, 525, 529, 531, 532, 533, 535, 546, 548, 576, 1045], "CL": [4, 5, 10, 57, 58, 64, 65, 66, 78, 81, 86, 90, 94, 100, 108, 113, 498, 503, 521, 524, 546, 610, 613, 674, 675, 721, 851, 930, 1887, 1899, 2016, 5720, 5721, 7397, 7509, 10233]};
  for(const [code,ids] of Object.entries(currentInventories))it('covers every current '+code+' club including promoted teams',()=>{
    expect(ids.length).toBe(code==='CL'?36:code==='BL1'||code==='FL1'?18:20);
    for(const id of ids)expect(clubDisplayName({teamId:String(id),name:'Provider original'}).needsReview).toBe(false);
  });
});
