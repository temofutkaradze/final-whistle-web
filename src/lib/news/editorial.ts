import type {Job} from './parse.ts';
import {newsImageFileId,BACKGROUND_SAVED,type NewsMessage} from './conversation.ts';

export const EDITORIAL_TEMPLATES={
  'headline-subtitle':'Headline + Subtitle',
  'large-headline':'Large Headline',
  'news-red':'NEWS (Red)',
  'did-you-know':'DID YOU KNOW (Yellow)',
} as const;
export type EditorialTemplate=keyof typeof EDITORIAL_TEMPLATES;
export const LARGE_HEADLINE_DEFAULT_OFFSET=128;
export const LARGE_HEADLINE_MIN_OFFSET=0;
export const LARGE_HEADLINE_MAX_OFFSET=1000;
const LARGE_HEADLINE_HEADLINE_PROMPT='Send your headline in one message. Use a new line wherever you want a new line in the image. On desktop, use Shift+Enter to insert a line break without sending the message.';
const largeHeadlineLayoutChoices={reply_markup:{keyboard:[[{text:'Automatic'},{text:'Manual'}],[{text:'Back'},{text:'Cancel'}]],resize_keyboard:true,one_time_keyboard:true}};
const largeHeadlineOffsetChoices={reply_markup:{keyboard:[[{text:'Default (128 px)'}],[{text:'Back'},{text:'Cancel'}]],resize_keyboard:true,one_time_keyboard:true}};
const largeHeadlineRecoveryChoices={reply_markup:{keyboard:[[{text:'Change headline'},{text:'Change offset'}],[{text:'Cancel'}]],resize_keyboard:true,one_time_keyboard:true}};
type EditorialPending={stage:'editorial';background:string;template:EditorialTemplate;step:'version'|'headline'|'subtitle'|'layout'|'offset'|'fit';version?:1|2;layoutMode?:'automatic'|'manual';bottomOffset?:number;headline?:string;ts:number};
type Collection={background?:string;circle?:string|null;ts?:number;stage?:string};
export const EDITORIAL_KEYBOARD={reply_markup:{keyboard:[...Object.values(EDITORIAL_TEMPLATES),'Quotes','Breaking','Tables','Branding'].map(text=>[{text}]),resize_keyboard:true,one_time_keyboard:true}};

/** Opt-in templates coexist with the original text/circle and standings conversations. */
export function editorialTransition(message:NewsMessage,raw:unknown,now:number){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  if('kind' in raw&&raw.kind==='standings')return null;
  const pending=raw as Collection & {template?:EditorialTemplate;step?:'version'|'headline'|'subtitle'|'choice'|'text'|'layout'|'offset'|'fit';version?:1|2;layoutMode?:'automatic'|'manual';bottomOffset?:number;headline?:string};
  if(!pending.background||now-(pending.ts??0)>3600000)return null;
  const rawText=message.text??'';
  const text=rawText.trim();
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
  if(text==='Cancel'&&pending.stage==='editorial'&&pending.template==='large-headline')return {pending:null,reply:'Cleared. Send a new background image.'};
  if(pending.stage!=='editorial'){
    if(pending.stage&&pending.stage!=='collecting')return null;
    const template=(Object.keys(EDITORIAL_TEMPLATES) as EditorialTemplate[]).find(key=>EDITORIAL_TEMPLATES[key]===text);
    if(!template)return null;
    if(template==='large-headline')return {pending:{stage:'editorial',background:pending.background,template,step:'layout',ts:now} as EditorialPending,reply:'Choose a Large Headline layout mode.',replyOptions:largeHeadlineLayoutChoices};
    if(template==='news-red'||template==='did-you-know')return {pending:{stage:'editorial',background:pending.background,template,step:'version',ts:now} as EditorialPending,reply:'Choose a design version.',replyOptions:versionChoices};
    return {pending:{stage:'editorial',background:pending.background,template,step:'headline',ts:now} as EditorialPending,reply:'Enter the headline. Use *words* for yellow highlights.'};
  }
  if(newsImageFileId(message))return null; // A fresh upload returns to the existing upload workflow.
  if(!pending.template||!Object.hasOwn(EDITORIAL_TEMPLATES,pending.template))return null;
  if(pending.template==='large-headline'&&pending.step==='layout'){
    if(text==='Back')return {pending:{background:pending.background,circle:pending.circle??null,ts:now},reply:'Choose a template.',returnToTemplates:true};
    if(text==='Automatic')return {pending:{...pending,layoutMode:'automatic',step:'headline',ts:now},reply:'Enter the headline. Use *words* for yellow highlights.',replyOptions:{reply_markup:{remove_keyboard:true}}};
    if(text==='Manual')return {pending:{...pending,layoutMode:'manual',bottomOffset:LARGE_HEADLINE_DEFAULT_OFFSET,step:'offset',ts:now},reply:'Enter the bottom offset in pixels. Default: 128 px. Higher values move the headline upward.',replyOptions:largeHeadlineOffsetChoices};
    return {pending:raw,reply:'Choose Automatic or Manual.',replyOptions:largeHeadlineLayoutChoices};
  }
  if(pending.template==='large-headline'&&pending.step==='fit'){
    if(text==='Change offset')return {pending:{...pending,step:'offset',ts:now},reply:'Enter the bottom offset in pixels. Default: 128 px. Higher values move the headline upward.',replyOptions:largeHeadlineOffsetChoices};
    if(text==='Change headline')return {pending:{...pending,step:'headline',headline:undefined,ts:now},reply:LARGE_HEADLINE_HEADLINE_PROMPT,replyOptions:{reply_markup:{remove_keyboard:true}}};
    return {pending:raw,reply:'This manual headline does not fit safely. Change the headline or bottom offset.',replyOptions:largeHeadlineRecoveryChoices};
  }
  if(pending.step==='version'){
    if(text!=='Version 1'&&text!=='Version 2')return {pending:raw,reply:'Please choose Version 1 or Version 2.',replyOptions:versionChoices};
    return {pending:{...pending,version:text==='Version 2'?2:1,step:'headline',ts:now},reply:'Enter the headline. Use *words* for yellow highlights.',replyOptions:{reply_markup:{remove_keyboard:true}}};
  }
  if(pending.template==='large-headline'&&pending.step==='offset'){
    if(text==='Back'){
      if(pending.headline)return {pending:{...pending,step:'fit',ts:now},reply:'This manual headline does not fit safely. Change the headline or bottom offset.',replyOptions:largeHeadlineRecoveryChoices};
      return {pending:{...pending,step:'layout',ts:now},reply:'Choose a Large Headline layout mode.',replyOptions:largeHeadlineLayoutChoices};
    }
    let bottomOffset:number|null=null;
    if(text==='Default (128 px)')bottomOffset=LARGE_HEADLINE_DEFAULT_OFFSET;
    else if(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*(?:px)?$/i.test(text))bottomOffset=Number(text.replace(/px/i,'').trim());
    if(bottomOffset===null||!Number.isFinite(bottomOffset)||bottomOffset<LARGE_HEADLINE_MIN_OFFSET||bottomOffset>LARGE_HEADLINE_MAX_OFFSET){
      return {pending:raw,reply:`Enter a bottom offset from ${LARGE_HEADLINE_MIN_OFFSET} to ${LARGE_HEADLINE_MAX_OFFSET} pixels. Default: 128 px.`,replyOptions:largeHeadlineOffsetChoices};
    }
    if(pending.headline){
      const job:Job={layout:'single',author:'',quote:pending.headline,caption:'',pos:{b:[50,50,1],c:[50,30,1]},editorial:{template:'large-headline',layoutMode:'manual',bottomOffset,headline:pending.headline,subtitle:''}};
      return {pending:null,background:pending.background, circle:null,job};
    }
    return {pending:{...pending,bottomOffset,step:'headline',ts:now},reply:LARGE_HEADLINE_HEADLINE_PROMPT,replyOptions:{reply_markup:{remove_keyboard:true}}};
  }
  if(pending.template==='large-headline'&&text==='Back'){
    if(pending.step==='headline'&&pending.layoutMode==='manual')return {pending:{...pending,step:'offset',ts:now},reply:'Enter the bottom offset in pixels. Default: 128 px. Higher values move the headline upward.',replyOptions:largeHeadlineOffsetChoices};
    return {pending:{...pending,step:'layout',ts:now},reply:'Choose a Large Headline layout mode.',replyOptions:largeHeadlineLayoutChoices};
  }
  const limit=pending.step==='subtitle'?450:300;
  const manualHeadline=pending.template==='large-headline'&&pending.layoutMode==='manual'&&pending.step==='headline';
  const entered=manualHeadline?rawText:text;
  if(!entered.replace(/\*/g,'').trim()||entered.length>limit)return {pending:raw,reply:`Please enter 1–${limit} characters of ${pending.step==='subtitle'?'subtitle':'headline'} text.`};
  if(pending.step==='headline'&&pending.template==='headline-subtitle')return {pending:{...pending,headline:text,step:'subtitle',ts:now},reply:'Enter the subtitle. Use *words* for yellow highlights.'};
  const headline=pending.step==='subtitle'?pending.headline!:entered;
  const job:Job={layout:'single',author:'',quote:headline,caption:'',pos:{b:[50,50,1],c:[50,30,1]},editorial:{template:pending.template,...(pending.version?{version:pending.version}:{}),...(pending.template==='large-headline'?{layoutMode:pending.layoutMode??'automatic',...(pending.layoutMode==='manual'?{bottomOffset:pending.bottomOffset??LARGE_HEADLINE_DEFAULT_OFFSET}:{})}:{}),headline,subtitle:pending.step==='subtitle'?text:''}};
  return {pending:null,background:pending.background,circle:null,job};
}
