
import type { StandingsJob } from "./standings.ts";
import type { Job } from "./parse.ts";
import path from 'node:path';


export class NewsRenderError extends Error {
  code: string;
  constructor(code:string,message:string){super(message);this.name='NewsRenderError';this.code=code;}
}
const endpoint=(pathname:string)=>new URL(pathname,process.env.RENDER_SERVER_URL??'http://127.0.0.1:4500/render').toString();
function headers(){
  const secret=process.env.NEWS_RENDER_SECRET;
  if(!secret)throw new NewsRenderError('NEWS_RENDER_AUTH','The local News render key is missing.');
  return {'content-type':'application/json','x-news-render-secret':secret};
}
function checkStatus(status:number){
  if(status===401||status===403)throw new NewsRenderError('NEWS_RENDER_AUTH','The renderer rejected the local News render key. Restart the renderer and bot with the same local configuration.');
  if(status===404)throw new NewsRenderError('NEWS_RENDER_PROTOCOL','The renderer is outdated or the configured address is incorrect. Restart the current project renderer.');
  if(status>=400)throw new NewsRenderError('NEWS_RENDER_FAILED','The local News renderer failed.');
}
export async function verifyNewsRenderer():Promise<void>{
  let response:Response;
  const auth=headers();
  try{response=await fetch(endpoint('/news-health'),{headers:auth,signal:AbortSignal.timeout(8000)});}
  catch{throw new NewsRenderError('NEWS_RENDER_UNAVAILABLE','The local renderer cannot be reached.');}
  checkStatus(response.status);
  let data;
  try{data=await response.json();}catch{throw new NewsRenderError('NEWS_RENDER_PROTOCOL','The renderer returned an invalid health response.');}
  if(data.service!=='final-whistle-news'||data.protocolVersion!==2)throw new NewsRenderError('NEWS_RENDER_PROTOCOL','Restart the current project renderer before polling Telegram.');
}

export async function renderNewsPost(
  job: Job | StandingsJob,
  background: Buffer,
  circle: Buffer | null
): Promise<string> {
  const auth=headers();
  let response:Response;
  try { response = await fetch(endpoint('/render-news'), {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      job: {...job,pos:{
        b:job.pos.b.map((n,index)=>Number.isFinite(n)?n:[50,50,1][index]),
        c:job.pos.c.map((n,index)=>Number.isFinite(n)?n:[50,30,1][index]),
      }},
      background: background.toString("base64"),
      circle: circle ? circle.toString("base64") : null,
    }),
    signal: AbortSignal.timeout(120000),
  }); } catch { throw new NewsRenderError('NEWS_RENDER_UNAVAILABLE','The local renderer cannot be reached.'); }
  checkStatus(response.status);

  const data = (await response.json()) as {
    png_path?: string;
    jpg_path?: string;
    error?: string;
  };

  const imagePath=data.png_path??data.jpg_path;
  if (!response.ok || typeof imagePath!=='string') {
    throw new NewsRenderError('NEWS_RENDER_OUTPUT','The local renderer did not return an image.');
  }

  const output = path.resolve('render/output');
  const file = path.resolve(imagePath);
  const expected=data.png_path?/^news_[a-f\d-]+\.png$/i:/^news_[a-f\d-]+\.jpg$/i;
  if (path.dirname(file) !== path.resolve(output) || !expected.test(path.basename(file))) throw new NewsRenderError('NEWS_RENDER_OUTPUT','Unexpected News renderer output path');
  return file;
}


