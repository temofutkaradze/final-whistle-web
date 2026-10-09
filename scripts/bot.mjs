// Customer bot: connects a Telegram chat to an account.
// Run with:  npm run bot      (keep this window open)
// It uses long polling, so no public URL / ngrok is needed.
// IMPORTANT: use a NEW bot token here. A bot that has a webhook (like the one n8n uses)
// cannot be polled at the same time.

import { PrismaClient } from "@prisma/client";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is missing in .env");
  process.exit(1);
}

const prisma = new PrismaClient();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, body = {}) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

const reply = (chatId, text) => api("sendMessage", { chat_id: chatId, text });

async function handle(update) {
  const msg = update.message;
  if (!msg || typeof msg.text !== "string") return;

  const chatId = String(msg.chat.id);
  const match = msg.text.trim().match(/^\/start(?:\s+(\S+))?$/);

  if (!match || !match[1]) {
    await reply(chatId, "Open the Connect Telegram link from your Final Whistle dashboard to link this chat.");
    return;
  }

  const user = await prisma.user.findUnique({ where: { linkCode: match[1] } });
  if (!user) {
    await reply(chatId, "This link is not valid. Please open the latest link from your dashboard.");
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { telegramChatId: chatId, telegramLinkedAt: new Date() },
  });
  await reply(chatId, "Connected. Your football result posts will arrive in this chat.");
  console.log(`Linked ${user.email} to chat ${chatId}`);
}

async function main() {
  const me = await api("getMe");
  if (!me.ok) {
    console.error("Telegram rejected the token:", me.description);
    process.exit(1);
  }
  console.log(`Bot @${me.result.username} is running. Waiting for messages... (Ctrl+C to stop)`);

  let offset = 0;
  while (true) {
    const res = await api("getUpdates", { timeout: 30, offset, allowed_updates: ["message"] });
    if (!res.ok) {
      console.error("getUpdates error:", res.description);
      if (res.error_code === 409) {
        console.error("This bot already has a webhook or another poller. Use a separate new bot for this script.");
      }
      await sleep(5000);
      continue;
    }
    for (const update of res.result) {
      offset = update.update_id + 1;
      try {
        await handle(update);
      } catch (e) {
        console.error("Failed to handle update:", e);
      }
    }
  }
}

main();
