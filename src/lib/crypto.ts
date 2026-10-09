import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Same format as scripts/lib/crypto.mjs:  "v1:" + base64( iv(12) | authTag(16) | ciphertext )
function key(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 16) throw new Error("APP_SECRET is missing or too short in .env");
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return "v1:" + Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith("v1:")) throw new Error("Unknown secret format");
  const raw = Buffer.from(stored.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

// The bot token to use for a customer: their own bot, or undefined = the shared demo bot.
export function userBotToken(user: { botToken: string | null }): string | undefined {
  return user.botToken ? decryptSecret(user.botToken) : undefined;
}
