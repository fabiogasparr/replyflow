import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import {
  createWorkspaceForUser,
  listUserWorkspaces,
} from "@/lib/workspace";

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(80),
});

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }

  const [user, workspaces] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { activeWorkspaceId: true },
    }),
    listUserWorkspaces(userId, { includeArchived: true }),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      activeWorkspaceId: user?.activeWorkspaceId ?? null,
      workspaces,
    },
  });
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }

  const parsed = createWorkspaceSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Use um nome entre 2 e 80 caracteres",
      },
      { status: 400 }
    );
  }

  const workspace = await createWorkspaceForUser(userId, parsed.data.name);

  return NextResponse.json(
    {
      success: true,
      data: {
        workspace: {
          id: workspace.id,
          name: workspace.name,
          role: "OWNER",
          archived: false,
        },
      },
    },
    { status: 201 }
  );
}
