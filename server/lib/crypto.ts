import {
  createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual,
} from "node:crypto";
import { config } from "./config.js";

function scryptAsync(password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { ...options, maxmem: 64 * 1024 * 1024 }, (error, derivedKey) => {
      if (error) return reject(error);
      resolve(derivedKey as Buffer);
    });
  });
}

export function randomToken(bytes = 32) {
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > 128) throw new Error("Invalid token size");
  return randomBytes(bytes).toString("base64url");
}
export function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function hashIp(ip: string | null) { return ip ? sha256(`${config.appSecret}:ip:${ip.trim()}`) : null; }

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  // Only accept parameters produced by this application; do not let stored data request huge CPU/RAM use.
  if (n !== 16384 || r !== 8 || p !== 1) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64url");
    expected = Buffer.from(parts[5], "base64url");
  } catch { return false; }
  if (salt.length !== 16 || expected.length !== 64) return false;
  const actual = await scryptAsync(password, salt, expected.length, { N: n, r, p });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function passwordIssues(password: string) {
  const issues: string[] = [];
  if (password.length < 10) issues.push("Le mot de passe doit contenir au moins 10 caractères.");
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) issues.push("Mélangez majuscules et minuscules.");
  if (!/[0-9]/.test(password)) issues.push("Ajoutez au moins un chiffre.");
  return issues;
}

export function isEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function encryptSecret(plain: string) {
  const key = createHash("sha256").update(config.appSecret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(payload: string) {
  const parts = payload.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error("Secret chiffré invalide");
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const data = Buffer.from(dataB64, "base64url");
  if (iv.length !== 12 || tag.length !== 16) throw new Error("Secret chiffré invalide");
  const key = createHash("sha256").update(config.appSecret).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function generateTotpSecret() {
  const bytes = randomBytes(20);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) out += alphabet[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

export function totpCode(secretB32: string, at = Date.now()) {
  const key = Buffer.from(base32Decode(secretB32));
  if (!key.length) throw new Error("Secret TOTP invalide");
  const counter = Math.floor(at / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}

export function verifyTotp(secretB32: string, code: string) {
  if (!/^\d{6}$/.test(code)) return false;
  const now = Date.now();
  for (const delta of [-1, 0, 1]) {
    const expected = Buffer.from(totpCode(secretB32, now + delta * 30_000));
    const actual = Buffer.from(code);
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) return true;
  }
  return false;
}

function base32Decode(input: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/, "").toUpperCase();
  if (!clean || [...clean].some((char) => !alphabet.includes(char))) throw new Error("Secret TOTP invalide");
  let bits = "";
  for (const char of clean) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return bytes;
}
