import { getCurrentUser } from '@/lib/auth';
import { buildJob, normalizeNewsStyle, type Job } from '@/lib/news/parse';
import { newsPreviewImages } from '@/lib/news/preview';
import { renderNewsPost } from '@/lib/news/render';
import { readFile, unlink } from 'node:fs/promises';

export const runtime = 'nodejs';
const limits = new Map<string,{count:number;until:number}>();
export async function POST(request:Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({error:'Sign in to preview templates.'},{status:401});
  const origin=request.headers.get('origin');
  if (origin && origin!==new URL(request.url).origin) return Response.json({error:'Invalid origin'},{status:403});
  for (const [id,entry] of limits) if(entry.until<Date.now())limits.delete(id);
  const limit=limits.get(user.id)??{count:0,until:Date.now()+60_000};
  if (++limit.count>12) return Response.json({error:'Please wait a minute before another preview.'},{status:429});
  limits.set(user.id,limit);
  let payload;
  try {
    const reader=request.body?.getReader();
    if(!reader)throw new Error();
    const chunks:Uint8Array[]=[];let size=0;
    while(true){
      const part=await reader.read();if(part.done)break;
      size+=part.value.length;
      if(size>12_000){await reader.cancel();throw new Error();}
      chunks.push(part.value);
    }
    const body=Buffer.concat(chunks).toString('utf8');
    payload=JSON.parse(body);
    if(!payload||!['single','left','right','breaking'].includes(payload.layout))throw new Error();
  } catch {return Response.json({error:'Invalid preview settings.'},{status:400});}
  let output:string|undefined;
  try {
    const style=normalizeNewsStyle(payload.style);
    const layout=payload.layout as Job['layout'];
    const job=buildJob(layout==='breaking'?'BREAKING | A NEW CHAPTER FOR THE CLUB':'FINAL WHISTLE | THE NEXT CHAPTER\nSTARTS *HERE*', ['left','right'].includes(layout),layout,style);
    const {background,secondary}=await newsPreviewImages();
    output=await renderNewsPost(job,background,['left','right'].includes(layout)?secondary:null);
    const image=await readFile(output);
    return new Response(new Uint8Array(image),{headers:{'content-type':output.toLowerCase().endsWith('.png')?'image/png':'image/jpeg','cache-control':'no-store'}});
  } catch {return Response.json({error:'Preview unavailable. Check the local render server and NEWS_RENDER_SECRET.'},{status:503});}
  finally {if(output)await unlink(output).catch(()=>{});}
}
