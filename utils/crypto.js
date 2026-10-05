import crypto from "crypto";
import config from "../config/env.js";

const { encryptionKey, hmacKey } = config.security;

// AES-256-GCM field encryption. Output: base64(iv | tag | ciphertext).
export function encrypt(plaintext) {
  if (plaintext == null || plaintext === "") return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decrypt(payload) {
  if (!payload) return null;
  const buf = Buffer.from(payload, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

export const hmac = (value, key = hmacKey) => crypto.createHmac("sha256", key).update(String(value)).digest("base64url");

// Deterministic keyed hash so encrypted identifiers (BVN/NIN) stay unique and searchable.
export const blindIndex = (value) => (value ? hmac(`bi:${String(value).trim()}`) : null);

export const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ""));
  const right = Buffer.from(String(b ?? ""));
  // Compare against itself on length mismatch so timing doesn't reveal the length.
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
