import { createTransport } from "nodemailer";
import type { NodemailerConfig } from "next-auth/providers/nodemailer";
import { normalizeAuthEmail } from "@/lib/auth-email-address";
import {
  hasUsableEmailSender,
  hasUsableResendKey,
  hasUsableSmtpServer,
} from "@/lib/auth-readiness";

const AUTH_CONFIGURATION_ERROR =
  "O provedor de e-mail do ReplyFlow não está configurado";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function buildSignInEmail(url: string) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Invalid sign-in URL protocol");
  }
  const safeUrl = escapeHtml(url);
  const host = escapeHtml(parsed.host);
  return {
    subject: "Seu link de acesso ao ReplyFlow",
    text: `Entre no ReplyFlow\n\nUse este link para acessar ${parsed.host}:\n${url}\n\nEste link é pessoal e de uso único. Se você não solicitou o acesso, ignore este e-mail.`,
    html: `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:32px;background:#f5f7f6;font-family:Arial,sans-serif;color:#112620">
      <main style="max-width:480px;margin:auto;padding:32px;background:#fff;border-radius:16px">
        <p style="font-size:20px;font-weight:bold">ReplyFlow</p>
        <h1 style="font-size:24px">Seu acesso está pronto</h1>
        <p>Use o botão abaixo para entrar em ${host}.</p>
        <a href="${safeUrl}" style="display:inline-block;margin:16px 0;padding:14px 24px;background:#112620;color:#fff;border-radius:8px;text-decoration:none">Entrar no ReplyFlow</a>
        <p style="font-size:13px;color:#52645b">Este link é pessoal e de uso único. Se você não solicitou o acesso, ignore este e-mail.</p>
      </main></body></html>`,
  };
}

export const sendSmtpVerification: NodemailerConfig["sendVerificationRequest"] = async ({ identifier, url, provider }) => {
  const recipient = normalizeAuthEmail(identifier);
  if (
    !hasUsableEmailSender(provider.from) ||
    typeof provider.server !== "string" ||
    !hasUsableSmtpServer(provider.server)
  ) {
    throw new Error(AUTH_CONFIGURATION_ERROR);
  }
  const transport = createTransport(provider.server);
  const result = await transport.sendMail({
    to: { name: "", address: recipient },
    from: provider.from,
    disableFileAccess: true,
    disableUrlAccess: true,
    ...buildSignInEmail(url),
  });
  if ([...(result.rejected ?? []), ...(result.pending ?? [])].filter(Boolean).length) {
    throw new Error("Não foi possível enviar o e-mail de acesso");
  }
};

export const sendResendVerification: NodemailerConfig["sendVerificationRequest"] = async ({ identifier, url, provider }) => {
  const recipient = normalizeAuthEmail(identifier);
  if (
    !hasUsableEmailSender(provider.from) ||
    !hasUsableResendKey(provider.apiKey)
  ) {
    throw new Error(AUTH_CONFIGURATION_ERROR);
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: provider.from,
      to: recipient,
      ...buildSignInEmail(url),
    }),
  });
  if (!response.ok) {
    // Do not log the authentication URL or recipient on transport failures.
    throw new Error(`Não foi possível enviar o e-mail de acesso (${response.status})`);
  }
};
