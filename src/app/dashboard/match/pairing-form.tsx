'use client';
import {useActionState} from 'react';
import {reviewPairing,confirmPairing,type PairingState} from './pairing-actions';
export default function PairingForm(){
 const [review,reviewAction,reviewPending]=useActionState<PairingState,FormData>(reviewPairing,{});
 const [confirmation,confirmAction,confirmPending]=useActionState<PairingState,FormData>(confirmPairing,{});
 return <div style={{marginTop:16}}>
  <form action={reviewAction}>
   <label htmlFor="match-pair-code">Pairing code from your private Telegram chat
    <input id="match-pair-code" name="code" required minLength={43} maxLength={43} autoComplete="off" spellCheck={false}/>
   </label>
   <button className="btn" type="submit" disabled={reviewPending}>{reviewPending?'Checking…':'Review Telegram identity'}</button>
  </form>
  {review.error&&<p className="notice error" role="alert">{review.error}</p>}
  {review.review&&<form action={confirmAction} style={{marginTop:16}}>
   <p>Bot: @{review.review.botUsername}. Private Telegram user ID: <strong>{review.review.telegramUserId}</strong>. Chat ID: {review.review.chatId}.</p>
   <p className="muted">Only approve the code you requested yourself. This grants this Telegram account access to your Match bot and generated posts.</p>
   <input type="hidden" name="code" value={review.review.code}/>
   <label><input type="checkbox" name="confirm" value="yes" required/> I confirm this is my intended private Telegram account.</label>
   <button className="btn" type="submit" disabled={confirmPending||Boolean(confirmation.success)}>{confirmPending?'Confirming…':'Approve Telegram pairing'}</button>
  </form>}
  {confirmation.error&&<p className="notice error" role="alert">{confirmation.error}</p>}
  {confirmation.success&&<p className="notice ok" role="status">{confirmation.success}</p>}
 </div>;
}
