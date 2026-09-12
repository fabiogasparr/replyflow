"use client";

import { useSearchParams } from "next/navigation";

type Tone = "error" | "warning" | "success";

const TONE_CLASSES: Record<Tone, string> = {
  error: "border-error/20 bg-error/10 text-error",
  warning: "border-warning/20 bg-warning/10 text-warning",
  success: "border-success/20 bg-success/10 text-success",
};

const MESSAGES: Record<string, { tone: Tone; title: string; detail: string }> = {
  workspace_changed: {
    tone: "warning",
    title: "O espaço ativo mudou",
    detail: "Confira o espaço selecionado e inicie novamente a autorização para conectar a conta ao cliente correto.",
  },
  misconfigured: {
    tone: "warning",
    title: "Conexão ainda em preparação",
    detail: "A equipe ReplyFlow precisa concluir a configuração do aplicativo antes da autorização. Você não precisa criar um aplicativo Meta nem informar chaves técnicas.",
  },
  failed: {
    tone: "error",
    title: "Não foi possível concluir a conexão",
    detail: "Tente novamente. Se o problema continuar, procure o administrador do ReplyFlow para conferir a integração. Nenhuma aprovação ou autorização foi confirmada por esta mensagem.",
  },
  denied: {
    tone: "warning",
    title: "Conexão com o Instagram cancelada",
    detail:
      "A autorização não foi concluída. Você pode tentar novamente e revisar as permissões na tela oficial do Instagram.",
  },
  invalid: {
    tone: "error",
    title: "Conexão com o Instagram expirada",
    detail:
      "Não foi possível validar esta tentativa. Ela pode ter expirado ou ter sido aberta em outro navegador. Inicie uma nova autorização.",
  },
  forbidden: {
    tone: "error",
    title: "Ação não permitida",
    detail:
      "Somente proprietários e administradores podem conectar uma conta do Instagram.",
  },
  already_connected: {
    tone: "warning",
    title: "Conta já conectada",
    detail:
      "Essa conta do Instagram pertence a outro espaço. Desconecte-a primeiro ou use outra conta.",
  },
  plan_limit: {
    tone: "warning",
    title: "Limite de contas atingido",
    detail:
      "Este espaço já usa todas as contas do Instagram incluídas no plano atual.",
  },
  billing_setup: {
    tone: "warning",
    title: "Plano ainda em preparação",
    detail:
      "A assinatura deste espaço ainda não está pronta. Aguarde um instante e tente conectar novamente.",
  },
};

export function InstagramConnectNotice() {
  const searchParams = useSearchParams();
  const status = searchParams.get("instagram");

  if (!status) return null;

  const known = MESSAGES[status];
  if (!known) return null;

  return (
    <Notice tone={known.tone} title={known.title}>
      <p>{known.detail}</p>
    </Notice>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: Tone;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded border p-4 text-sm ${TONE_CLASSES[tone]}`}>
      <p className="font-semibold">{title}</p>
      <div className="mt-1 opacity-90">{children}</div>
    </div>
  );
}
