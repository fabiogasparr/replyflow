import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

const statusLabels = {
  TRIALING: "Em período de teste",
  ACTIVE: "Ativa",
  PAST_DUE: "Pagamento pendente",
  CANCELED: "Cancelada",
  INCOMPLETE: "Configuração incompleta",
} as const;

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }

  const subscription = await prisma.subscription.findUnique({
    where: { workspaceId: context.workspaceId },
    select: {
      provider: true,
      status: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      trialEndsAt: true,
      cancelAtPeriodEnd: true,
      plan: {
        select: {
          code: true,
          name: true,
          currency: true,
          monthlyPriceCents: true,
          monthlyDmLimit: true,
          instagramAccounts: true,
          members: true,
        },
      },
    },
  });

  if (!subscription) {
    return NextResponse.json(
      {
        success: false,
        error: "A assinatura deste espaço ainda está sendo preparada",
      },
      { status: 409 }
    );
  }

  const used = context.workspace.dmsSentThisPeriod;
  const limit = subscription.plan.monthlyDmLimit;

  return NextResponse.json({
    success: true,
    data: {
      plan: subscription.plan,
      subscription: {
        provider: subscription.provider,
        status: subscription.status,
        statusLabel: statusLabels[subscription.status],
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        trialEndsAt: subscription.trialEndsAt,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      },
      usage: {
        used,
        limit,
        remaining: Math.max(0, limit - used),
        percentage: Math.min(100, Math.round((used / limit) * 1000) / 10),
      },
      checkoutAvailable: false,
    },
  });
}
