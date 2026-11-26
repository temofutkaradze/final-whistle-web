import type {Job} from './parse.ts';
import {newsImageFileId,BACKGROUND_SAVED,type NewsMessage} from './conversation.ts';

export const EDITORIAL_TEMPLATES={
  'headline-subtitle':'Headline + Subtitle',
  'large-headline':'Large Headline',
  'news-red':'NEWS (Red)',
  'did-you-know':'DID YOU KNOW (Yellow)',
} as const;
export type EditorialTemplate=keyof typeof EDITORIAL_TEMPLATES;
type EditorialPending={stage:'editorial';background:string;template:EditorialTemplate;step:'version'|'headline'|'subtitle';version?:1|2;headline?:string;ts:number};
type Collection={background?:string;circle?:string|null;ts?:number;stage?:string};
export const EDITORIAL_KEYBOARD={reply_markup:{keyboard:[...Object.values(EDITORIAL_TEMPLATES),'Quotes','Breaking','Tables','Branding'].map(text=>[{text}]),resize_keyboard:true,one_time_keyboard:true}};

/** Opt-in templates coexist with the original text/circle and standings conversations. */
export function editorialTransition(message:NewsMessage,raw:unknown,now:number){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  if('kind' in raw&&raw.kind==='standings')return null;
  const pending=raw as Collection & {template?:EditorialTemplate;step?:'version'|'headline'|'subtitle'|'choice'|'text';version?:1|2;headline?:string};
  if(!pending.background||now-(pending.ts??0)>3600000)return null;
  const text=(message.text??'').trim();
  if(/^\//.test(text))return null;
  const versionChoices={reply_markup:{keyboard:[[{text:'Version 1'},{text:'Version 2'}]],resize_keyboard:true,one_time_keyboard:true}};
  const choices={reply_markup:{keyboard:[[{text:'Yes'},{text:'No'}]],resize_keyboard:true,one_time_keyboard:true}};
  if(text==='Breaking'&&(!pending.stage||pending.stage==='collecting'||pending.stage==='editorial'))return {pending:{background:pending.background,stage:'breaking',step:'choice',ts:now},reply:'Do you want to add text?',replyOptions:choices};
  if(pending.stage==='breaking'){
    if(newsImageFileId(message))return null;
    if(pending.step==='choice'&&text==='Yes')return {pending:{...pending,step:'text',ts:now},reply:'Enter the text to center below BREAKING. Use *words* for yellow highlights.',replyOptions:{reply_markup:{remove_keyboard:true}}};
    if(pending.step==='choice'&&text!=='No')return {pending:raw,reply:'Do you want to add text?',replyOptions:choices};
    if(pending.step==='text'&&(!text.replace(/\*/g,'').trim()||text.length>600))return {pending:raw,reply:'Please enter 1–600 characters of text.'};
    const withText=pending.step==='text';
    const job:Job={layout:'breaking',breakingText:withText,quote:withText?text:'',author:'',caption:'',pos:{b:[50,50,1],c:[50,30,1]}};
    return {pending:null,background:pending.background,circle:null,job};
  }
  if(text==='Quotes'&&(!pending.stage||pending.stage==='collecting'||pending.stage==='editorial'))return {pending:{background:pending.background,circle:pending.circle??null,ts:now},reply:BACKGROUND_SAVED+'\nUse the original Author | quote format, optional L: / R:, crop tags and || caption.'};
  if(pending.stage!=='editorial'){
    if(pending.stage&&pending.stage!=='collecting')return null;
    const template=(Object.keys(EDITORIAL_TEMPLATES) as EditorialTemplate[]).find(key=>EDITORIAL_TEMPLATES[key]===text);
    if(!template)return null;
    if(template==='news-red'||template==='did-you-know')return {pending:{stage:'editorial',background:pending.background,template,step:'version',ts:now} as EditorialPending,reply:'Choose a design version.',replyOptions:versionChoices};
    return {pending:{stage:'editorial',background:pending.background,template,step:'headline',ts:now} as EditorialPending,reply:'Enter the headline. Use *words* for yellow highlights.'};
  }
  if(newsImageFileId(message))return null; // A fresh upload returns to the existing upload workflow.
  if(!pending.template||!Object.hasOwn(EDITORIAL_TEMPLATES,pending.template))return null;
  if(pending.step==='version'){
    if(text!=='Version 1'&&text!=='Version 2')return {pending:raw,reply:'Please choose Version 1 or Version 2.',replyOptions:versionChoices};
    return {pending:{...pending,version:text==='Version 2'?2:1,step:'headline',ts:now},reply:'Enter the headline. Use *words* for yellow highlights.',replyOptions:{reply_markup:{remove_keyboard:true}}};
  }
  const limit=pending.step==='subtitle'?450:300;
  if(!text.replace(/\*/g,'').trim()||text.length>limit)return {pending:raw,reply:`Please enter 1–${limit} characters of ${pending.step==='subtitle'?'subtitle':'headline'} text.`};
  if(pending.step==='headline'&&pending.template==='headline-subtitle')return {pending:{...pending,headline:text,step:'subtitle',ts:now},reply:'Enter the subtitle. Use *words* for yellow highlights.'};
  const headline=pending.step==='subtitle'?pending.headline!:text;
  const job:Job={layout:'single',author:'',quote:headline,caption:'',pos:{b:[50,50,1],c:[50,30,1]},editorial:{template:pending.template,...(pending.version?{version:pending.version}:{}),headline,subtitle:pending.step==='subtitle'?text:''}};
  return {pending:null,background:pending.background,circle:null,job};
}
