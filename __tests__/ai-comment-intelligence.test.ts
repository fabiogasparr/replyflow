import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatCompletion,
  getAiConfig,
  parseJsonObject,
  AiUnavailableError,
} from "@/lib/ai/client";
import {
  assessComment,
  generatePersonalizedDm,
  generatePersonalizedPublicReply,
  generateVariations,
  humanReviewMessage,
  shouldHoldForHuman,
} from "@/lib/ai/comment-intelligence";

function completion(content: string, status = 200) {
  return {
    ok: status < 400,
    status,
    text: async () => content,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response;
}

const context = {
  brandUsername: "kz3solucoes",
  campaignName: "Guia IA",
  campaignGoal: "Entregar o guia",
  instructions: "Tom próximo, nunca prometa preço.",
  keywords: ["guia"],
};

beforeEach(() => {
  vi.stubEnv("AI_BASE_URL", "https://ai.example.com/v1/");
  vi.stubEnv("AI_API_KEY", "key");
  vi.stubEnv("AI_MODEL", "primary");
  vi.stubEnv("AI_FALLBACK_MODEL", "backup");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("AI client", () => {
  it("reads the configuration and strips a trailing slash from the base URL", () => {
    expect(getAiConfig()).toMatchObject({
      baseUrl: "https://ai.example.com/v1",
      model: "primary",
      fallbackModel: "backup",
    });
    vi.stubEnv("AI_API_KEY", "");
    expect(getAiConfig()).toBeNull();
  });

  it("falls back to the second model when the first fails", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { model: string };
      return body.model === "primary" ? completion("boom", 500) : completion("ok from backup");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatCompletion({ messages: [{ role: "user", content: "oi" }] });

    expect(result).toEqual({ text: "ok from backup", model: "backup" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://ai.example.com/v1/chat/completions");
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: "Bearer key",
    });
  });

  it("throws AiUnavailableError without configuration and surfaces the last provider error", async () => {
    vi.stubEnv("AI_MODEL", "");
    await expect(chatCompletion({ messages: [] })).rejects.toBeInstanceOf(AiUnavailableError);

    vi.stubEnv("AI_MODEL", "primary");
    vi.stubGlobal("fetch", vi.fn(async () => completion("", 503)));
    await expect(chatCompletion({ messages: [] })).rejects.toThrow(/HTTP 503/);
  });

  it("strips <think> blocks and recognises a leaked scratchpad", async () => {
    const { stripReasoning, looksLikeReasoning } = await import("@/lib/ai/client");
    expect(stripReasoning("<think>plan…</think>Oi! Te mandei no direct")).toBe("Oi! Te mandei no direct");
    expect(stripReasoning("<think>never closed")).toBe("");
    expect(looksLikeReasoning("We need to produce a public reply in Portuguese…")).toBe(true);
    expect(looksLikeReasoning("Let me think about the comment first")).toBe(true);
    expect(looksLikeReasoning("Oi Bia! Te mandei o guia no direct 😊")).toBe(false);

    vi.stubGlobal("fetch", vi.fn(async () => completion("We need to produce a public reply that says…")));
    expect(
      await generatePersonalizedPublicReply({ commentText: "guia", commenterName: "Bia", context })
    ).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => completion("<think>hmm</think>Oi Bia, te mandei o guia no direct 😊")));
    expect(
      await generatePersonalizedPublicReply({ commentText: "guia", commenterName: "Bia", context })
    ).toBe("Oi Bia, te mandei o guia no direct 😊");
  });

  it("parses JSON out of fenced or chatty completions", () => {
    expect(parseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonObject('Claro! Aqui está: {"a":{"b":2}} espero que ajude')).toEqual({
      a: { b: 2 },
    });
    expect(parseJsonObject("[1,2]")).toBeNull();
    expect(parseJsonObject("nada")).toBeNull();
  });
});

describe("comment triage", () => {
  it("classifies a comment and decides when a person must answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        completion(
          '{"sentiment":"negative","hostile":true,"needsHuman":false,"reason":"Xinga a marca"}'
        )
      )
    );
    const assessment = await assessComment("Vocês são uma vergonha, lixo!", context);
    expect(assessment).toEqual({
      sentiment: "NEGATIVE",
      hostile: true,
      needsHuman: false,
      reason: "Xinga a marca",
    });
    expect(shouldHoldForHuman(assessment, "HOSTILE")).toBe(true);
    expect(humanReviewMessage(assessment!)).toContain("ofensivo");
  });

  it("only holds polite negativity when sensitivity is NEGATIVE", () => {
    const polite = { sentiment: "NEGATIVE" as const, hostile: false, needsHuman: false, reason: "" };
    expect(shouldHoldForHuman(polite, "HOSTILE")).toBe(false);
    expect(shouldHoldForHuman(polite, "NEGATIVE")).toBe(true);
    expect(shouldHoldForHuman(null, "NEGATIVE")).toBe(false);
    expect(
      shouldHoldForHuman({ ...polite, sentiment: "POSITIVE", needsHuman: true }, "HOSTILE")
    ).toBe(true);
  });

  it("returns null (no opinion) when the model is unavailable or unparsable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => completion("não sei")));
    expect(await assessComment("oi", context)).toBeNull();
    vi.stubEnv("AI_API_KEY", "");
    expect(await assessComment("oi", context)).toBeNull();
  });
});

describe("personalised wording", () => {
  it("writes a short public reply without links, or gives up so the template is used", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => completion('"Oi Bia! Te mandei o guia no direct 😊"')));
    expect(
      await generatePersonalizedPublicReply({
        commentText: "guia!",
        commenterName: "Bia",
        templateExample: "Enviei no direct!",
        context,
      })
    ).toBe("Oi Bia! Te mandei o guia no direct 😊");

    vi.stubGlobal("fetch", vi.fn(async () => completion("Veja em https://spam.example")));
    expect(
      await generatePersonalizedPublicReply({ commentText: "guia", context })
    ).toBeNull();
  });

  it("guarantees the {link} placeholder in a DM that delivers a link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => completion("Oi {username}, aqui vai o guia que você pediu")));
    const dm = await generatePersonalizedDm({
      commentText: "guia",
      commenterName: "Bia",
      template: "Oi {username}! Seu guia: {link}",
      hasLink: true,
      context,
    });
    expect(dm).toBe("Oi {username}, aqui vai o guia que você pediu {link}");

    vi.stubGlobal("fetch", vi.fn(async () => completion("Sem link aqui {link} mesmo")));
    expect(
      await generatePersonalizedDm({ commentText: "x", template: "y", hasLink: false, context })
    ).toBe("Sem link aqui mesmo");
  });

  it("generates deduplicated variations that keep the link placeholder", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        completion(
          '{"variations":["Segue o link {link}","Segue o link {link}","Aqui está o que você pediu","Oi! O material está aqui: {link}"]}'
        )
      )
    );
    const variations = await generateVariations({
      base: "Aqui está o link: {link}",
      count: 3,
      kind: "dm",
      context,
    });
    expect(variations).toEqual([
      "Segue o link {link}",
      "Aqui está o que você pediu {link}",
      "Oi! O material está aqui: {link}",
    ]);
  });
});
