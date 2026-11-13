import {buildOriginalJob,HELP,type Job} from './parse.ts';

export const BACKGROUND_SAVED='✅ Background saved. Send the circle image (optional), or send the text now.';
export const CIRCLE_SAVED='✅ Circle image saved. Now send the text (L: = left, R: = right; default is left).';
export type PendingNews={background?:string;circle?:string|null;ts?:number};
export type NewsMessage={text?:string;caption?:string;document?:{file_id:string;mime_type?:string;file_name?:string};photo?:{file_id:string;width?:number;height?:number;file_size?:number}[]};
export type NewsTransition={pending:PendingNews|null;reply:string}|{pending:null;job:Job;background:string;circle:string|null};

// Upload metadata is only a hint; download and renderer validate actual bytes.
// Keep News and standings document/photo acceptance identical.
export function newsImageFileId(message:NewsMessage):string|undefined{
  const doc=message.document;
  const best=message.photo?.length?message.photo.reduce((chosen,photo)=>{
    const area=(photo.width??0)*(photo.height??0),chosenArea=(chosen.width??0)*(chosen.height??0);
    return area>chosenArea||(area===chosenArea&&(photo.file_size??0)>=(chosen.file_size??0))?photo:chosen;
  }):undefined;
  return doc&&((doc.mime_type??'').startsWith('image/')||/\.(jpe?g|png|webp)$/i.test(doc.file_name??''))?doc.file_id:best?.file_id;
}

// Pure local equivalent of Parse Message; no Telegram calls or live n8n execution.
export function originalNewsTransition(message:NewsMessage,pending:PendingNews|null,now:number,config?:unknown):NewsTransition{
  let p=pending?.background?{...pending}:null;
  if(p&&now-(p.ts??0)>60*60_000)p=null;
  const fileId=newsImageFileId(message);
  const text=(message.text??'').trim(); // Photo captions are intentionally ignored.
  if(fileId){
    if(!p||p.circle)return {pending:{background:fileId,circle:null,ts:now},reply:BACKGROUND_SAVED};
    return {pending:{...p,circle:fileId,ts:now},reply:CIRCLE_SAVED};
  }
  if(!text||/^\/(start|help)\b/i.test(text))return {pending:p,reply:HELP};
  if(/^\/cancel\b/i.test(text))return {pending:null,reply:'Cleared. Send a new background image.'};
  if(!p)return {pending:null,reply:'Send the BACKGROUND image first (as a file or HD photo), then the text.\n\n'+HELP};
  const job=buildOriginalJob(text,Boolean(p.circle),config);
  return {pending:null,job,background:p.background!,circle:job.layout==='single'||job.layout==='breaking'?null:p.circle??null};
}
