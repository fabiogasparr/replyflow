import { prisma } from "@/lib/db/client";

export async function canConnectInstagramAccount({
  workspaceId,
  instagramId,
}: {
  workspaceId: string;
  instagramId: string;
}) {
  const existingAccount = await prisma.instagramAccount.findUnique({
    where: { instagramId },
    select: { workspaceId: true },
  });

  if (existingAccount && existingAccount.workspaceId !== workspaceId) {
    return {
      allowed: false,
      reason: "already_connected" as const,
    };
  }

  if (!existingAccount) {
    const [workspace, accountCount] = await Promise.all([
      prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: {
          subscription: {
            select: { plan: { select: { instagramAccounts: true } } },
          },
        },
      }),
      prisma.instagramAccount.count({ where: { workspaceId } }),
    ]);

    if (!workspace) {
      return {
        allowed: false,
        reason: "workspace_not_found" as const,
      };
    }

    const limit = workspace.subscription?.plan.instagramAccounts;
    if (!limit) {
      return {
        allowed: false,
        reason: "billing_setup" as const,
      };
    }
    if (accountCount >= limit) {
      return {
        allowed: false,
        reason: "plan_limit" as const,
        limit,
      };
    }
  }

  return {
    allowed: true,
    reason: null,
  };
}

export async function getWorkspaceInstagramAccount(
  workspaceId: string,
  instagramAccountId?: string | null
) {
  if (instagramAccountId && instagramAccountId !== "all") {
    return prisma.instagramAccount.findFirst({
      where: { id: instagramAccountId, workspaceId },
    });
  }

  return prisma.instagramAccount.findFirst({
    where: { workspaceId },
    orderBy: { connectedAt: "desc" },
  });
}
