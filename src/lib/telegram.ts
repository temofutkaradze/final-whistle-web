import { readFile } from "node:fs/promises";
import path from "node:path";

// Minimal Telegram Bot API helpers (no extra libraries needed).

export function botLink(linkCode: string): string | null {
  const username = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  if (!username) return null;
  return `https://t.me/${username}?start=${linkCode}`;
}

function botToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set in .env");
  return token;
}

export async function sendMessage(chatId: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken()}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const data = (await res.json()) as { ok: boolean; description?: string };
  if (!data.ok) throw new Error(data.description ?? "Telegram request failed");
}

// Sent as a document (a file), so Telegram does not compress the image.
export async function sendDocument(chatId: string, filePath: string, caption?: string): Promise<void> {
  const bytes = await readFile(filePath);

  const form = new FormData();
  form.append("chat_id", chatId);
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), path.basename(filePath));

  const res = await fetch(`https://api.telegram.org/bot${botToken()}/sendDocument`, {
    method: "POST",
    body: form,
  });
  const data = (await res.json()) as { ok: boolean; description?: string };
  if (!data.ok) throw new Error(data.description ?? "Telegram sendDocument failed");
}
