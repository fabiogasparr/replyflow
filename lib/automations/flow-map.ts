import type { FlowNodeId } from "@/lib/automations/flow-definition";

export type AutomationFlowNodeId = FlowNodeId;

export type AutomationFlowNodeKind =
  | "trigger"
  | "action"
  | "condition"
  | "wait";

export interface AutomationFlowSource {
  triggerScope: "specific" | "any" | "next";
  postSelected: boolean;
  matchMode: "specific" | "any";
  keywords: string[];
  dmTriggerEnabled: boolean;
  publicReplyEnabled: boolean;
  publicReplyMessages: string[];
  openingDmEnabled: boolean;
  openingDmMessage: string;
  openingDmButtonLabel: string;
  requireFollow: boolean;
  followPromptMessage: string;
  followPromptButtonLabel: string;
  dmMessage: string;
  primaryLinkEnabled: boolean;
  secondaryLinkEnabled: boolean;
  followUpEnabled: boolean;
  followUpMessage: string;
  followUpDelayMinutes: number;
}

export interface AutomationFlowNode {
  id: AutomationFlowNodeId;
  kind: AutomationFlowNodeKind;
  eyebrow: string;
  title: string;
  summary: string;
  enabled: boolean;
  optional: boolean;
  complete: boolean;
}

export interface AutomationFlowConnection {
  from: AutomationFlowNodeId;
  to: AutomationFlowNodeId;
  label: string;
  branch: "main" | "side";
}

export interface AutomationFlowMap {
  nodes: AutomationFlowNode[];
  connections: AutomationFlowConnection[];
  activeSteps: number;
  configuredSteps: number;
  warnings: string[];
}

function hasText(value: string) {
  return value.trim().length > 0;
}

function describeTrigger(source: AutomationFlowSource) {
  const publication =
    source.triggerScope === "any"
      ? "qualquer publicação"
      : source.triggerScope === "next"
        ? "a próxima publicação"
        : source.postSelected
          ? "uma publicação escolhida"
          : "uma publicação ainda não escolhida";

  const match =
    source.matchMode === "any"
      ? "qualquer palavra"
      : source.keywords.length === 0
        ? "palavras ainda não definidas"
        : source.keywords.length === 1
          ? `“${source.keywords[0]}”`
          : `${source.keywords.length} palavras-chave`;

  return `Comentário em ${publication}, com ${match}${
    source.dmTriggerEnabled ? ", ou mensagem recebida" : ""
  }.`;
}

function describeDelivery(source: AutomationFlowSource) {
  const links = Number(source.primaryLinkEnabled) + Number(source.secondaryLinkEnabled);
  if (links === 0) return "Mensagem privada sem botão de link.";
  if (links === 1) return "Mensagem privada com 1 botão rastreável.";
  return "Mensagem privada com 2 botões rastreáveis.";
}

function describeFollowUp(source: AutomationFlowSource) {
  if (!source.followUpEnabled) return "Etapa opcional desativada.";
  if (source.followUpDelayMinutes === 0) {
    return "Mensagem enviada logo após a entrega do link.";
  }
  if (source.followUpDelayMinutes === 1) {
    return "Mensagem enviada 1 minuto após a entrega do link.";
  }
  return `Mensagem enviada ${source.followUpDelayMinutes} minutos após a entrega do link.`;
}

export function buildAutomationFlow(
  source: AutomationFlowSource
): AutomationFlowMap {
  const publicReplies = source.publicReplyMessages.filter(hasText);
  const triggerComplete =
    (source.triggerScope !== "specific" || source.postSelected) &&
    (source.matchMode === "any" || source.keywords.length > 0);

  const nodes: AutomationFlowNode[] = [
    {
      id: "trigger",
      kind: "trigger",
      eyebrow: "Entrada",
      title: source.dmTriggerEnabled ? "Comentário ou DM" : "Comentário recebido",
      summary: describeTrigger(source),
      enabled: true,
      optional: false,
      complete: triggerComplete,
    },
    {
      id: "public-reply",
      kind: "action",
      eyebrow: "Ramo público",
      title: "Responder no post",
      summary: source.publicReplyEnabled
        ? publicReplies.length === 1
          ? "1 variação de resposta configurada."
          : `${publicReplies.length} variações de resposta configuradas.`
        : "Etapa opcional desativada.",
      enabled: source.publicReplyEnabled,
      optional: true,
      complete: !source.publicReplyEnabled || publicReplies.length > 0,
    },
    {
      id: "opening-dm",
      kind: "action",
      eyebrow: "Abertura",
      title: "Iniciar conversa",
      summary: source.openingDmEnabled
        ? "DM inicial com botão para continuar."
        : "Entrega direta, sem mensagem de abertura.",
      enabled: source.openingDmEnabled,
      optional: true,
      complete:
        !source.openingDmEnabled ||
        (hasText(source.openingDmMessage) && hasText(source.openingDmButtonLabel)),
    },
    {
      id: "follow-gate",
      kind: "condition",
      eyebrow: "Condição",
      title: "Segue o perfil?",
      summary: source.requireFollow
        ? "Confere o follow antes de liberar a oferta."
        : "Condição opcional desativada.",
      enabled: source.requireFollow,
      optional: true,
      complete:
        !source.requireFollow ||
        (hasText(source.followPromptMessage) &&
          hasText(source.followPromptButtonLabel)),
    },
    {
      id: "delivery",
      kind: "action",
      eyebrow: "Entrega principal",
      title: "Enviar mensagem",
      summary: describeDelivery(source),
      enabled: true,
      optional: false,
      complete: hasText(source.dmMessage),
    },
    {
      id: "follow-up",
      kind: "wait",
      eyebrow: "Depois",
      title: "Enviar follow-up",
      summary: describeFollowUp(source),
      enabled: source.followUpEnabled,
      optional: true,
      complete: !source.followUpEnabled || hasText(source.followUpMessage),
    },
  ];

  const warnings = nodes
    .filter((node) => node.enabled && !node.complete)
    .map((node) => `Revise a etapa “${node.title}”.`);

  return {
    nodes,
    connections: [
      { from: "trigger", to: "public-reply", label: "no comentário", branch: "side" },
      { from: "trigger", to: "opening-dm", label: "seguir fluxo", branch: "main" },
      { from: "opening-dm", to: "follow-gate", label: "continuar", branch: "main" },
      { from: "follow-gate", to: "delivery", label: "liberado", branch: "main" },
      { from: "delivery", to: "follow-up", label: "depois", branch: "main" },
    ],
    activeSteps: nodes.filter((node) => node.enabled).length,
    configuredSteps: nodes.filter((node) => node.enabled && node.complete).length,
    warnings,
  };
}
