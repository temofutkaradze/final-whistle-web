'use client';
import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { DEFAULT_NEWS_STYLE, normalizeNewsStyle, type NewsStyle } from '@/lib/news/parse';
import { NEWS_FIELDS } from '@/lib/news/fields';

const fonts = ['League Gothic','Anton','Montserrat','Arial'];
export type EditableTemplate = {id:string;name:string;layout:string;config:NewsStyle;builtin:boolean};
function SaveButton({editing}:{editing:boolean}) {
  const {pending} = useFormStatus();
  return <button className="btn" type="submit" disabled={pending}>{pending?'Saving…':editing?'Save template':'Add custom template'}</button>;
}
export default function TemplateEditor({selected,action,layouts}:{selected?:EditableTemplate;action:(data:FormData)=>Promise<void>;layouts:readonly {id:string;name:string}[]}) {
  const [style,setStyle] = useState(selected?.config ?? DEFAULT_NEWS_STYLE);
  const [layout,setLayout] = useState(selected?.layout ?? 'single');
  const [preview,setPreview] = useState(`/news-previews/${selected?.layout??'single'}.jpg`);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [stale,setStale] = useState(true);
  const revision = useRef(0);
  const request = useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
  const change = (key:keyof NewsStyle,value:string) => {revision.current++;setStyle(s=>normalizeNewsStyle({...s,[key]:value}));setStale(true);};
  async function refresh() {
    request.current?.abort();
    const controller=new AbortController();request.current=controller;
    const renderedRevision=revision.current;
    setBusy(true);setError('');
    try {
      const response=await fetch('/api/news/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({layout,style}),signal:controller.signal});
      if(!response.ok)throw new Error((await response.json()).error ?? 'Preview failed');
      setPreview(URL.createObjectURL(await response.blob()));setStale(renderedRevision!==revision.current);
    } catch(e) {if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Preview failed');}
    finally {if(request.current===controller)setBusy(false);}
  }
  return <form action={action} className="plain news-editor">
    <input type="hidden" name="id" value={selected&&!selected.builtin?selected.id:''}/>
    <div className="news-controls">
      <div className="news-editor-grid">
        <label>Template name<input name="name" required maxLength={60} defaultValue={selected?.builtin?`${selected.name} Custom`:selected?.name??'My News Design'}/></label>
        <label>Layout<select aria-label="Layout" name="layout" value={layout} onChange={e=>{revision.current++;setLayout(e.target.value);setStale(true);}}>{layouts.map(({id,name})=><option key={id} value={id}>{name}</option>)}</select></label>
      </div>
      <fieldset><legend>Typography and colors</legend><div className="news-editor-grid">
        <label>Quote font<select aria-label="Quote font" name="font" value={style.font} onChange={e=>change('font',e.target.value)}>{fonts.map(f=><option key={f}>{f}</option>)}</select></label>
        <label>Breaking summary font<select aria-label="Breaking summary font" name="breakingFont" value={style.breakingFont} onChange={e=>change('breakingFont',e.target.value)}>{fonts.map(f=><option key={f}>{f}</option>)}</select></label>
        <label>Text alignment<select aria-label="Text alignment" name="align" value={style.align} onChange={e=>change('align',e.target.value)}>{['left','center','right'].map(a=><option key={a}>{a}</option>)}</select></label>
        {([['accent','Highlight and divider'],['textColor','Headline color'],['authorColor','Author color'],['circleBorderColor','Secondary border color']] as const).map(([key,label])=><label key={key}>{label}<input name={key} type="color" value={style[key]} onChange={e=>change(key,e.target.value)}/></label>)}
      </div></fieldset>
      {['Typography','Text placement','Image crops','Secondary image'].map(group=><fieldset key={group}><legend>{group}</legend>
        {group==='Secondary image'&&<p className="muted">Used when you send a second image before your text. Circle posts default to left; R: selects right.</p>}
        <div className="news-editor-grid">
          {group==='Secondary image'&&<label>Secondary shape<select aria-label="Secondary shape" name="circleShape" value={style.circleShape} onChange={e=>change('circleShape',e.target.value)}>{['circle','rounded','square'].map(s=><option key={s}>{s}</option>)}</select></label>}
          {NEWS_FIELDS.filter(f=>f.group===group).map(f=><label key={f.key}>{f.label}<input name={f.key} type="number" min={f.min} max={f.max} step={f.step??1} defaultValue={style[f.key]} onChange={e=>{if(e.target.value!==''&&e.target.validity.valid)change(f.key,e.target.value);}} required/></label>)}
        </div></fieldset>)}
      <div className="row"><SaveButton editing={Boolean(selected&&!selected.builtin)}/><a href="/news#news-editor" className="btn ghost">New template</a></div>
    </div>
    <aside className="news-live-preview" aria-label="Template preview" aria-busy={busy}>
      <h3>B-divider preview</h3>
      <p className="muted">Fixed sample artwork. Create your posts in Telegram.</p>
      <div className="news-render-frame">
        {preview?<img src={preview} alt={`${layout} News template rendered at 1080 by 1350 pixels`}/>:<div className="news-preview-empty"><span>1080 × 1350 JPG</span><p>Preview your template with the same renderer used by Telegram.</p></div>}
      </div>
      <button type="button" className="btn ghost" onClick={refresh} disabled={busy}>{busy?'Rendering preview…':'Update preview'}</button>
      <p className="muted" role="status">{busy?'Rendering…':stale?'Default layout sample. Update preview to see your current settings.':'Preview is up to date.'}</p>
      {error&&<p className="notice error" role="alert">{error}</p>}
      <p className="muted">Crop focal points use percentages. Zoom starts at 1 to cover the entire image frame.</p>
    </aside>
  </form>;
}
