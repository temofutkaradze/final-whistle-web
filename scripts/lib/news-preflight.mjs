export function telegramPollingCode(result){
  if(result?.error_code===401)return 'NEWS_TELEGRAM_AUTH';
  if(result?.error_code===409)return 'NEWS_TELEGRAM_POLL_CONFLICT';
  return 'NEWS_TELEGRAM_UNAVAILABLE';
}
export async function inspectNewsTelegram(tg){
  try{
    const me=await tg.api('getMe');
    if(!me?.ok)return {ok:false,code:telegramPollingCode(me)};
    const webhook=await tg.api('getWebhookInfo');
    if(!webhook?.ok)return {ok:false,code:telegramPollingCode(webhook)};
    if(webhook.result?.url)return {ok:false,code:'NEWS_TELEGRAM_WEBHOOK'};
    return {ok:true};
  }catch{return {ok:false,code:'NEWS_TELEGRAM_UNAVAILABLE'};}
}
