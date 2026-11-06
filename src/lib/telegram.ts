import { readFile } from "node:fs/promises";
import path from "node:path";

// Minimal Telegram Bot API helpers (no extra libraries needed).

// Every customer uses their OWN bot (token saved on the dashboard). There is no shared bot.
export async function sendMessage(chatId: string, text: string, token: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json()) as { ok: boolean; description?: string };
  if (!res.ok || !data.ok) throw new Error(data.description ?? "Telegram request failed");
}

// Sent as a document (a file), so Telegram does not compress the image.
export async function sendDocument(chatId: string, filePath: string, caption: string | undefined, token: string): Promise<void> {
  const bytes = await readFile(filePath);

  const form = new FormData();
  form.append("chat_id", chatId);
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), path.basename(filePath));

  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(90_000),
  });
  const data = (await res.json()) as { ok: boolean; description?: string };
  if (!res.ok || !data.ok) throw new Error(data.description ?? "Telegram sendDocument failed");
}
