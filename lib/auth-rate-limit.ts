import { createHmac } from "node:crypto";
import Redis from "ioredis";
import { normalizeAuthEmail } from "@/lib/auth-email-address";

export const AUTH_EMAIL_LIMITS = {
  cooldownSeconds: 60,
  recipientWindowSeconds: 900,
  recipientLimit: 5,
  globalWindowSeconds: 3600,
  globalLimit: 300,
} as const;

export type AuthEmailReservation =
  | { allowed: true }
  | { allowed: false; reason: "limited" | "unavailable"; retryAfterSeconds: number };

export function getAuthEmailLimitKeys(email: string, secret: string) {
  if (secret.length < 16) throw new Error("Authentication limiter secret unavailable");
  const digest = (value: string) => createHmac("sha256", secret).update(value).digest("hex");
  // Shared hash tag keeps the atomic script compatible with Redis Cluster.
  // Neither recipient addresses nor authentication tokens enter Redis keys.
  const prefix = `replyflow:{auth-email-${digest("namespace-v1").slice(0, 16)}}`;
  const recipient = digest(normalizeAuthEmail(email));
  return [`${prefix}:global`, `${prefix}:${recipient}:window`, `${prefix}:${recipient}:cooldown`];
}

export const RESERVE_AUTH_EMAIL_SCRIPT = `
local retry = 0
local global_count = tonumber(redis.call("GET", KEYS[1]) or "0")
local recipient_count = tonumber(redis.call("GET", KEYS[2]) or "0")
if global_count >= tonumber(ARGV[1]) then
  retry = math.max(retry, redis.call("TTL", KEYS[1]), 1)
end
if recipient_count >= tonumber(ARGV[3]) then
  retry = math.max(retry, redis.call("TTL", KEYS[2]), 1)
end
if redis.call("EXISTS", KEYS[3]) == 1 then
  retry = math.max(retry, redis.call("TTL", KEYS[3]), 1)
end
if retry > 0 then return {0, retry} end

local next_global = redis.call("INCR", KEYS[1])
if next_global == 1 then redis.call("EXPIRE", KEYS[1], ARGV[2]) end
local next_recipient = redis.call("INCR", KEYS[2])
if next_recipient == 1 then redis.call("EXPIRE", KEYS[2], ARGV[4]) end
redis.call("SET", KEYS[3], "1", "EX", ARGV[5])
return {1, 0}
`;

export async function reserveAuthEmailSlot(
  redis: Pick<Redis, "eval">,
  email: string,
  secret: string,
  globalLimit: number = AUTH_EMAIL_LIMITS.globalLimit,
): Promise<AuthEmailReservation> {
  if (!Number.isInteger(globalLimit) || globalLimit < 1 || globalLimit > 100_000) {
    throw new Error("Invalid authentication email limit");
  }
  const keys = getAuthEmailLimitKeys(email, secret);
  const result = await redis.eval(RESERVE_AUTH_EMAIL_SCRIPT, keys.length, ...keys,
    globalLimit, AUTH_EMAIL_LIMITS.globalWindowSeconds,
    AUTH_EMAIL_LIMITS.recipientLimit, AUTH_EMAIL_LIMITS.recipientWindowSeconds,
    AUTH_EMAIL_LIMITS.cooldownSeconds);
  if (Array.isArray(result) && result[0] === 1 && result[1] === 0) return { allowed: true };
  if (Array.isArray(result) && result[0] === 0 && Number.isInteger(result[1]) && result[1] > 0) {
    return { allowed: false, reason: "limited", retryAfterSeconds: result[1] };
  }
  throw new Error("Invalid authentication limiter response");
}

/** Separate bounded connection: BullMQ's indefinite retry policy is unsafe for login requests. */
export async function reserveAuthEmail(email: string): Promise<AuthEmailReservation> {
  let redis: Redis | undefined;
  try {
    const secret = process.env.NEXTAUTH_SECRET ?? "";
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl || secret.length < 16) throw new Error("Authentication limiter unavailable");
    const globalLimit = process.env.AUTH_EMAIL_GLOBAL_LIMIT === undefined
      ? AUTH_EMAIL_LIMITS.globalLimit : Number(process.env.AUTH_EMAIL_GLOBAL_LIMIT);
    if (!Number.isInteger(globalLimit) || globalLimit < 1 || globalLimit > 100_000) {
      throw new Error("Invalid authentication email limit");
    }
    redis = new Redis(redisUrl, {
      lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0,
      connectTimeout: 2000, commandTimeout: 2000, retryStrategy: () => null,
    });
    // Remote connection errors can contain infrastructure details. Never log them here.
    redis.on("error", () => {});
    await redis.connect();
    return await reserveAuthEmailSlot(redis, email, secret, globalLimit);
  } catch {
    return { allowed: false, reason: "unavailable", retryAfterSeconds: 60 };
  } finally {
    redis?.disconnect();
  }
}
