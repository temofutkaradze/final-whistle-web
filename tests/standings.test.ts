import {describe,it,expect,vi} from 'vitest';
import {parsePositions,identifyLeague,standingsTransition,createStandingsService,validateTable,selectPositions,DISABLED_MESSAGE,seasonEndExclusive} from '../src/lib/news/standings';
import {mapFootballData} from '../src/lib/news/standings-adapters';
import {buildStandingsHtml} from '../src/lib/news/standings-html';
import {fictionalTable} from './standings-fixture';
// @ts-expect-error Runtime JavaScript module has no declaration file.
import {createNewsHandler} from '../scripts/lib/news-core.mjs';

describe('standings domain and adapters',()=>{
  it('keeps exact unique requested order and validates integer syntax',()=>{expect(parsePositions('15 1 15 20')).toEqual([15,1,20]);for(const value of ['','0','-1','1.2','1 x','65','1e2','9'.repeat(250)])expect(()=>parsePositions(value)).toThrow();expect(identifyLeague(' La Liga ')).toBe(140);});
  it('selects arbitrary ranks, rejects absent rows and incomplete/stale/historical tables',async()=>{const t=await fictionalTable();expect(selectPositions(t,[20,1,5]).map(r=>r.position)).toEqual([20,1,5]);expect(()=>selectPositions(t,[21])).toThrow();for(const bad of [{...t,rows:t.rows.slice(0,5)},{...t,fetchedAt:0},{...t,seasonEnd:'2020-01-01'},{...t,rows:t.rows.map(()=>t.rows[0])},{...t,leagueLogo:'<svg/>'}])expect(()=>validateTable(bad,39)).toThrow();});
  it('maps a single current TOTAL table and refuses group/duplicate/incomplete responses',async()=>{const t=await fictionalTable();const raw={competition:{code:'PL'},season:{startDate:t.seasonStart,endDate:t.seasonEnd},standings:[{type:'TOTAL',stage:'REGULAR_SEASON',group:null,table:t.rows.map(r=>({position:r.position,team:{id:Number(r.teamId),name:r.name},playedGames:r.played,goalDifference:r.goalDifference,points:r.points}))}]};const assets={leagueLogo:t.leagueLogo,teamCrests:Object.fromEntries(t.rows.map(r=>[r.teamId,r.crest]))};expect(mapFootballData(raw,39,20,assets).rows).toHaveLength(20);for(const bad of [{...raw,competition:{code:'PD'}},{...raw,standings:[...raw.standings,...raw.standings]},{...raw,standings:[{...raw.standings[0],table:raw.standings[0].table.slice(0,5)}]}])expect(()=>mapFootballData(bad,39,20,assets)).toThrow();});
  it('has bounded cached/in-flight fetches, no mock fallback and preserves order',async()=>{let clock=Date.now();const getCurrentTable=vi.fn(async()=>fictionalTable(39,clock));const service=createStandingsService({id:'test-only',getCurrentTable},()=>clock);const results=await Promise.all([service(39,[3,1]),service(39,[2])]);expect(getCurrentTable).toHaveBeenCalledTimes(1);expect(results[0].standings.rows.map(r=>r.position)).toEqual([3,1]);results[0].standings.rows[0].name='mutation';expect((await service(39,[3])).standings.rows[0].name).not.toBe('mutation');clock+=16*60_000;await service(39,[1]);expect(getCurrentTable).toHaveBeenCalledTimes(2);getCurrentTable.mockRejectedValueOnce(Error('private credential'));clock+=16*60_000;await expect(service(39,[1])).rejects.toThrow('unavailable');await expect(createStandingsService(null)(39,[1])).rejects.toThrow(DISABLED_MESSAGE);});
  it('escapes text, uses shared accents and contains no external image references',async()=>{const t=await fictionalTable();t.rows[0].name='<img src=x onerror=alert(1)>';const job=await createStandingsService({id:'test',getCurrentTable:async()=>t})(39,[1,2]);const html=buildStandingsHtml(job,Buffer.from('test'));expect(html).toContain('&lt;img');expect(html).toContain('#6b2bff');expect(html).toContain('object-fit:cover');expect(html).not.toMatch(/src="https?:/);});
});

describe('standings conversation',()=>{
  const now=Date.now(),photo={photo:[{file_id:'small'},{file_id:'largest'}]};
  it('supports one caption and two-line captions',()=>{for(const caption of ['Premier League 15 16 17 18','Premier League\n15 16 17 18'])expect(standingsTransition({...photo,caption},null,now)).toMatchObject({background:'largest',request:{leagueId:39,positions:[15,16,17,18]}});});
  it('supports photo then league then ordered positions and explicit standings-first',()=>{const league=standingsTransition({text:'La Liga'},{background:'saved',ts:now},now)!;expect(league).toMatchObject({pending:{kind:'standings',background:'saved',leagueId:140}});expect(standingsTransition({text:'20 1 2'},league.pending,now)).toMatchObject({background:'saved',request:{positions:[20,1,2]}});const start=standingsTransition({text:'/standings Premier League 1 2'},null,now)!;expect(start).toMatchObject({reply:expect.stringContaining('background')});expect(standingsTransition(photo,start.pending,now)).toMatchObject({request:{leagueId:39}});});
  it('does not hijack ordinary News; rejects unknown leagues and supports cancel/expiry',()=>{expect(standingsTransition({...photo,caption:'ordinary ignored news caption'},null,now)).toBeNull();expect(standingsTransition({text:'Author | Headline'},null,now)).toBeNull();expect(standingsTransition({...photo,caption:'Unknown League 1 2'},null,now)).toBeNull();const pending={kind:'standings',ts:now,background:'x',leagueId:39};expect(standingsTransition({text:'/cancel'},pending,now)).toMatchObject({pending:null});expect(standingsTransition({text:'1 2'},{...pending,ts:0},now)).toBeNull();});
});

function bot(service?:ReturnType<typeof createStandingsService>){
  const settings:any={userId:'owner',botToken:'test-token',telegramChatId:'42',pending:null,lastUpdateId:null,defaultTemplateRef:'single'};
  const table={findUnique:vi.fn(async()=>structuredClone(settings)),updateMany:vi.fn(async({where,data}:any)=>{if(('lastUpdateId' in where&&where.lastUpdateId!==settings.lastUpdateId)||where.botToken!==settings.botToken||('telegramChatId' in where&&where.telegramChatId!==settings.telegramChatId)||where.OR&&settings.lastUpdateId!==null&&settings.lastUpdateId>=where.OR[1].lastUpdateId.lt)return {count:0};Object.assign(settings,data);return {count:1};})};
  const tg={sendMessage:vi.fn(async()=>({ok:true})),sendDocument:vi.fn(async()=>({ok:true}))},download=vi.fn(async()=>Buffer.from('photo')),render=vi.fn(async(_job:unknown,_background:Buffer,_circle:Buffer|null)=>'/fake/news_test.jpg'),cleanup=vi.fn(async()=>{});
  const handle=createNewsHandler({prisma:{newsSettings:table},ownerId:'owner',connectionToken:'test-token',tg,download,render,cleanup,standings:service,onDiagnostic:vi.fn()});
  const update=(id:number,message:object,chat=42)=>({update_id:id,message:{chat:{type:'private',id:chat},from:{id:chat},...message}});
  return {settings,tg,download,render,cleanup,handle,update};
}
describe('authorized News bot standings integration',()=>{
  it('sends exactly one document for caption duplicate updates',async()=>{const f=bot(createStandingsService({id:'test',getCurrentTable:()=>fictionalTable()}));const u=f.update(1,{photo:[{file_id:'photo'}],caption:'Premier League 15 16 17 18'});await f.handle(u);await f.handle(u);expect(f.render).toHaveBeenCalledTimes(1);expect(f.render.mock.calls[0]?.[0]).toMatchObject({layout:'standings',standings:{rows:expect.arrayContaining([expect.objectContaining({position:18})])}});expect(f.tg.sendDocument).toHaveBeenCalledTimes(1);expect(f.settings.pending.stage).toBe('delivered');expect(f.cleanup).toHaveBeenCalledTimes(1);});
  it('collects separate messages without disturbing News image collection',async()=>{const f=bot(createStandingsService({id:'test',getCurrentTable:()=>fictionalTable()}));await f.handle(f.update(1,{photo:[{file_id:'photo'}]}));await f.handle(f.update(2,{text:'Premier League'}));await f.handle(f.update(3,{text:'1 5 20'}));expect(f.render).toHaveBeenCalledTimes(1);});
  it('default disabled source gives a clear reply before photo download',async()=>{const f=bot();await f.handle(f.update(1,{photo:[{file_id:'p'}],caption:'Premier League 1 2'}));expect(f.download).not.toHaveBeenCalled();expect(f.render).not.toHaveBeenCalled();expect(f.tg.sendMessage).toHaveBeenCalledWith('42',DISABLED_MESSAGE);});
  it('unauthorized sender cannot call provider, download or render',async()=>{const getCurrentTable=vi.fn(()=>fictionalTable());const f=bot(createStandingsService({id:'test',getCurrentTable}));await f.handle(f.update(1,{photo:[{file_id:'p'}],caption:'Premier League 1 2'},99));expect(getCurrentTable).not.toHaveBeenCalled();expect(f.download).not.toHaveBeenCalled();});
  it('never retries an ambiguous document send on a duplicate update',async()=>{const f=bot(createStandingsService({id:'test',getCurrentTable:()=>fictionalTable()}));f.tg.sendDocument.mockRejectedValueOnce(Error('timeout'));const u=f.update(1,{photo:[{file_id:'p'}],caption:'Premier League 1 2'});await f.handle(u);await f.handle(u);expect(f.tg.sendDocument).toHaveBeenCalledTimes(1);expect(f.settings.pending.stage).toBe('sending');});
});

describe('Champions League Telegram and domain validation',()=>{
  for(const caption of ['Champions League 1 2 3','UCL 1 2 3 4','CL 9 10 11 12','Champions League 24 25 26','Champions League 33 34 35 36'])it('recognizes '+caption,()=>{
    expect(standingsTransition({photo:[{file_id:'photo'}],caption},null,Date.now())).toMatchObject({background:'photo',request:{leagueId:2,positions:parsePositions(caption.replace(/^(Champions League|UCL|CL) /,''))}});
  });
  it('allows exactly 36 CL teams and keeps domestic size bounds unchanged',async()=>{
    const cl=await fictionalTable(2);expect(validateTable(cl,2).rows).toHaveLength(36);
    expect(()=>validateTable({...cl,rows:cl.rows.slice(0,35)},2)).toThrow();
    expect(()=>validateTable({...cl,totalTeams:35,rows:cl.rows.slice(0,35)},2)).toThrow();
    expect(()=>validateTable({...cl,leagueId:39},39)).toThrow();
    const domestic=await fictionalTable();expect(validateTable(domestic,39).rows).toHaveLength(20);
    expect(validateTable({...domestic,leagueId:78,totalTeams:18,rows:domestic.rows.slice(0,18)},78).rows).toHaveLength(18);
  });
  it('uses existing UCL accent colors and branding',async()=>{
    const job=await createStandingsService({id:'fixture',getCurrentTable:()=>fictionalTable(2)})(2,[36,1]);
    const html=buildStandingsHtml(job,Buffer.from('sample'));expect(html).toContain('#35efd1');expect(html).toContain('UEFA CHAMPIONS LEAGUE');
    expect(job.standings.rows.map(r=>r.position)).toEqual([36,1]);
  });
});

describe('UCL official ties and display-row semantics',()=>{
  async function tied(){const table=await fictionalTable(2);table.rows[28].teamId='1899';table.rows[29].teamId='721';table.rows[29].position=29;return table;}
  it('retains tied ranks in arbitrary requested row order, caption and HTML',async()=>{
    const table=await tied();expect(validateTable(table,2).rows).toHaveLength(36);
    const service=createStandingsService({id:'fictional',getCurrentTable:async()=>table});
    const job=await service(2,[28,29,30,31]);expect(job.standings.rows.map(r=>r.position)).toEqual([28,29,29,31]);
    expect(job.caption).toContain('display rows: 28, 29, 30, 31');
    expect(job.caption).toContain('official ranks');
    expect(buildStandingsHtml(job,Buffer.from('background')).match(/class="number rank">29</g)).toHaveLength(2);
    const reversed=await service(2,[31,30,29]);expect(reversed.standings.rows.map(r=>r.displayRow)).toEqual([31,30,29]);
    expect(validateTable(reversed.standings,2,Date.now(),true)).toBe(reversed.standings);
    expect((await service(2,[30])).standings.rows[0].teamId).toBe('721');
  });
  it('keeps domestic official-position selection and duplicate-rank rejection unchanged',async()=>{
    const table=await fictionalTable();const shuffled={...table,rows:[...table.rows].reverse()};expect(selectPositions(shuffled,[1,5,20]).map(r=>r.position)).toEqual([1,5,20]);
    table.rows[1].position=1;expect(()=>validateTable(table,39)).toThrow();
  });
  it('rejects unknown tied identities, rank gaps, invalid display indices and incomplete tables',async()=>{
    for(const mutation of [(t:Awaited<ReturnType<typeof tied>>)=>{t.rows[29].teamId='unknown';},(t:Awaited<ReturnType<typeof tied>>)=>{t.rows[30].position=30;},(t:Awaited<ReturnType<typeof tied>>)=>{t.rows[30].displayRow=30;},(t:Awaited<ReturnType<typeof tied>>)=>{t.rows.pop();}]){const table=await tied();mutation(table);expect(()=>validateTable(table,2)).toThrow();}
  });
  it('does not carry verified abbreviated-name evidence into a different season',async()=>{const table=await tied();const clock=Date.parse('2027-11-01');table.fetchedAt=clock;table.seasonStart='2027-09-01';table.seasonEnd='2028-01-30';expect(()=>validateTable(table,2,clock)).toThrow('ordering needs review');});
  it('explains row selection in Telegram collection and authorized help',async()=>{
    expect(standingsTransition({text:'UCL'},{background:'photo',ts:Date.now()},Date.now())).toMatchObject({reply:expect.stringContaining('display rows 1-36')});
    const f=bot();await f.handle(f.update(1,{text:'/help'}));expect(f.tg.sendMessage).toHaveBeenCalledWith('42',expect.stringContaining('28, 29, 29, 31'));
  });
});


describe('pre-merge News routing and photo-state regressions',()=>{
  for(const text of ['Premier League | Title','La Liga | Title','Champions League | Title'])it('preserves ordinary News input '+text,async()=>{
    const source=vi.fn(()=>fictionalTable());const f=bot(createStandingsService({id:'fictional',getCurrentTable:source}));
    await f.handle(f.update(1,{photo:[{file_id:'news-background'}]}));await f.handle(f.update(2,{text}));
    expect(source).not.toHaveBeenCalled();expect(f.render).toHaveBeenCalledTimes(1);expect(f.render.mock.calls[0][0]).not.toMatchObject({layout:'standings'});expect(f.tg.sendDocument).toHaveBeenCalledTimes(1);
  });
  it('requires unambiguous implicit selection but keeps explicit validation',()=>{
    const now=Date.now();for(const text of ['Premier League | Title','Premier League news','Premier League 1 x','Premier League 0'])expect(standingsTransition({text},null,now)).toBeNull();
    expect(standingsTransition({text:'Premier League'},null,now)).toMatchObject({pending:{leagueId:39}});
    expect(standingsTransition({text:'/standings Premier League 0'},null,now)).toMatchObject({reply:expect.stringContaining('positive')});
  });
  it('retains photo B after invalid selection, deduplicates, then uses B on correction',async()=>{
    const f=bot(createStandingsService({id:'fictional',getCurrentTable:()=>fictionalTable()}));
    await f.handle(f.update(1,{photo:[{file_id:'photo-A'}]}));await f.handle(f.update(2,{text:'Premier League'}));
    const invalid=f.update(3,{photo:[{file_id:'photo-B'}],caption:'Premier League 21'});await f.handle(invalid);await f.handle(invalid);
    expect(f.settings.pending).toMatchObject({kind:'standings',background:'photo-B',leagueId:39,positions:[21]});expect(f.download).not.toHaveBeenCalled();
    const corrected=f.update(4,{text:'1 2'});await f.handle(corrected);await f.handle(corrected);
    expect(f.download).toHaveBeenCalledExactlyOnceWith('photo-B');expect(f.tg.sendDocument).toHaveBeenCalledTimes(1);expect(f.settings.pending.stage).toBe('delivered');
  });
  it('cancels a failed collection and starts a fresh News conversation',async()=>{
    const f=bot(createStandingsService({id:'fictional',getCurrentTable:()=>fictionalTable()}));
    await f.handle(f.update(1,{photo:[{file_id:'photo-B'}],caption:'Premier League 21'}));await f.handle(f.update(2,{text:'/cancel'}));expect(f.settings.pending).toEqual({});
    await f.handle(f.update(3,{photo:[{file_id:'photo-C'}]}));await f.handle(f.update(4,{text:'Author | New story'}));expect(f.download).toHaveBeenCalledExactlyOnceWith('photo-C');expect(f.render.mock.calls[0][0]).not.toMatchObject({layout:'standings'});
  });
  it('starts a new standings conversation after cancellation',async()=>{
    const f=bot(createStandingsService({id:'fictional',getCurrentTable:()=>fictionalTable()}));
    await f.handle(f.update(1,{photo:[{file_id:'old'}],caption:'Premier League 21'}));await f.handle(f.update(2,{text:'/cancel'}));
    await f.handle(f.update(3,{photo:[{file_id:'new'}],caption:'Premier League 1 2'}));expect(f.download).toHaveBeenCalledExactlyOnceWith('new');expect(f.tg.sendDocument).toHaveBeenCalledTimes(1);
  });
});

describe('standings authorization and revocation regressions',()=>{
  for(const kind of ['group','sender-mismatch','revoked-token','unlinked'])it('blocks '+kind+' before provider, download, render and delivery',async()=>{
    const source=vi.fn(()=>fictionalTable());const f=bot(createStandingsService({id:'fictional',getCurrentTable:source}));
    if(kind==='revoked-token')f.settings.botToken='replacement-test-token';if(kind==='unlinked')f.settings.telegramChatId=null;
    const u=f.update(1,{photo:[{file_id:'photo'}],caption:'Premier League 1 2'});
    if(kind==='group')u.message.chat.type='group';if(kind==='sender-mismatch')u.message.from.id=99;
    await f.handle(u);expect(source).not.toHaveBeenCalled();expect(f.download).not.toHaveBeenCalled();expect(f.render).not.toHaveBeenCalled();expect(f.tg.sendDocument).not.toHaveBeenCalled();
  });
  it('does not overwrite state or render after connection revocation during provider work',async()=>{
    let f:ReturnType<typeof bot>;const service=createStandingsService({id:'fictional',getCurrentTable:async()=>{f.settings.botToken='replacement';return fictionalTable();}});f=bot(service);
    await f.handle(f.update(1,{photo:[{file_id:'photo'}],caption:'Premier League 1 2'}));expect(f.download).not.toHaveBeenCalled();expect(f.render).not.toHaveBeenCalled();expect(f.tg.sendDocument).not.toHaveBeenCalled();expect(f.settings.pending).toBeNull();
  });
  it('does not save failed-request state or reply after revocation during provider work',async()=>{
    let f:ReturnType<typeof bot>;f=bot(createStandingsService({id:'fictional',getCurrentTable:async()=>{f.settings.botToken='replacement';throw Error('unavailable');}}));
    await f.handle(f.update(1,{photo:[{file_id:'photo'}],caption:'Premier League 1 2'}));expect(f.settings.pending).toBeNull();expect(f.tg.sendMessage).not.toHaveBeenCalled();expect(f.download).not.toHaveBeenCalled();expect(f.render).not.toHaveBeenCalled();expect(f.tg.sendDocument).not.toHaveBeenCalled();
  });
  it('blocks delivery when connection is revoked during rendering',async()=>{
    const f=bot(createStandingsService({id:'fictional',getCurrentTable:()=>fictionalTable()}));f.render.mockImplementationOnce(async()=>{f.settings.telegramChatId=null;return '/fake/news_test.jpg';});
    await f.handle(f.update(1,{photo:[{file_id:'photo'}],caption:'Premier League 1 2'}));expect(f.render).toHaveBeenCalledTimes(1);expect(f.tg.sendDocument).not.toHaveBeenCalled();expect(f.cleanup).toHaveBeenCalledTimes(1);
  });
});

describe('inclusive season-end boundaries',()=>{
  it('includes the final calendar day, rejects immediately after, and validates dates',async()=>{
    const midnight=Date.parse('2027-05-31T00:00:00Z');const table=await fictionalTable(39,midnight-1);table.seasonStart='2026-08-21';table.seasonEnd='2027-05-30';
    expect(seasonEndExclusive(table.seasonEnd)).toBe(midnight);expect(validateTable(table,39,midnight-1)).toBe(table);expect(()=>validateTable(table,39,midnight)).toThrow();
    expect(Number.isNaN(seasonEndExclusive('2027-02-30'))).toBe(true);expect(Number.isNaN(seasonEndExclusive(null))).toBe(true);
    expect(seasonEndExclusive('2027-05-30T15:00:00Z')).toBe(Date.parse('2027-05-30T15:00:00Z'));
  });
  it('caches during the final day but refetches at expiry and accepts the next season',async()=>{
    let clock=Date.parse('2027-05-30T23:50:00Z');let next=false;
    const source=vi.fn(async()=>{const t=await fictionalTable(39,clock);t.seasonStart=next?'2027-05-31':'2026-08-21';t.seasonEnd=next?'2028-05-01':'2027-05-30';return t;});
    const service=createStandingsService({id:'fictional',getCurrentTable:source},()=>clock);
    await service(39,[1]);clock+=5*60_000;await service(39,[1]);expect(source).toHaveBeenCalledTimes(1);
    clock=Date.parse('2027-05-31T00:00:00Z');await expect(service(39,[1])).rejects.toThrow();expect(source).toHaveBeenCalledTimes(2);
    next=true;const job=await service(39,[1]);expect(job.standings.seasonStart).toBe('2027-05-31');expect(source).toHaveBeenCalledTimes(3);
  });
});
