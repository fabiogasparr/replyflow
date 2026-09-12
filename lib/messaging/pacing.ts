/**
 * Human pacing for outbound Instagram sends.
 *
 * Meta's hard caps are enforced by lib/utils/rate-limiter.ts. This module is
 * about *looking* human, which is what actually keeps an account out of
 * Instagram's automation heuristics:
 *
 *  - Human delay: a campaign can wait a random number of seconds before its
 *    public reply and DM go out (see Automation.humanDelayMinSeconds/Max).
 *  - Send spacing: sends from the same Instagram account are spaced at least
 *    SEND_MIN_GAP_MS apart, across every worker process, using a Redis
 *    "next free slot" cursor. Concurrency stays high for different accounts.
 *  - Variant memory: the index of the last variation used per campaign and
 *    message kind, so the next pick can avoid repeating it.
 *
 * Everything here is best-effort: when Redis is unavailable the helpers return
 * immediately instead of blocking a send.
 */

import { getRedisConnection } from "@/lib/queue/client";
import {
  buildVariantPool,
  expandSpintax,
  pickVariantIndex,
  type RandomSource,
} from "./variation";

export const HUMAN_DELAY_MAX_SECONDS = 900; // 15 minutes
const DEFAULT_SEND_MIN_GAP_MS = 3000;
const MAX_INLINE_WAIT_MS = 60_000;
const VARIANT_MEMORY_TTL_SECONDS = 7 * 24 * 3600;

export type MessageKind =
  | "publicReply"
  | "dm"
  | "openingDm"
  | "followPrompt"
  | "followUp";

interface HumanDelayConfig {
  humanDelayMinSeconds?: number | null;
  humanDelayMaxSeconds?: number | null;
}

/** Clamp a min/max pair to a sane, ordered range. */
export function normalizeHumanDelay(config: HumanDelayConfig): {
  minSeconds: number;
  maxSeconds: number;
} {
  const clamp = (value: number | null | undefined) =>
    Math.max(0, Math.min(HUMAN_DELAY_MAX_SECONDS, Math.floor(value ?? 0)));
  let minSeconds = clamp(config.humanDelayMinSeconds);
  let maxSeconds = clamp(config.humanDelayMaxSeconds);
  if (maxSeconds < minSeconds) [minSeconds, maxSeconds] = [maxSeconds, minSeconds];
  return { minSeconds, maxSeconds };
}

/** Milliseconds to wait before acting on a trigger; 0 when disabled. */
export function pickHumanDelayMs(
  config: HumanDelayConfig,
  random: RandomSource = Math.random
): number {
  const { minSeconds, maxSeconds } = normalizeHumanDelay(config);
  if (maxSeconds <= 0) return 0;
  const span = maxSeconds - minSeconds;
  const seconds = minSeconds + Math.floor(random() * (span + 1));
  return Math.min(maxSeconds, seconds) * 1000;
}

function sendMinGapMs(): number {
  const raw = Number(process.env.SEND_MIN_GAP_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_SEND_MIN_GAP_MS;
}

type RedisLike = {
  eval: (...args: unknown[]) => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  set: (...args: unknown[]) => Promise<unknown>;
};

function redis(): RedisLike | null {
  if (!process.env.REDIS_URL) return null;
  try {
    const client = getRedisConnection() as unknown as RedisLike | undefined;
    if (!client || typeof client.eval !== "function") return null;
    return client;
  } catch {
    return null;
  }
}

// Reserve the next free send slot for an account and return how long the
// caller must wait for it. The cursor only ever moves forward, so concurrent
// workers line up behind each other instead of firing together.
const RESERVE_SEND_SLOT_SCRIPT = `
local now = tonumber(ARGV[1])
local gap = tonumber(ARGV[2])
local nextFree = tonumber(redis.call("GET", KEYS[1]) or "0")
local start = now
if nextFree > now then start = nextFree end
redis.call("SET", KEYS[1], start + gap, "PX", math.max(gap * 20, 1000))
return start - now
`;

/**
 * Wait until this Instagram account's next send slot. Resolves immediately
 * when spacing is disabled (SEND_MIN_GAP_MS=0) or Redis is unavailable.
 */
export async function waitForSendSlot(
  instagramAccountId: string,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms))
): Promise<number> {
  const gap = sendMinGapMs();
  if (gap <= 0) return 0;
  const client = redis();
  if (!client) return 0;

  let waitMs = 0;
  try {
    const result = await client.eval(
      RESERVE_SEND_SLOT_SCRIPT,
      1,
      `send:next:${instagramAccountId}`,
      Date.now(),
      gap
    );
    waitMs = typeof result === "number" ? result : Number(result) || 0;
  } catch {
    return 0;
  }

  waitMs = Math.max(0, Math.min(MAX_INLINE_WAIT_MS, waitMs));
  if (waitMs > 0) await sleep(waitMs);
  return waitMs;
}

function variantKey(automationId: string, kind: MessageKind): string {
  return `variant:last:${automationId}:${kind}`;
}

async function readLastVariant(
  automationId: string,
  kind: MessageKind
): Promise<number | null> {
  const client = redis();
  if (!client) return null;
  try {
    const raw = await client.get(variantKey(automationId, kind));
    if (raw === null) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function rememberVariant(
  automationId: string,
  kind: MessageKind,
  index: number
): Promise<void> {
  const client = redis();
  if (!client) return;
  try {
    await client.set(
      variantKey(automationId, kind),
      String(index),
      "EX",
      VARIANT_MEMORY_TTL_SECONDS
    );
  } catch {
    // best-effort
  }
}

/**
 * Choose the text to send for one message kind of a campaign: pick a
 * variation (avoiding the one used last time) and expand any spintax in it.
 * Returns null when there is nothing to send.
 */
export async function resolveMessageText(
  automationId: string,
  kind: MessageKind,
  legacy: string | null | undefined,
  variants?: readonly string[] | null,
  random: RandomSource = Math.random
): Promise<string | null> {
  const pool = buildVariantPool(legacy, variants);
  if (pool.length === 0) return null;

  let index = 0;
  if (pool.length > 1) {
    const last = await readLastVariant(automationId, kind);
    index = pickVariantIndex(pool.length, last, random);
    await rememberVariant(automationId, kind, index);
  }
  return expandSpintax(pool[index], random);
}
