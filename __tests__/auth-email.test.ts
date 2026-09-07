import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("nodemailer", () => ({ createTransport: () => ({ sendMail }) }));

import { buildSignInEmail, sendResendVerification, sendSmtpVerification } from "@/lib/auth-email";

const params = {
  identifier: "test@example.com",
  url: 'http://localhost:3000/api/auth/callback/resend?token=test&email=a%40example.com',
  expires: new Date("2026-09-05T00:00:00Z"),
  provider: { id: "resend", type: "email", name: "Resend", from: "acesso@replyflow.com.br", maxAge: 86400, apiKey: "re_1234567890abcdef", sendVerificationRequest: sendResendVerification },
  token: "test",
  theme: {},
  request: new Request("http://localhost:3000"),
} satisfies Parameters<typeof sendResendVerification>[0];

const smtpParams = {
  ...params,
  provider: {
    id: "nodemailer",
    type: "email",
    name: "Nodemailer",
    from: "acesso@replyflow.com.br",
    maxAge: 86400,
    server: "smtps://user:secret@mail.replyflow.test:465",
    sendVerificationRequest: sendSmtpVerification,
  },
} satisfies Parameters<typeof sendSmtpVerification>[0];

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
    await sendSmtpVerification(smtpParams);
    expect(sendMail).toHaveBeenCalledWith({
      to: smtpParams.identifier, from: smtpParams.provider.from, ...buildSignInEmail(smtpParams.url),
    });
    sendMail.mockResolvedValue({ rejected: [smtpParams.identifier] });
    await expect(sendSmtpVerification(smtpParams)).rejects.toThrow("Não foi possível enviar");
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

  it("blocks placeholder provider values before any external delivery call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendResendVerification({
        ...params,
        provider: { ...params.provider, apiKey: "re_..." },
      })
    ).rejects.toThrow("não está configurado");
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(
      sendSmtpVerification({
        ...smtpParams,
        provider: { ...smtpParams.provider, server: "https://mail.test" },
      })
    ).rejects.toThrow("não está configurado");
    expect(sendMail).not.toHaveBeenCalled();
  });
});
