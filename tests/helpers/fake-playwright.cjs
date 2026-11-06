// Isolated renderer tests only: deterministic pixels and controllable failure overlap.
const Module=require('module'),fs=require('fs'),sharp=require('sharp');
const {fileURLToPath}=require('url');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const pixels=new Map(),failedOnce=new Set();let newsActive=0;
async function screenshot(page){
  if(page.browser.closed)throw Error('Shared browser was closed');
  if(page.html.includes('DRAIN_MATCH'))await pause(750);
  const color=page.html.includes('CONCURRENT_ALPHA')?'#a02020':page.html.includes('CONCURRENT_BETA')?'#2020a0':'#0a5028';
  if(!pixels.has(color))pixels.set(color,sharp({create:{width:2160,height:2700,channels:3,background:color}}).png().toBuffer());
  return pixels.get(color);
}
function newPage(browser){
  let guard=null;
  const page={browser,html:'',
    route:async(_pattern,handler)=>{guard=handler;},
    goto:async url=>{
      await pause(25); // Make overlapping same-ID HTML writes deterministic in regression tests.
      page.html=fs.readFileSync(fileURLToPath(url),'utf8');
      if(page.html.includes('FAIL_MATCH_ALWAYS')||(page.html.includes('FAIL_MATCH_ONCE')&&!failedOnce.has(url))){
        failedOnce.add(url);const until=Date.now()+1500;while(!newsActive&&Date.now()<until)await pause(10);
        throw Error('Injected Match navigation failure');
      }
      if(guard&&process.env.FW_PROBE_FILE){const decisions={};for(const url of JSON.parse(process.env.FW_PROBE_URLS||'[]')){
        let decision=null;await guard({request:()=>({url:()=>url,resourceType:()=>url.includes("fonts.googleapis.com")?"stylesheet":url.includes("fonts.gstatic.com")?"font":"image",headers:()=>({})}),continue:()=>{decision='allow';},fulfill:()=>{decision='allow';},abort:()=>{decision='block';}});decisions[url]=decision;
      }fs.writeFileSync(process.env.FW_PROBE_FILE,JSON.stringify(decisions));}
    },
    setContent:async html=>{page.html=html;},
    waitForFunction:async()=>{await pause(250);if(browser.closed)throw Error('Concurrent News context closed');},
    evaluate:async()=>page.html.includes('HANG_MATCH')?new Promise(()=>{}):null,
    screenshot:async()=>{if(process.env.FW_CAPTURE_PROBE)fs.appendFileSync(process.env.FW_CAPTURE_PROBE,JSON.stringify({standard:true})+'\n');return screenshot(page);},
    close:async()=>{},
  };return page;
}
function newBrowser(){const browser={closed:false,on(){},newContext:async options=>{
  const news=options?.viewport?.width===2160;if(news)newsActive++;
  return {newPage:async()=>newPage(browser),newCDPSession:async page=>({send:async()=>{if(process.env.FW_CAPTURE_PROBE)fs.appendFileSync(process.env.FW_CAPTURE_PROBE,JSON.stringify({standard:false})+'\n');if(page.html.includes('FAST_CAPTURE_ALWAYS'))throw Error('CDP capture temporarily unsupported');return {data:(await screenshot(page)).toString('base64')};},detach:async()=>{}}),close:async()=>{if(news)newsActive--;}};
},close:async()=>{browser.closed=true;}};return browser;}
const original=Module._load;
Module._load=function(request,...rest){
  if(request==='playwright')return {chromium:{launch:async()=>newBrowser()}};
  const value=original.call(this,request,...rest);
  if(request==='./operations.js'&&process.env.FW_TEST_PAGE_DEADLINE)return {...value,withPageDeadline:(page,work)=>value.withPageDeadline(page,work,Number(process.env.FW_TEST_PAGE_DEADLINE))};
  if(request==='./security.js')return {...value,downloadPublicResource:async url=>{
    if(process.env.FW_DOWNLOAD_PROBE)fs.appendFileSync(process.env.FW_DOWNLOAD_PROBE,JSON.stringify(url)+'\n');
    if(url.includes('/singleflight-'))await pause(250);
    throw Error('Mock image network unavailable');
  }};
  return value;
};
