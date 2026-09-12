import { describe, expect, it, vi } from "vitest";
import {
  buildVariantPool,
  countSpintaxGroups,
  expandSpintax,
  hasSpintax,
  listSpintaxExpansions,
  pickVariantIndex,
} from "@/lib/messaging/variation";

const always = (value: number) => () => value;

describe("spintax", () => {
  it("expands a group to one of its options", () => {
    expect(expandSpintax("{oi|olá|e aí}, tudo bem?", always(0))).toBe("oi, tudo bem?");
    expect(expandSpintax("{oi|olá|e aí}, tudo bem?", always(0.5))).toBe("olá, tudo bem?");
    expect(expandSpintax("{oi|olá|e aí}, tudo bem?", always(0.99))).toBe("e aí, tudo bem?");
  });

  it("keeps {username} and {link} placeholders untouched", () => {
    expect(expandSpintax("Oi {username}! {Segue|Aqui está} o link: {link}", always(0))).toBe(
      "Oi {username}! Segue o link: {link}"
    );
  });

  it("resolves nested groups from the inside out", () => {
    expect(expandSpintax("{bom {dia|tarde}|olá}", always(0))).toBe("bom dia");
    expect(expandSpintax("{bom {dia|tarde}|olá}", always(0.99))).toBe("olá");
  });

  it("leaves text without groups and unbalanced braces alone", () => {
    expect(expandSpintax("sem variação")).toBe("sem variação");
    expect(expandSpintax("abre { e não fecha")).toBe("abre { e não fecha");
    expect(expandSpintax("")).toBe("");
  });

  it("counts groups and lists every expansion", () => {
    expect(countSpintaxGroups("{a|b} e {c|d} com {username}")).toBe(2);
    expect(hasSpintax("{username}")).toBe(false);
    expect(hasSpintax("{a|b}")).toBe(true);
    expect(listSpintaxExpansions("{a|b} {c|d}").sort()).toEqual(["a c", "a d", "b c", "b d"]);
    expect(listSpintaxExpansions("{username} fixo")).toEqual(["{username} fixo"]);
  });
});

describe("variation picking", () => {
  it("never repeats the previous variation when there is a choice", () => {
    for (let i = 0; i < 50; i++) {
      expect(pickVariantIndex(3, 1)).not.toBe(1);
      expect(pickVariantIndex(2, 0)).toBe(1);
    }
  });

  it("uses the only option, and ignores an out-of-range last index", () => {
    expect(pickVariantIndex(1, 0)).toBe(0);
    expect(pickVariantIndex(0, null)).toBe(-1);
    expect(pickVariantIndex(3, 7, always(0.99))).toBe(2);
    expect(pickVariantIndex(3, null, always(0))).toBe(0);
  });

  it("builds a clean pool from the legacy message plus variations", () => {
    expect(buildVariantPool(" Oi ", ["Olá", "", "Oi", "  ", "E aí"])).toEqual([
      "Oi",
      "Olá",
      "E aí",
    ]);
    expect(buildVariantPool(null, undefined)).toEqual([]);
  });
});

describe("pacing", () => {
  it("draws the human delay inside the configured window and disables it at zero", async () => {
    const { normalizeHumanDelay, pickHumanDelayMs } = await import("@/lib/messaging/pacing");
    expect(pickHumanDelayMs({ humanDelayMinSeconds: 0, humanDelayMaxSeconds: 0 })).toBe(0);
    expect(pickHumanDelayMs({})).toBe(0);
    expect(pickHumanDelayMs({ humanDelayMinSeconds: 20, humanDelayMaxSeconds: 90 }, always(0))).toBe(
      20_000
    );
    expect(
      pickHumanDelayMs({ humanDelayMinSeconds: 20, humanDelayMaxSeconds: 90 }, always(0.999))
    ).toBe(90_000);
    // Swapped bounds and out-of-range values are repaired, not rejected.
    expect(normalizeHumanDelay({ humanDelayMinSeconds: 90, humanDelayMaxSeconds: 20 })).toEqual({
      minSeconds: 20,
      maxSeconds: 90,
    });
    expect(normalizeHumanDelay({ humanDelayMinSeconds: -5, humanDelayMaxSeconds: 5000 })).toEqual({
      minSeconds: 0,
      maxSeconds: 900,
    });
  });

  it("spaces sends per account through the Redis cursor and never blocks without Redis", async () => {
    vi.resetModules();
    const store = new Map<string, string>();
    const evalMock = vi.fn(async (_script: string, _n: number, key: string, now: string, gap: string) => {
      const nextFree = Number(store.get(key) ?? 0);
      const start = Math.max(Number(now), nextFree);
      store.set(key, String(start + Number(gap)));
      return start - Number(now);
    });
    vi.doMock("@/lib/queue/client", () => ({
      getRedisConnection: () => ({ eval: evalMock, get: vi.fn(), set: vi.fn() }),
    }));
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    vi.stubEnv("SEND_MIN_GAP_MS", "3000");
    const { waitForSendSlot } = await import("@/lib/messaging/pacing");
    const sleep = vi.fn(async () => {});

    expect(await waitForSendSlot("acct", sleep)).toBe(0);
    const second = await waitForSendSlot("acct", sleep);
    expect(second).toBeGreaterThan(0);
    expect(second).toBeLessThanOrEqual(3000);
    expect(sleep).toHaveBeenCalledWith(second);
    // A different account is not held back by the first one.
    expect(await waitForSendSlot("other", sleep)).toBe(0);

    vi.stubEnv("REDIS_URL", "");
    expect(await waitForSendSlot("acct", sleep)).toBe(0);
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/queue/client");
  });

  it("remembers the last variation per campaign and message kind", async () => {
    vi.resetModules();
    const store = new Map<string, string>();
    vi.doMock("@/lib/queue/client", () => ({
      getRedisConnection: () => ({
        eval: vi.fn(),
        get: async (key: string) => store.get(key) ?? null,
        set: async (key: string, value: string) => {
          store.set(key, value);
        },
      }),
    }));
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    const { resolveMessageText } = await import("@/lib/messaging/pacing");

    const first = await resolveMessageText("auto_1", "dm", "A", ["B", "C"], always(0));
    expect(first).toBe("A");
    expect(store.get("variant:last:auto_1:dm")).toBe("0");
    // With the last index remembered, the same random draw now skips "A".
    const second = await resolveMessageText("auto_1", "dm", "A", ["B", "C"], always(0));
    expect(second).toBe("B");
    // Spintax is expanded on the chosen variation; single messages skip Redis.
    expect(await resolveMessageText("auto_2", "followUp", "{Valeu|Obrigado}!", null, always(0))).toBe(
      "Valeu!"
    );
    expect(store.has("variant:last:auto_2:followUp")).toBe(false);
    expect(await resolveMessageText("auto_3", "dm", "  ", [])).toBeNull();
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/queue/client");
  });
});
