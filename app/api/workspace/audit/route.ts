import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import {
  canManageMembers,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }

  if (!canManageMembers(context.role)) {
    return NextResponse.json(
      { success: false, error: "Seu perfil não pode consultar a auditoria" },
      { status: 403 }
    );
  }

  const events = await prisma.auditEvent.findMany({
    where: { workspaceId: context.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      action: true,
      targetType: true,
      targetId: true,
      metadata: true,
      createdAt: true,
      actor: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  return NextResponse.json({ success: true, data: { events } });
}
