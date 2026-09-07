import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendDirectMessage: vi.fn(),
  sendDirectMessageWithLinkButton: vi.fn(),
}));

vi.mock("@/lib/meta/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/meta/client")>(
    "@/lib/meta/client"
  );
  return {
    ...actual,
    sendDirectMessage: mocks.sendDirectMessage,
    sendDirectMessageWithLinkButton: mocks.sendDirectMessageWithLinkButton,
  };
});

import {
  MetaApiError,
  RateLimitError,
  TokenExpiredError,
} from "@/lib/meta/client";
import {
  buildInlineLinkFallback,
  buildWorkerLinkButtons,
  formatWorkerError,
  isTemplateRejection,
  sendRevealDirectMessage,
  type RevealAutomation,
} from "@/lib/queue/delivery";

const links = [
  { slug: "primeiro", label: "Primeiro", destinationUrl: "https://one.test" },
  { slug: "segundo", label: "Segundo", destinationUrl: "https://two.test" },
  { slug: "terceiro", label: null, destinationUrl: "https://three.test" },
  { slug: "quarto", label: "Quarto", destinationUrl: "https://four.test" },
];

function automation(
  overrides: Partial<RevealAutomation> = {}
): RevealAutomation {
  return {
    dmMessage: "Oi, {username}! Seu acesso: {link}",
    linkButtonLabel: "Ver acesso",
    trackedLinks: links.slice(0, 2),
    instagramAccount: { instagramId: "business_1" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_URL = "https://replyflow.test";
  mocks.sendDirectMessage.mockResolvedValue({ message_id: "message_1" });
  mocks.sendDirectMessageWithLinkButton.mockResolvedValue({
    message_id: "message_1",
  });
});

describe("worker delivery primitives", () => {
  it("formats typed Meta errors without losing their numeric code", () => {
    const error = new MetaApiError(190, undefined, "trace", "token inválido");
    expect(formatWorkerError(error)).toBe(
      "Meta API Error 190: token inválido"
    );
    expect(formatWorkerError("unexpected")).toBe("Unknown error");
  });

  it("retries only failures that can plausibly be caused by the template", () => {
    expect(isTemplateRejection(new Error("unsupported button template"))).toBe(
      true
    );
    expect(
      isTemplateRejection(new Error("outside of allowed window"))
    ).toBe(false);
    expect(isTemplateRejection(new TokenExpiredError("expired"))).toBe(false);
    expect(isTemplateRejection(new RateLimitError("limited"))).toBe(false);
  });

  it("builds no more than three localized buttons", () => {
    expect(buildWorkerLinkButtons(links, "Principal")).toEqual([
      { title: "Principal", url: "https://replyflow.test/r/primeiro" },
      { title: "Segundo", url: "https://replyflow.test/r/segundo" },
      { title: "Abrir link", url: "https://replyflow.test/r/terceiro" },
    ]);
  });

  it("preserves secondary tracked links in the inline fallback", () => {
    expect(
      buildInlineLinkFallback(
        "Oi, {username}: {link}",
        "Bia",
        links.slice(0, 2),
        "fallback"
      )
    ).toBe(
      "Oi, Bia: https://replyflow.test/r/primeiro\nhttps://replyflow.test/r/segundo"
    );
  });

  it("sends plain personalized text when the campaign has no tracked links", async () => {
    await sendRevealDirectMessage(
      "token",
      automation({ trackedLinks: [] }),
      "person_1",
      "Bia",
      "test"
    );

    expect(mocks.sendDirectMessage).toHaveBeenCalledWith(
      "token",
      "business_1",
      "person_1",
      "Oi, Bia! Seu acesso: {link}"
    );
    expect(mocks.sendDirectMessageWithLinkButton).not.toHaveBeenCalled();
  });

  it("uses a button template when tracked links exist", async () => {
    await sendRevealDirectMessage(
      "token",
      automation(),
      "person_1",
      "Bia",
      "test"
    );

    expect(mocks.sendDirectMessageWithLinkButton).toHaveBeenCalledWith(
      "token",
      "business_1",
      "person_1",
      "Oi, Bia! Seu acesso:",
      [
        { title: "Ver acesso", url: "https://replyflow.test/r/primeiro" },
        { title: "Segundo", url: "https://replyflow.test/r/segundo" },
      ]
    );
    expect(mocks.sendDirectMessage).not.toHaveBeenCalled();
  });

  it("falls back to inline links after a template rejection", async () => {
    mocks.sendDirectMessageWithLinkButton.mockRejectedValueOnce(
      new Error("unsupported template")
    );

    await sendRevealDirectMessage(
      "token",
      automation(),
      "person_1",
      "Bia",
      "test"
    );

    expect(mocks.sendDirectMessage).toHaveBeenCalledWith(
      "token",
      "business_1",
      "person_1",
      "Oi, Bia! Seu acesso: https://replyflow.test/r/primeiro\nhttps://replyflow.test/r/segundo"
    );
  });

  it("does not retry a recipient refusal as plain text", async () => {
    const refusal = new Error("requested user cannot be found");
    mocks.sendDirectMessageWithLinkButton.mockRejectedValueOnce(refusal);

    await expect(
      sendRevealDirectMessage(
        "token",
        automation(),
        "person_1",
        "Bia",
        "test"
      )
    ).rejects.toBe(refusal);
    expect(mocks.sendDirectMessage).not.toHaveBeenCalled();
  });

  it("keeps the original template diagnostic if the fallback also fails", async () => {
    const templateError = new Error("unsupported template");
    mocks.sendDirectMessageWithLinkButton.mockRejectedValueOnce(templateError);
    mocks.sendDirectMessage.mockRejectedValueOnce(new Error("secondary error"));

    await expect(
      sendRevealDirectMessage(
        "token",
        automation(),
        "person_1",
        "Bia",
        "test"
      )
    ).rejects.toBe(templateError);
  });
});
