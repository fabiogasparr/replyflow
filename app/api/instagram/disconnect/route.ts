import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import {
  canManageInstagram,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";
import { AUDIT_ACTIONS, createAuditEventData } from "@/lib/audit";

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }

  if (!canManageInstagram(context.role)) {
    return NextResponse.json(
      { success: false, error: "Seu perfil não pode desconectar contas" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const instagramAccountId =
    typeof body.instagramAccountId === "string" ? body.instagramAccountId : null;

  const accountFilter = {
    workspaceId: context.workspaceId,
    ...(instagramAccountId ? { id: instagramAccountId } : {}),
  };
  const accounts = await prisma.instagramAccount.findMany({
    where: accountFilter,
    select: { id: true, username: true },
  });

  await prisma.$transaction(async (transaction) => {
    await transaction.instagramAccount.deleteMany({ where: accountFilter });
    for (const account of accounts) {
      await transaction.auditEvent.create({
        data: createAuditEventData({
          workspaceId: context.workspaceId,
          actorUserId: context.userId,
          action: AUDIT_ACTIONS.instagramDisconnected,
          targetType: "InstagramAccount",
          targetId: account.id,
          metadata: { username: account.username },
        }),
      });
    }
  });

  return NextResponse.json({ success: true });
}
