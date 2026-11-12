import type {Job} from './parse.ts';
import {newsImageFileId,type NewsMessage} from './conversation.ts';

export const EDITORIAL_TEMPLATES={
  'headline-subtitle':'Headline + Subtitle',
  'large-headline':'Large Headline',
  'news-red':'NEWS (Red)',
  'did-you-know':'DID YOU KNOW (Yellow)',
} as const;
export type EditorialTemplate=keyof typeof EDITORIAL_TEMPLATES;
type EditorialPending={stage:'editorial';background:string;template:EditorialTemplate;step:'headline'|'subtitle';headline?:string;ts:number};
type Collection={background?:string;circle?:string|null;ts?:number;stage?:string};
export const EDITORIAL_KEYBOARD={reply_markup:{keyboard:Object.values(EDITORIAL_TEMPLATES).map(text=>[{text}]),resize_keyboard:true,one_time_keyboard:true}};

/** Opt-in templates coexist with the original text/circle and standings conversations. */
export function editorialTransition(message:NewsMessage,raw:unknown,now:number){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  if('kind' in raw&&raw.kind==='standings')return null;
  const pending=raw as Collection & {template?:EditorialTemplate;step?:'headline'|'subtitle';headline?:string};
  if(!pending.background||now-(pending.ts??0)>3600000)return null;
  const text=(message.text??'').trim();
  if(/^\//.test(text))return null;
  if(pending.stage!=='editorial'){
    if(pending.stage&&pending.stage!=='collecting')return null;
    const template=(Object.keys(EDITORIAL_TEMPLATES) as EditorialTemplate[]).find(key=>EDITORIAL_TEMPLATES[key]===text);
    if(!template)return null;
    return {pending:{stage:'editorial',background:pending.background,template,step:'headline',ts:now} as EditorialPending,reply:'Enter the headline. Use *words* for yellow highlights.'};
  }
  if(newsImageFileId(message))return null; // A fresh upload returns to the existing upload workflow.
  if(!pending.template||!Object.hasOwn(EDITORIAL_TEMPLATES,pending.template))return null;
  const limit=pending.step==='subtitle'?450:300;
  if(!text.replace(/\*/g,'').trim()||text.length>limit)return {pending:raw,reply:`Please enter 1–${limit} characters of ${pending.step==='subtitle'?'subtitle':'headline'} text.`};
  if(pending.step==='headline'&&pending.template==='headline-subtitle')return {pending:{...pending,headline:text,step:'subtitle',ts:now},reply:'Enter the subtitle. Use *words* for yellow highlights.'};
  const headline=pending.step==='subtitle'?pending.headline!:text;
  const job:Job={layout:'single',author:'',quote:headline,caption:'',pos:{b:[50,50,1],c:[50,30,1]},editorial:{template:pending.template,headline,subtitle:pending.step==='subtitle'?text:''}};
  return {pending:null,background:pending.background,circle:null,job};
}
