import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const PREFIX = "enc:";

function getKey(): Buffer | null {
  const raw = process.env.HISTORY_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) return null;
  try {
    if (/^[A-Za-z0-9+/]+=*$/.test(raw.trim())) {
      const buf = Buffer.from(raw, "base64");
      return buf.length === KEY_LEN ? buf : null;
    }
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      return Buffer.from(raw, "hex");
    }
  } catch {
    return null;
  }
  return null;
}

export function encryptSensitive(plain: string): string {
  const key = getKey();
  if (!key) return plain;
  if (!plain) return plain;
  try {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
    const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
  } catch {
    return plain;
  }
}

export function decryptSensitive(value: string): string {
  if (!value || !value.startsWith(PREFIX)) return value;
  const key = getKey();
  if (!key) return value;
  try {
    const buf = Buffer.from(value.slice(PREFIX.length), "base64");
    if (buf.length < IV_LEN + TAG_LEN) return value;
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
    decipher.setAuthTag(tag);
    return decipher.update(enc) + decipher.final("utf8");
  } catch {
    return value;
  }
}

export function isEncryptionEnabled(): boolean {
  return getKey() !== null;
}
