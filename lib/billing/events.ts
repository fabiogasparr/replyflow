import type {
  BillingProvider,
  Prisma,
  SubscriptionStatus,
  WorkspacePlan,
} from "@/app/generated/prisma/client";
import { Prisma as PrismaNamespace } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";

type MetadataValue = string | number | boolean | null;

export type SubscriptionEventInput = {
  workspaceId: string;
  provider: Exclude<BillingProvider, "MANUAL">;
  providerEventId: string;
  type: string;
  occurredAt: Date;
  planCode: WorkspacePlan;
  status: SubscriptionStatus;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  trialEndsAt?: Date | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: Date | null;
  metadata?: Record<string, MetadataValue>;
};

export type BillingEventOutcome =
  | { result: "PROCESSED"; eventId: string }
  | { result: "DUPLICATE"; eventId: string }
  | { result: "IGNORED_STALE"; eventId: string }
  | { result: "FAILED"; eventId: string; reason: string };

const SENSITIVE_METADATA_KEY =
  /(token|secret|password|authorization|cookie|card|cvv|cvc|pan)/i;
const EXTERNAL_BILLING_PROVIDERS: readonly BillingProvider[] = [
  "MERCADO_PAGO",
  "STRIPE",
];

export function sanitizeBillingMetadata(
  metadata: Record<string, MetadataValue> | undefined
): Prisma.InputJsonValue | undefined {
  if (!metadata) return undefined;

  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => !SENSITIVE_METADATA_KEY.test(key))
      .slice(0, 20)
      .map(([key, value]) => [key.slice(0, 80), value])
  );
}

export function entitledPlanForStatus(
  status: SubscriptionStatus,
  requestedPlan: WorkspacePlan
): WorkspacePlan {
  return status === "CANCELED" || status === "INCOMPLETE"
    ? "FREE"
    : requestedPlan;
}

function failureReason(reason: string) {
  return reason.slice(0, 500);
}

function validateEventIdentity(input: SubscriptionEventInput) {
  if (!input.workspaceId.trim()) {
    throw new TypeError("O evento de assinatura precisa de um workspace");
  }
  if (!input.providerEventId.trim()) {
    throw new TypeError("O evento de assinatura precisa de um identificador");
  }
  if (!EXTERNAL_BILLING_PROVIDERS.includes(input.provider)) {
    throw new TypeError("Eventos externos não podem usar o provedor MANUAL");
  }
  if (Number.isNaN(input.occurredAt.getTime())) {
    throw new TypeError("A data do evento de assinatura é inválida");
  }
}

export async function processSubscriptionEvent(
  input: SubscriptionEventInput
): Promise<BillingEventOutcome> {
  validateEventIdentity(input);

  try {
    return await prisma.$transaction(async (tx) => {
      const existingEvent = await tx.billingEvent.findUnique({
        where: {
          provider_providerEventId: {
            provider: input.provider,
            providerEventId: input.providerEventId,
          },
        },
        select: { id: true },
      });
      if (existingEvent) {
        return { result: "DUPLICATE", eventId: existingEvent.id } as const;
      }

      // Serializa eventos do mesmo workspace. Sem o bloqueio, um evento antigo
      // poderia terminar depois de um novo e restaurar um estado obsoleto.
      const [subscription] = await tx.$queryRaw<
        Array<{
          id: string;
          provider: BillingProvider;
          lastProviderEventAt: Date | null;
        }>
      >(PrismaNamespace.sql`
        SELECT "id", "provider", "lastProviderEventAt"
        FROM "Subscription"
        WHERE "workspaceId" = ${input.workspaceId}
        FOR UPDATE
      `);
      const event = await tx.billingEvent.create({
        data: {
          workspaceId: input.workspaceId,
          subscriptionId: subscription?.id,
          provider: input.provider,
          providerEventId: input.providerEventId,
          type: input.type.trim().slice(0, 120) || "unknown",
          occurredAt: input.occurredAt,
          metadata: sanitizeBillingMetadata(input.metadata),
        },
        select: { id: true },
      });

      if (!subscription) {
        const reason = failureReason("Assinatura do workspace não encontrada");
        await tx.billingEvent.update({
          where: { id: event.id },
          data: {
            status: "FAILED",
            processedAt: new Date(),
            failureReason: reason,
          },
        });
        return { result: "FAILED", eventId: event.id, reason } as const;
      }

      if (
        subscription.provider !== "MANUAL" &&
        subscription.provider !== input.provider
      ) {
        const reason = failureReason(
          "O evento pertence a um provedor diferente da assinatura"
        );
        await tx.billingEvent.update({
          where: { id: event.id },
          data: {
            status: "FAILED",
            processedAt: new Date(),
            failureReason: reason,
          },
        });
        return { result: "FAILED", eventId: event.id, reason } as const;
      }

      if (
        subscription.lastProviderEventAt &&
        subscription.lastProviderEventAt > input.occurredAt
      ) {
        await tx.billingEvent.update({
          where: { id: event.id },
          data: { status: "IGNORED", processedAt: new Date() },
        });
        return { result: "IGNORED_STALE", eventId: event.id } as const;
      }

      if (
        input.currentPeriodStart &&
        input.currentPeriodEnd &&
        input.currentPeriodEnd <= input.currentPeriodStart
      ) {
        const reason = failureReason(
          "O fim do período precisa ser posterior ao início"
        );
        await tx.billingEvent.update({
          where: { id: event.id },
          data: {
            status: "FAILED",
            processedAt: new Date(),
            failureReason: reason,
          },
        });
        return { result: "FAILED", eventId: event.id, reason } as const;
      }

      const entitledPlan = entitledPlanForStatus(input.status, input.planCode);
      const plan = await tx.plan.findUnique({
        where: { code: entitledPlan },
        select: { isActive: true },
      });
      if (!plan?.isActive) {
        const reason = failureReason("Plano inexistente ou indisponível");
        await tx.billingEvent.update({
          where: { id: event.id },
          data: {
            status: "FAILED",
            processedAt: new Date(),
            failureReason: reason,
          },
        });
        return { result: "FAILED", eventId: event.id, reason } as const;
      }

      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          planCode: entitledPlan,
          provider: input.provider,
          status: input.status,
          providerCustomerId: input.providerCustomerId,
          providerSubscriptionId: input.providerSubscriptionId,
          trialEndsAt: input.trialEndsAt,
          currentPeriodStart: input.currentPeriodStart,
          currentPeriodEnd: input.currentPeriodEnd,
          cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
          canceledAt: input.canceledAt,
          lastProviderEventAt: input.occurredAt,
          lastProviderEventId: input.providerEventId,
        },
      });
      await tx.workspace.update({
        where: { id: input.workspaceId },
        data: { plan: entitledPlan },
      });
      await tx.billingEvent.update({
        where: { id: event.id },
        data: {
          status: "PROCESSED",
          processedAt: new Date(),
          subscriptionId: subscription.id,
          failureReason: null,
        },
      });

      return { result: "PROCESSED", eventId: event.id } as const;
    });
  } catch (error) {
    if (
      error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const duplicate = await prisma.billingEvent.findUnique({
        where: {
          provider_providerEventId: {
            provider: input.provider,
            providerEventId: input.providerEventId,
          },
        },
        select: { id: true },
      });
      if (duplicate) return { result: "DUPLICATE", eventId: duplicate.id };
    }
    throw error;
  }
}
