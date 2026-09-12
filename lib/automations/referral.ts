import { randomBytes } from "crypto";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alikes

/** Short, URL-safe code for ig.me links: https://ig.me/m/<user>?ref=<code>. */
export function generateReferralCode(length = 8): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function buildReferralLink(username: string, code: string): string {
  return `https://ig.me/m/${encodeURIComponent(username)}?ref=${encodeURIComponent(code)}`;
}
