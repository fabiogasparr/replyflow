import { describe, expect, it } from "vitest";
import { normalizeAuthEmail } from "@/lib/auth-email-address";

describe("authentication email normalization", () => {
  it("normalizes a single address consistently before authorization and delivery", () => {
    expect(normalizeAuthEmail("  Owner+Test@Example.com  ")).toBe("owner+test@example.com");
    expect(normalizeAuthEmail("tester@replyflow.test")).toBe("tester@replyflow.test");
  });
  it.each([
    "owner@example.com,attacker@example.net", "owner@example.com;attacker@example.net",
    "Owner <owner@example.com>", "owner@example.com(comment)",
    "group:owner@example.com;", "owner@example.com\r\nBcc:attacker@example.net",
    "\nowner@example.com", "owner@example.com\u0000", "owner@ｅxample.com",
    "", "a".repeat(321), "a".repeat(65) + "@example.com",
  ])("rejects ambiguous, oversized or malformed input without echoing it: %j", (input) => {
    expect(() => normalizeAuthEmail(input)).toThrow("Informe um único endereço de e-mail válido.");
  });
});
