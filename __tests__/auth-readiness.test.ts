import { describe, expect, it } from "vitest";
import {
  getAuthErrorContent,
  getEmailAuthReadiness,
} from "@/lib/auth-readiness";

function env(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    EMAIL_FROM: "ReplyFlow <acesso@replyflow.com.br>",
    RESEND_API_KEY: "re_1234567890abcdef",
    ...overrides,
  };
}

describe("email authentication readiness", () => {
  it("accepts a configured Resend transport and sender", () => {
    expect(getEmailAuthReadiness(env())).toEqual({
      ready: true,
      provider: "resend",
      message: null,
    });
  });

  it("rejects missing and placeholder Resend keys", () => {
    expect(
      getEmailAuthReadiness(env({ RESEND_API_KEY: undefined })).ready
    ).toBe(false);
    expect(getEmailAuthReadiness(env({ RESEND_API_KEY: "re_..." })).ready).toBe(
      false
    );
    expect(getEmailAuthReadiness(env({ RESEND_API_KEY: "re_test" })).ready).toBe(
      false
    );
  });

  it("rejects a placeholder sender before the provider is called", () => {
    const readiness = getEmailAuthReadiness(
      env({ EMAIL_FROM: "ReplyFlow <login@example.com>" })
    );
    expect(readiness).toMatchObject({ ready: false, provider: "resend" });
    expect(readiness.message).toContain("administrador");
  });

  it("uses a valid SMTP URL instead of requiring a Resend key", () => {
    expect(
      getEmailAuthReadiness(
        env({
          EMAIL_SERVER: "smtps://user:secret@mail.replyflow.test:465",
          RESEND_API_KEY: undefined,
        })
      )
    ).toEqual({ ready: true, provider: "smtp", message: null });
  });

  it("rejects malformed or non-SMTP transport URLs", () => {
    expect(
      getEmailAuthReadiness(env({ EMAIL_SERVER: "https://mail.test" })).ready
    ).toBe(false);
    expect(
      getEmailAuthReadiness(env({ EMAIL_SERVER: "not-a-url" })).ready
    ).toBe(false);
  });
});

describe("safe authentication error content", () => {
  it("translates known Auth.js errors without exposing diagnostics", () => {
    expect(getAuthErrorContent("Configuration")).toEqual({
      title: "Acesso temporariamente indisponível",
      description:
        "O provedor de autenticação precisa ser configurado ou corrigido pelo administrador do ReplyFlow.",
    });
    expect(getAuthErrorContent(["Verification", "ignored"]).title).toBe(
      "Link inválido ou expirado"
    );
  });

  it("uses a stable fallback for untrusted error codes", () => {
    const content = getAuthErrorContent("<script>alert(1)</script>");
    expect(content.title).toBe("Não foi possível entrar");
    expect(JSON.stringify(content)).not.toContain("<script>");
  });
});
