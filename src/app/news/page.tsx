import Link from 'next/link';
import BackToDashboard from '@/app/back-to-dashboard';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { DEFAULT_NEWS_STYLE, normalizeNewsStyle } from '@/lib/news/parse';
import TemplateEditor from './template-editor';
import BotLink from './bot-link';
import { saveDefault, saveTemplate, removeTemplate, connectNewsBot, disconnectNewsBot, createNewsLink } from './actions';

export const dynamic = 'force-dynamic';
const BUILTINS = [
  {id:'single',name:'Single',layout:'single'},
  {id:'left',name:'Circle Left',layout:'left'},
  {id:'right',name:'Circle Right',layout:'right'},
  {id:'breaking',name:'BREAKING',layout:'breaking'},
];
export default async function NewsPage({searchParams}:{searchParams:Promise<{edit?:string;message?:string}>}) {
  const user=await requireUser();
  const {edit,message}=await searchParams;
  const [settings,custom]=await Promise.all([
    prisma.newsSettings.findUnique({where:{userId:user.id},select:{botUsername:true,botId:true,telegramChatId:true,defaultTemplateRef:true}}),
    prisma.newsTemplate.findMany({where:{userId:user.id},orderBy:{createdAt:'asc'}}),
  ]);
  const templates=[...BUILTINS.map(t=>({...t,config:DEFAULT_NEWS_STYLE,builtin:true})),...custom.map(t=>({...t,config:normalizeNewsStyle(t.config),builtin:false}))];
  const selected=templates.find(t=>t.id===edit);
  return <div className="container dash-page news-page">
    <div className="news-heading"><div><BackToDashboard/><h1>News Generator</h1><p className="muted">Configure your templates here. Create every post in Telegram.</p></div><a className="btn" href="#news-editor">Add a template</a></div>
    {message&&<p className="notice" role="status">{message}</p>}
    <div className="news-setup-grid">
      <section className="card" aria-labelledby="news-connection"><h2 id="news-connection">News Telegram bot</h2>
        {settings?.botId?<>
          <p><strong>@{settings.botUsername??'News bot'}</strong> · {settings.telegramChatId?'Chat linked':'Chat not linked'}</p>
          <p className="muted">{settings.telegramChatId?'Ready for images and text. No need to send /start again.':'Create a private, single-use link to authorize your Telegram chat.'}</p>
          {!settings.telegramChatId&&<BotLink action={createNewsLink}/>}
          {settings.telegramChatId&&settings.botUsername&&<a className="btn" href={`https://t.me/${settings.botUsername}`} target="_blank" rel="noreferrer">Open News bot</a>}
          <form action={disconnectNewsBot}><button className="btn ghost" type="submit">Disconnect News bot</button></form>
        </>:<><p className="muted">Connect a separate bot from @BotFather. Use a dedicated bot without an n8n webhook.</p><form action={connectNewsBot} className="plain"><label>News bot token<input type="password" name="token" autoComplete="off" required placeholder="Token from @BotFather"/></label><button className="btn" type="submit">Connect News bot</button></form></>}
      </section>
      <section className="card" aria-labelledby="news-flow"><h2 id="news-flow">Your Telegram flow</h2><ol><li>Send a background photo or image file.</li><li>Optionally send a second photo for a circle post.</li><li>Send a separate text message: <code>Author | News with *highlights*</code>. Use <code>R:</code> for a right circle or <code>BREAKING | text</code> for breaking news.</li><li>Receive the finished 1080 × 1350 JPG.</li></ol><p className="muted">Photo captions are ignored, as in the original bot. Use /help for instructions and /cancel to clear images. Saved images expire after 60 minutes; /start is not needed for each post.</p></section>
    </div>
    <section className="card news-template-section"><div className="news-section-heading"><div><h2>Templates</h2><p className="muted">Select the saved styling here. In the original Telegram flow, the image count and L:/R:/BREAKING text choose the final layout.</p></div><span>{templates.length} designs</span></div>
      <form action={saveDefault} className="plain"><div className="news-template-list">
        {templates.map(t=><div key={t.id} className="news-template-row"><label><input type="radio" name="template" value={t.id} defaultChecked={(settings?.defaultTemplateRef??'single')===t.id}/><img src={`/news-previews/${t.layout}.jpg`} alt="" width="48" height="60"/><span><strong>{t.name}</strong><small className="muted">{t.builtin?'Built-in':'Custom'} · {t.layout==='left'||t.layout==='right'?'Two images':'One image'}</small></span></label><Link className="btn ghost" href={`/news?edit=${encodeURIComponent(t.id)}#news-editor`}>Edit and preview</Link></div>)}
      </div><button className="btn" type="submit">Save default template</button></form>
    </section>
    <section id="news-editor" className="card news-editor-section"><div className="news-section-heading"><div><h2>{selected?`Edit ${selected.name}`:'Add a template'}</h2><p className="muted">{selected?.builtin?'Save a built-in design as your own custom template.':'Set typography, placement, crops and the secondary image shape.'}</p></div></div>
      <TemplateEditor key={selected?.id??'new'} selected={selected} action={saveTemplate} layouts={BUILTINS}/>
      {selected&&!selected.builtin&&<form action={removeTemplate} className="news-delete"><input type="hidden" name="id" value={selected.id}/><button className="btn ghost" type="submit">Delete custom template</button></form>}
    </section>
  </div>;
}
