import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { contactPaginationSchema } from "@/lib/contacts";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export async function GET(
  request: NextRequest,
  route: { params: Promise<{ id: string }> }
) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }

  const params = request.nextUrl.searchParams;
  const parsed = contactPaginationSchema.safeParse({
    page: params.get("page") ?? undefined,
    pageSize: params.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Paginação de interações inválida" },
      { status: 400 }
    );
  }

  const { id } = await route.params;
  const contact = await prisma.contact.findFirst({
    where: {
      id,
      workspaceId: context.workspaceId,
      instagramAccount: { workspaceId: context.workspaceId },
    },
    select: { instagramAccountId: true, instagramScopedId: true },
  });
  if (!contact) {
    return NextResponse.json(
      { success: false, error: "Contato não encontrado" },
      { status: 404 }
    );
  }

  const { page, pageSize } = parsed.data;
  const where = {
    workspaceId: context.workspaceId,
    instagramAccountId: contact.instagramAccountId,
    commenterId: contact.instagramScopedId,
    instagramAccount: { workspaceId: context.workspaceId },
    automation: {
      workspaceId: context.workspaceId,
      instagramAccountId: contact.instagramAccountId,
    },
  };
  const [interactions, total] = await Promise.all([
    prisma.dmLog.findMany({
      where,
      select: {
        id: true,
        commentText: true,
        matchedKeyword: true,
        status: true,
        createdAt: true,
        dmSentAt: true,
        automation: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.dmLog.count({ where }),
  ]);

  return NextResponse.json({
    success: true,
    data: { interactions, total, page, pageSize },
  });
}
