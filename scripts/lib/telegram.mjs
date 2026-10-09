import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is missing in .env");
  process.exit(1);
}

export async function api(method, body = {}) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export const sendMessage = (chatId, text, extra = {}) =>
  api("sendMessage", { chat_id: chatId, text, ...extra });

// Sent as a document so Telegram does not compress the picture.
export async function sendDocument(chatId, filePath, caption) {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), path.basename(filePath));
  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description ?? "Telegram sendDocument failed");
}

// Downloads a Telegram file (photo/document) into destDir and returns the full path.
export async function downloadTelegramFile(fileId, destDir, baseName) {
  const info = await api("getFile", { file_id: fileId });
  if (!info.ok) throw new Error(info.description ?? "getFile failed");
  const filePath = info.result.file_path;
  const ext = (path.extname(filePath) || ".jpg").toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) throw new Error("Please send a JPG, PNG or WebP image.");

  const res = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!res.ok) throw new Error(`File download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 15 * 1024 * 1024) throw new Error("Image is larger than 15 MB.");

  await mkdir(destDir, { recursive: true });
  const full = path.join(destDir, baseName + ext);
  await writeFile(full, buf);
  return full;
}
