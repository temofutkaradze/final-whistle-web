import path from 'node:path';
// Shared byte-preserving upload construction; callers retain authorization and retry rules.
export function documentForm(chatId,bytes,caption,fileName){
  const form=new FormData();form.append('chat_id',String(chatId));
  if(caption)form.append('caption',caption);
  form.append('document',new Blob([new Uint8Array(bytes)],{type:path.extname(fileName).toLowerCase()==='.png'?'image/png':'image/jpeg'}),fileName);
  return form;
}
