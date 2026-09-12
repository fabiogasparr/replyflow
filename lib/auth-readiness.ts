export type EmailAuthReadiness = {
  ready: boolean;
  provider: "resend" | "smtp";
  message: string | null;
};

const PLACEHOLDER_PATTERN = /(?:\.\.\.|replace|example|changeme|re_test)/i;

export function hasUsableEmailSender(value: string | undefined) {
  if (!value || PLACEHOLDER_PATTERN.test(value)) return false;
  const match = value.match(/<([^>]+)>/) ?? value.match(/([^\s]+@[^\s]+)/);
  return Boolean(match?.[1]?.includes("@"));
}

export function hasUsableResendKey(value: string | undefined) {
  if (!value || PLACEHOLDER_PATTERN.test(value)) return false;
  return value.startsWith("re_") && value.length >= 12;
}

export function hasUsableSmtpServer(value: string | undefined) {
  if (!value || PLACEHOLDER_PATTERN.test(value)) return false;
  try {
    const url = new URL(value);
    return ["smtp:", "smtps:"].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Syntactic readiness only. A provider can still reject a valid-looking key,
 * but placeholders are caught before Auth.js attempts to send an email.
 */
export function getEmailAuthReadiness(
  env: NodeJS.ProcessEnv = process.env
): EmailAuthReadiness {
  const provider = env.EMAIL_SERVER ? "smtp" : "resend";
  const senderReady = hasUsableEmailSender(env.EMAIL_FROM);
  const transportReady =
    provider === "smtp"
      ? hasUsableSmtpServer(env.EMAIL_SERVER)
      : hasUsableResendKey(env.RESEND_API_KEY);

  if (senderReady && transportReady) {
    return { ready: true, provider, message: null };
  }

  return {
    ready: false,
    provider,
    message:
      "O envio do link de acesso ainda não está configurado neste ambiente. Fale com o administrador do ReplyFlow.",
  };
}

export type AuthErrorContent = {
  title: string;
  description: string;
};

const AUTH_ERROR_CONTENT: Record<string, AuthErrorContent> = {
  TooManyRequests: {
    title: "Aguarde antes de pedir outro link",
    description: "Confira sua caixa de entrada e use o link mais recente. Novos pedidos estão temporariamente limitados; tente novamente mais tarde. Sua sessão e os links já recebidos continuam válidos dentro do prazo original.",
  },
  ServiceUnavailable: {
    title: "Envio temporariamente indisponível",
    description: "Não foi possível verificar o limite de envio agora. Aguarde um instante e tente novamente. Se já recebeu um link, você ainda pode usá-lo dentro do prazo de validade.",
  },
  Configuration: {
    title: "Acesso temporariamente indisponível",
    description:
      "O provedor de autenticação precisa ser configurado ou corrigido pelo administrador do ReplyFlow.",
  },
  AccessDenied: {
    title: "Acesso não autorizado",
    description:
      "Este e-mail não tem permissão para entrar neste ambiente do ReplyFlow.",
  },
  Verification: {
    title: "Link inválido ou expirado",
    description:
      "Solicite um novo link de acesso. Cada link é pessoal, de uso único e tem validade limitada.",
  },
};

export function getAuthErrorContent(
  error: string | string[] | undefined
): AuthErrorContent {
  const code = Array.isArray(error) ? error[0] : error;
  return (
    (code ? AUTH_ERROR_CONTENT[code] : undefined) ?? {
      title: "Não foi possível entrar",
      description:
        "Tente solicitar um novo link. Se o problema continuar, fale com o administrador do ReplyFlow.",
    }
  );
}
