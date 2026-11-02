// The long-polling loop of ONE customer bot (used by scripts/bot.mjs). Everything it talks to is handed in, so tests can
// replace Telegram and the clock.
//
// What it does when things go wrong (each case has a test in tests/poller.test.ts):
//   - the internet drops or Telegram does not answer: the loop waits (2 s, 4 s ... up to 60 s) and goes on by itself.
//     (Before, one network error ended the loop for good and that customer's bot stayed silent until the bot program
//     was restarted.)
//   - Telegram says the token is not valid (any more): the bot is checked again after 5 minutes instead of every 10 seconds,
//     and the message is not repeated all the time.
//   - handling one message fails: the loop goes on, and the person gets a short "something went wrong" instead of silence.

const RETRY_UNREACHABLE_MS = 30_000;
const RETRY_BAD_TOKEN_MS = 5 * 60_000;

// bot.mjs checks this every 10 seconds for every bot it should run.
export function shouldRestart(entry, now) {
  if (!entry) return true;
  return Boolean(entry.failed) && now >= (entry.retryAt ?? 0);
}

export async function runPoller(entry, { handle, onUpdateError, sleep, now = () => Date.now(), log = console.log, error = console.error }) {
  const { tg, label } = entry;

  const fail = (message, retryMs) => {
    entry.failed = true;
    entry.retryAt = now() + retryMs;
    if (entry.lastFailure !== message) error(`[${label}] ${message}`); // say it once, not every retry
    entry.lastFailure = message;
  };

  // ---- start: who is this bot, and make sure nothing else (a webhook) blocks polling ----
  try {
    const me = await tg.api("getMe");
    if (!me.ok) return fail(`Telegram rejected this bot token: ${me.description}. Checking again in 5 minutes.`, RETRY_BAD_TOKEN_MS);
    await tg.api("deleteWebhook"); // a webhook would block polling
    await tg.api("setMyCommands", {
      commands: [
        { command: "matches", description: "Today's matches" },
        { command: "help", description: "How it works" },
      ],
    });
    entry.failed = false;
    entry.lastFailure = null;
    log(`[${label}] bot @${me.result.username} is running`);
  } catch (e) {
    return fail(`cannot reach Telegram (${e.message}). Trying again in 30 seconds.`, RETRY_UNREACHABLE_MS);
  }

  // ---- the loop ----
  let offset = 0;
  let pause = 2000;
  let offline = false;
  while (!entry.stop) {
    let res;
    try {
      res = await tg.api("getUpdates", { timeout: 25, offset, allowed_updates: ["message", "callback_query"] }, { timeoutMs: 40_000 });
    } catch (e) {
      if (entry.stop) break;
      if (!offline) error(`[${label}] connection problem: ${e.message}. Trying again...`);
      offline = true;
      await sleep(pause);
      pause = Math.min(pause * 2, 60_000);
      continue;
    }
    if (offline) log(`[${label}] connection is back`);
    offline = false;
    pause = 2000;
    if (entry.stop) break;

    if (!res.ok) {
      if (res.error_code === 401) return fail(`the bot token is not valid any more (${res.description}). Checking again in 5 minutes.`, RETRY_BAD_TOKEN_MS);
      error(`[${label}] getUpdates error: ${res.description}`);
      if (res.error_code === 409) error(`[${label}] This bot has a webhook or another poller. Use a separate bot.`);
      await sleep(5000);
      continue;
    }

    for (const update of res.result ?? []) {
      offset = update.update_id + 1;
      try {
        await handle(entry.ctx, update);
      } catch (e) {
        error(`[${label}] failed to handle update:`, e);
        try {
          await onUpdateError?.(entry.ctx, update, e);
        } catch {
          /* telling the person is best effort */
        }
      }
    }
  }
  log(`[${label}] bot stopped`);
}
