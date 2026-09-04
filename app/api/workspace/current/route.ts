import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth";
import { setActiveWorkspaceForUser } from "@/lib/workspace";

const selectWorkspaceSchema = z.object({
  workspaceId: z.string().min(1),
});

export async function PUT(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }

  const parsed = selectWorkspaceSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Espaço de trabalho inválido" },
      { status: 400 }
    );
  }

  const membership = await setActiveWorkspaceForUser(
    userId,
    parsed.data.workspaceId
  );
  if (!membership) {
    return NextResponse.json(
      { success: false, error: "Você não tem acesso a este espaço de trabalho" },
      { status: 403 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      workspace: {
        id: membership.workspace.id,
        name: membership.workspace.name,
      },
      role: membership.role,
    },
  });
}
