import {createIdleCache} from './idle-cache.mjs';
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { decryptSecret } from "./crypto.mjs";

// Telegram documents may omit MIME or use application/octet-stream for ordinary JPEGs.
export function matchImageUpload(message) {
  if(message.document){
    const doc=message.document;
    const suffix=path.extname(doc.file_name??'').toLowerCase();
    const mime=String(doc.mime_type??'').split(';')[0].trim().toLowerCase();
    const extension=['.jpg','.jpeg','.png','.webp'].includes(suffix)?suffix:
      ({'image/jpeg':'.jpg','image/jpg':'.jpg','image/png':'.png','image/webp':'.webp'})[mime];
    if(!extension)throw new Error('Unsupported file. Please send a JPEG, JPG, PNG or WebP image as a Photo or File/Document.');
    if(doc.file_size>MAX_TELEGRAM_IMAGE)throw new Error('Image is larger than 15 MB.');
    if(!doc.file_id)throw new Error('Could not read this document. Please upload the image again.');
    return {fileId:doc.file_id,extension};
  }
  const photo=message.photo?.at(-1);
  if(!photo?.file_id)throw new Error('Could not read this photo. Please upload it again.');
  return {fileId:photo.file_id,extension:'.jpg'};
}

// Everything the scripts need from Telegram, for ONE bot token.
export function makeTelegram(token) {
  // Every request has a time limit: without one, a network that drops silently leaves a bot waiting forever.
  // (Long polling asks Telegram to answer within 25 s, so getUpdates is given 40 s.)
  async function api(method, body = {}, { timeoutMs = 30_000 } = {}) {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.json();
  }

  const sendMessage = (chatId, text, extra = {}) => api("sendMessage", { chat_id: chatId, text, ...extra });

  // Sent as a document so Telegram does not compress the picture.
  async function sendDocument(chatId, filePath, caption, fileName = path.basename(filePath)) {
    let bytes;
    try { bytes = await readFile(filePath); }
    catch (e) { e.deliveryNotAttempted = true; throw e; }
    const form = new FormData();
    form.append("chat_id", String(chatId));
    if (caption) form.append("caption", caption);
    form.append("document", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), fileName);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form, signal: AbortSignal.timeout(90_000) });
    const data = await res.json();
    if (!data.ok) throw Object.assign(new Error(data.description ?? "Telegram sendDocument failed"), { telegramCode: data.error_code });
  }

  // Downloads a Telegram file (photo/document) into destDir and returns the full path.
  async function downloadTelegramFile(fileId, destDir, baseName, {imageExtension} = {}) {
    const info = await api("getFile", { file_id: fileId });
    if (!info.ok) throw Object.assign(new Error(info.description ?? "getFile failed"), { telegramCode: info.error_code });
    if(info.result.file_size > MAX_TELEGRAM_IMAGE)throw new Error('Image is larger than 15 MB.');
    const filePath = info.result.file_path;
    let ext = (path.extname(filePath) || imageExtension || ".jpg").toLowerCase();
    if(!['.jpg','.jpeg','.png','.webp'].includes(ext)&&['.jpg','.jpeg','.png','.webp'].includes(imageExtension))ext=imageExtension;
    if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) throw new Error("Please send a JPG, PNG or WebP image.");

    const res = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`File download failed: HTTP ${res.status}`);
    const buf = await readTelegramImage(res);

    await mkdir(destDir, { recursive: true });
    const full = path.join(destDir, baseName + ext);
    await writeFile(full, buf);
    return full;
  }

  return { token, api, sendMessage, sendDocument, downloadTelegramFile };
}

// The client for one customer: always their OWN bot (there is no shared bot).
const cache = createIdleCache();
export function telegramForUser(user) {
  if (!user.botToken) throw new Error("This customer has not connected a bot.");
  const token = decryptSecret(user.botToken);
  let tg = cache.get(user.id);
  if (!tg || tg.token !== token) {
    tg = makeTelegram(token);
    cache.set(user.id, tg);
  }
  return tg;
}

export const MAX_TELEGRAM_IMAGE=15*1024*1024;
export async function readTelegramImage(response,limit=MAX_TELEGRAM_IMAGE){
 if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel().catch(()=>{});throw new Error('Image is larger than 15 MB.');}
 if(!response.body)throw new Error('Image download returned no body.');
 const reader=response.body.getReader();const chunks=[];let size=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
   if(size>limit){await reader.cancel().catch(()=>{});throw new Error('Image is larger than 15 MB.');}
   chunks.push(value);
  }
  return Buffer.concat(chunks,size);
 }finally{reader.releaseLock();}
}
