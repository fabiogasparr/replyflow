import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Meta "Data Deletion Request" callback support.
 *
 * When a person removes the app from their Instagram/Facebook settings and
 * asks for their data to be deleted, Meta POSTs a `signed_request` to the
 * callback configured in the app dashboard. The request is
 * `<base64url signature>.<base64url payload>`, where the signature is an
 * HMAC-SHA256 of the payload string keyed with the app secret. The app must
 * answer with a status URL and a confirmation code the person can use to
 * follow up.
 *
 * https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 */

export interface SignedRequestPayload {
  user_id?: string;
  algorithm?: string;
  issued_at?: number;
  [key: string]: unknown;
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

/** Secrets that may have signed a request from this app (either login type). */
export function getMetaAppSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.FACEBOOK_APP_SECRET, env.INSTAGRAM_APP_SECRET]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s))
    .filter((s, i, all) => all.indexOf(s) === i);
}

/**
 * Verify and decode a Meta signed_request. Returns the payload when the
 * signature matches one of the app secrets, null otherwise (malformed input,
 * wrong secret, unsupported algorithm).
 */
export function parseSignedRequest(
  signedRequest: string | null | undefined,
  secrets: string[]
): SignedRequestPayload | null {
  if (!signedRequest || typeof signedRequest !== "string") return null;
  const parts = signedRequest.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [encodedSignature, encodedPayload] = parts;

  let signature: Buffer;
  let payload: SignedRequestPayload;
  try {
    signature = base64UrlDecode(encodedSignature);
    payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  if (
    typeof payload.algorithm === "string" &&
    payload.algorithm.toUpperCase() !== "HMAC-SHA256"
  ) {
    return null;
  }

  const valid = secrets.some((secret) => {
    const expected = createHmac("sha256", secret).update(encodedPayload).digest();
    return (
      expected.length === signature.length && timingSafeEqual(expected, signature)
    );
  });
  return valid ? payload : null;
}

/** Short, URL-safe code without look-alike characters, shown to the person. */
export function generateConfirmationCode(random: () => Buffer = () => randomBytes(8)): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = random();
  let code = "";
  for (let i = 0; i < 10; i++) {
    code += alphabet[bytes[i % bytes.length] % alphabet.length];
  }
  return `RF-${code.slice(0, 5)}-${code.slice(5)}`;
}

export function isConfirmationCode(value: string | null | undefined): value is string {
  return typeof value === "string" && /^RF-[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(value);
}

/** Build the status URL Meta shows to the person who asked for deletion. */
export function buildDeletionStatusUrl(baseUrl: string, code: string): string {
  const url = new URL("/data-deletion", baseUrl);
  url.searchParams.set("code", code);
  return url.toString();
}

/**
 * Sign a payload the way Meta does — used by tests and by the local
 * "simulate deletion" tooling so the callback can be exercised without Meta.
 */
export function signRequest(payload: SignedRequestPayload, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const signature = createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${signature}.${encodedPayload}`;
}
