'use client';
import { useActionState } from 'react';

export type LinkState = { url?: string; error?: string };
export default function BotLink({ action }: {action:(previous:LinkState, data:FormData)=>Promise<LinkState>}) {
  const [state, formAction, pending] = useActionState(action, {});
  return <div className="news-link">
    <form action={formAction}><button className="btn" disabled={pending}>{pending?'Creating link…':'Create secure Telegram link'}</button></form>
    {state.error && <p role="alert">{state.error}</p>}
    {state.url && <p role="status"><a className="btn" href={state.url} target="_blank" rel="noreferrer">Link my private Telegram chat</a><br/><small>Single use. Expires in 10 minutes. Keep this link private.</small></p>}
  </div>;
}
