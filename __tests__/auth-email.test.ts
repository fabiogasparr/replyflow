import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("nodemailer", () => ({ createTransport: () => ({ sendMail }) }));

import { buildSignInEmail, sendResendVerification, sendSmtpVerification } from "@/lib/auth-email";

const params = {
  identifier: "test@example.com",
  url: 'http://localhost:3000/api/auth/callback/resend?token=test&email=a%40example.com',
  expires: new Date("2026-09-05T00:00:00Z"),
  provider: { id: "resend", type: "email", name: "Resend", from: "login@example.com", maxAge: 86400, apiKey: "test-key", sendVerificationRequest: sendResendVerification },
  token: "test",
  theme: {},
  request: new Request("http://localhost:3000"),
} satisfies Parameters<typeof sendResendVerification>[0];

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("sign-in email", () => {
  it("keeps the exact verification URL in text and escapes it in HTML", () => {
    const url = 'https://example.com/login?token=a&value="<test>"';
    const email = buildSignInEmail(url);
    expect(email.text).toContain(url);
    expect(email.html).toContain('&amp;value=&quot;&lt;test&gt;&quot;');
    expect(email.html).toContain('lang="pt-BR"');
    expect(email.subject).toBe("Seu link de acesso ao ReplyFlow");
    expect(() => buildSignInEmail("javascript:alert(1)")).toThrow();
  });

  it("sends the same localized content through SMTP", async () => {
    sendMail.mockResolvedValue({ rejected: [], pending: [] });
    await sendSmtpVerification(params);
    expect(sendMail).toHaveBeenCalledWith({
      to: params.identifier, from: params.provider.from, ...buildSignInEmail(params.url),
    });
    sendMail.mockResolvedValue({ rejected: [params.identifier] });
    await expect(sendSmtpVerification(params)).rejects.toThrow("Não foi possível enviar");
  });

  it("passes the verification link to Resend and rejects failed deliveries without exposing its token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await sendResendVerification(params);
    const options = fetchMock.mock.calls[0][1];
    expect(JSON.parse(options.body)).toEqual({
      to: params.identifier, from: params.provider.from, ...buildSignInEmail(params.url),
    });
    fetchMock.mockResolvedValue({ ok: false, status: 429 });
    await expect(sendResendVerification(params)).rejects.toThrow("(429)");
  });
});
