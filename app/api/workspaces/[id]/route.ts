import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace } from "@/lib/workspace-access";
import { normalizeWorkspaceName } from "@/lib/workspace";

const updateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    archived: z.boolean().optional(),
  })
  .refine((data) => data.name !== undefined || data.archived !== undefined);

type WorkspaceRouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(
  request: Request,
  { params }: WorkspaceRouteContext
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }

  const parsed = updateWorkspaceSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Alteração inválida" },
      { status: 400 }
    );
  }

  const { id: workspaceId } = await params;
  const membership = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId, userId },
    },
    include: { workspace: true },
  });

  if (!membership) {
    return NextResponse.json(
      { success: false, error: "Espaço de trabalho não encontrado" },
      { status: 404 }
    );
  }

  if (!canManageWorkspace(membership.role)) {
    return NextResponse.json(
      { success: false, error: "Seu perfil não pode alterar este espaço" },
      { status: 403 }
    );
  }

  if (parsed.data.archived !== undefined && membership.role !== "OWNER") {
    return NextResponse.json(
      {
        success: false,
        error: "Somente o proprietário pode arquivar ou restaurar este espaço",
      },
      { status: 403 }
    );
  }

  const updateData: { name?: string; archivedAt?: Date | null } = {};
  if (parsed.data.name !== undefined) {
    updateData.name = normalizeWorkspaceName(parsed.data.name);
  }
  if (parsed.data.archived !== undefined) {
    updateData.archivedAt = parsed.data.archived ? new Date() : null;
  }

  let workspace;
  if (parsed.data.archived === true) {
    [workspace] = await prisma.$transaction([
      prisma.workspace.update({
        where: { id: workspaceId },
        data: updateData,
      }),
      prisma.automation.updateMany({
        where: { workspaceId, isActive: true },
        data: { isActive: false },
      }),
    ]);
  } else {
    workspace = await prisma.workspace.update({
      where: { id: workspaceId },
      data: updateData,
    });
  }

  return NextResponse.json({
    success: true,
    data: {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        role: membership.role,
        archived: Boolean(workspace.archivedAt),
      },
    },
  });
}
