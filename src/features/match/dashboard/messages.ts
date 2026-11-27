export const BOT_MESSAGES: Record<string, string> = {
  ok: "Bot connected. Open it in Telegram and press Start.",
  removed: "Bot disconnected.",
  format: "That does not look like a bot token. Copy the whole token from @BotFather.",
  invalid: "Telegram does not accept this token. Check it and try again.",
  net: "Could not reach Telegram. Try again in a moment.",
  taken: "This bot is already connected to another account.",
  secret: "The server setting APP_SECRET is missing, so the token cannot be stored safely.",
};

export const PAGE_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  saved: { ok: true, text: "Page name saved." },
  name: { ok: false, text: "Please enter a page name (up to 60 characters)." },
  notfound: { ok: false, text: "That page was not found." },
};

export const LOOK_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  saved: { ok: true, text: "Saved. Every new post uses this look." },
  badlogo: { ok: false, text: "That file is not a usable picture. Use a PNG, JPG or WebP image." },
  biglogo: { ok: false, text: "The logo is larger than 5 MB." },
  nologo: { ok: false, text: "Upload a logo first. Until then your page name is shown." },
  notfound: { ok: false, text: "Your page was not found." },
  tpladded: { ok: true, text: "Template saved and selected for your page." },
  tplupdated: { ok: true, text: "Template updated." },
  tpldeleted: { ok: true, text: "Template deleted." },
};

export const ACCOUNT_MESSAGES: Record<string, string> = {
  confirm: "The email you typed does not match this account. Nothing was deleted.",
  busy: "A post is being created for you right now. Please try again in a minute.",
};
