// Standings-only image preparation. No network, AI or decorative image copies.
const sharp=require('sharp');
const {validateMatchImage}=require('./security.js');
async function prepareStandingsBackground(bytes,metadata){
  const verified=await validateMatchImage(bytes);
  if(!['jpeg','png','webp'].includes(verified.format)||verified.pages!==1)throw Error('Animated or unsupported standings photograph');
  const primary=!metadata.orientation||metadata.orientation===1?bytes:
    await sharp(bytes,{limitInputPixels:25_000_000}).rotate().png().toBuffer();
  // Chromium performs the single deterministic cover crop at capture resolution.
  // Preserve source bytes; never generate a blurred backdrop or JPEG intermediate.
  return {primary};
}
async function normalizeStandingsCrest(bytes){
  const {data,info}=await sharp(bytes,{limitInputPixels:1024*1024}).rotate()
    .toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let left=info.width,top=info.height,right=-1,bottom=-1,painted=0,darkNeutral=0;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]>0){
    const i=(y*info.width+x)*4,alpha=data[i+3]/255;
    painted+=alpha;
    const high=Math.max(data[i],data[i+1],data[i+2]),low=Math.min(data[i],data[i+1],data[i+2]);
    if(high<64&&high-low<24)darkNeutral+=alpha;
    left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);
  }
  if(right<left)throw Error('Empty standings crest');
  // Remove only fully transparent padding; every painted pixel is retained.
  const png=await sharp(data,{raw:{width:info.width,height:info.height,channels:4}})
    .extract({left,top,width:right-left+1,height:bottom-top+1}).png().toBuffer();
  return {png,lightBacking:darkNeutral/painted>.85};
}
module.exports={prepareStandingsBackground,normalizeStandingsCrest};
