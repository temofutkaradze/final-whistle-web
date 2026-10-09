// Encrypts customer bot tokens before they are stored in the database.
// Format (same as src/lib/crypto.ts):  "v1:" + base64( iv(12) | authTag(16) | ciphertext )
// Key = SHA-256(APP_SECRET). If APP_SECRET changes, stored tokens can no longer be read.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key() {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 16) throw new Error("APP_SECRET is missing or too short in .env");
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return "v1:" + Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

export function decryptSecret(stored) {
  if (!stored.startsWith("v1:")) throw new Error("Unknown secret format");
  const raw = Buffer.from(stored.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
