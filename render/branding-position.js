'use strict';
const fs=require('node:fs');
const path=require('node:path');
// The existing Match masthead: Montserrat Black Italic, 28px, white, three lines.
// Use one embedded font and one placement implementation for Match and News.
let fontData;
async function alignBranding(page){
  fontData??=fs.readFileSync(path.join(__dirname,'fonts/montserrat-black-italic.ttf')).toString('base64');
  return page.evaluate(async(data)=>{
    document.querySelectorAll('.branding,[data-football-branding]').forEach(el=>el.remove());
    if(![...document.fonts].some(f=>f.family==='Football Branding')){
      const face=new FontFace('Football Branding','url(data:font/ttf;base64,'+data+')',{style:'italic',weight:'900'});
      document.fonts.add(await face.load());
    }
    const scale=innerWidth/1080;
    const root=document.createElement('div');root.dataset.footballBranding='1';
    root.style.cssText='position:absolute;left:0;top:0;width:1080px;height:1350px;transform-origin:0 0;transform:scale('+scale+');pointer-events:none;z-index:2147483647;';
    const el=document.createElement('div');
    el.style.cssText='position:absolute;left:20px;top:0;color:#fff;font:italic 900 28px/.88 "Football Branding";letter-spacing:-1.25px;text-align:center;width:max-content;white-space:pre;';
    el.textContent='DAY\nON\nFOOTBALL';root.append(el);document.body.append(root);
    const ctx=document.createElement('canvas').getContext('2d');
    ctx.font='italic 900 28px "Football Branding"';ctx.letterSpacing='-1.25px';
    const first=ctx.measureText('DAY');
    const baseline=(28*.88-first.fontBoundingBoxAscent-first.fontBoundingBoxDescent)/2+first.fontBoundingBoxAscent;
    const inkTop=baseline-first.actualBoundingBoxAscent;
    // Align the visible top of the complete mark with its existing 20px left inset.
    el.style.top=(20-inkTop)+'px';
    return {inkTop:20,left:20,font:'Montserrat Black Italic',size:28};
  },fontData);
}
module.exports={alignBranding};
