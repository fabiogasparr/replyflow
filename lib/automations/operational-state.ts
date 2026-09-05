import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";

export type AutomationFailureKind =
  | "CONFIGURATION"
  | "AUTHENTICATION"
  | "RATE_LIMIT"
  | "DELIVERY"
  | "PLATFORM";

export type AutomationOperationalState =
  | "PAUSED"
  | "WAITING_FOR_POST"
  | "ERROR"
  | "ACTIVE";

export type AutomationOperationalInput = {
  isActive: boolean;
  pendingNextReel: boolean;
  postId: string | null;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorKind: string | null;
  lastErrorMessage: string | null;
  consecutiveFailures: number;
  instagramAccount: {
    tokenExpiresAt: Date | null;
  };
};

export type AutomationOperationalSummary = {
  state: AutomationOperationalState;
  label: string;
  reason: string;
  needsAttention: boolean;
  lastRunAt: Date | null;
  consecutiveFailures: number;
};

type AutomationStateClient = Pick<Prisma.TransactionClient, "automation">;

const DELIVERY_PATTERNS = [
  /outside of allowed window/i,
  /invalid for a private reply/i,
  /requested user cannot be found/i,
  /recipient/i,
];
const AUTH_PATTERNS = [
  /token.*expired/i,
  /expired.*token/i,
  /oauth/i,
  /error\s*190/i,
  /invalid.*token/i,
];
const CONFIGURATION_PATTERNS = [
  /no instagram access token/i,
  /decrypt.*access token/i,
  /missing.*credential/i,
];
const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /too many requests/i,
  /error\s*(4|17|32|613)\b/i,
];

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown platform error";
}

export function classifyAutomationFailure(error: unknown): AutomationFailureKind {
  const message = errorMessage(error);
  const name = error instanceof Error ? error.name : "";
  if (CONFIGURATION_PATTERNS.some((pattern) => pattern.test(message))) {
    return "CONFIGURATION";
  }
  if (
    name === "TokenExpiredError" ||
    AUTH_PATTERNS.some((pattern) => pattern.test(message))
  ) {
    return "AUTHENTICATION";
  }
  if (
    name === "RateLimitError" ||
    RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(message))
  ) {
    return "RATE_LIMIT";
  }
  if (DELIVERY_PATTERNS.some((pattern) => pattern.test(message))) {
    return "DELIVERY";
  }
  return "PLATFORM";
}

export function sanitizeAutomationError(error: unknown) {
  return errorMessage(error)
    .replace(/(access_token=)[^&\s]+/gi, "$1[removido]")
    .replace(
      /((?:access[_-]?token|accessToken)\s*["']?\s*[:=]\s*["']?)[^&,\s"'}]+/gi,
      "$1[removido]"
    )
    .replace(/(bearer\s+)[^\s]+/gi, "$1[removido]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function latestFailureIsUnresolved(input: AutomationOperationalInput) {
  return Boolean(
    input.lastErrorAt &&
      (!input.lastSuccessAt || input.lastErrorAt > input.lastSuccessAt)
  );
}

function reasonForFailure(kind: string | null) {
  if (kind === "CONFIGURATION") {
    return "A configuração da conta precisa ser corrigida antes do próximo envio.";
  }
  if (kind === "AUTHENTICATION") {
    return "A credencial do Instagram precisa ser renovada.";
  }
  if (kind === "RATE_LIMIT") {
    return "A Meta limitou temporariamente os envios desta campanha.";
  }
  return "A integração encontrou uma falha operacional na última execução.";
}

export function deriveAutomationOperationalState(
  input: AutomationOperationalInput,
  now = new Date()
): AutomationOperationalSummary {
  if (!input.isActive) {
    return {
      state: "PAUSED",
      label: "Pausada",
      reason: "A campanha não processa novos eventos enquanto estiver pausada.",
      needsAttention: false,
      lastRunAt: input.lastRunAt,
      consecutiveFailures: input.consecutiveFailures,
    };
  }
  if (
    input.instagramAccount.tokenExpiresAt &&
    input.instagramAccount.tokenExpiresAt <= now
  ) {
    return {
      state: "ERROR",
      label: "Com erro",
      reason: "O token da conta do Instagram venceu. Reconecte a conta.",
      needsAttention: true,
      lastRunAt: input.lastRunAt,
      consecutiveFailures: input.consecutiveFailures,
    };
  }
  if (
    latestFailureIsUnresolved(input) &&
    input.lastErrorKind !== "DELIVERY"
  ) {
    return {
      state: "ERROR",
      label: "Com erro",
      reason: reasonForFailure(input.lastErrorKind),
      needsAttention: true,
      lastRunAt: input.lastRunAt,
      consecutiveFailures: input.consecutiveFailures,
    };
  }
  if (input.pendingNextReel && !input.postId) {
    return {
      state: "WAITING_FOR_POST",
      label: "Aguardando publicação",
      reason: "A campanha será vinculada ao próximo reel publicado nesta conta.",
      needsAttention: false,
      lastRunAt: input.lastRunAt,
      consecutiveFailures: input.consecutiveFailures,
    };
  }

  return {
    state: "ACTIVE",
    label: "Ativa",
    reason:
      latestFailureIsUnresolved(input) && input.lastErrorKind === "DELIVERY"
        ? "A campanha está ativa; a última falha foi específica de um destinatário."
        : "A campanha está pronta para processar novos eventos.",
    needsAttention: false,
    lastRunAt: input.lastRunAt,
    consecutiveFailures: input.consecutiveFailures,
  };
}

async function persistOutcome(operation: () => Promise<unknown>, automationId: string) {
  try {
    await operation();
  } catch {
    // Operational projection must never turn a successful/failed Meta delivery
    // into another queue attempt. The underlying DmLog remains authoritative.
    console.error(
      `[Automation State] Failed to persist outcome for ${automationId}`
    );
  }
}

export async function recordAutomationSuccess(
  automationId: string,
  occurredAt = new Date()
) {
  await persistOutcome(
    () =>
      prisma.automation.updateMany({
        where: {
          id: automationId,
          OR: [{ lastRunAt: null }, { lastRunAt: { lte: occurredAt } }],
        },
        data: {
          lastRunAt: occurredAt,
          lastSuccessAt: occurredAt,
          lastErrorAt: null,
          lastErrorKind: null,
          lastErrorMessage: null,
          consecutiveFailures: 0,
        },
      }),
    automationId
  );
}

export async function recordAutomationFailure(
  automationId: string,
  error: unknown,
  occurredAt = new Date()
) {
  const kind = classifyAutomationFailure(error);
  await persistOutcome(
    () =>
      prisma.automation.updateMany({
        where: {
          id: automationId,
          OR: [{ lastRunAt: null }, { lastRunAt: { lte: occurredAt } }],
        },
        data: {
          lastRunAt: occurredAt,
          lastErrorAt: occurredAt,
          lastErrorKind: kind,
          lastErrorMessage: sanitizeAutomationError(error),
          consecutiveFailures: { increment: 1 },
        },
      }),
    automationId
  );
}

export async function clearAutomationCredentialFailures(
  client: AutomationStateClient,
  workspaceId: string,
  instagramAccountId: string
) {
  return client.automation.updateMany({
    where: {
      workspaceId,
      instagramAccountId,
      lastErrorKind: { in: ["AUTHENTICATION", "CONFIGURATION"] },
    },
    data: {
      lastErrorAt: null,
      lastErrorKind: null,
      lastErrorMessage: null,
      consecutiveFailures: 0,
    },
  });
}
