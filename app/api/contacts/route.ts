import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { contactFiltersSchema, contactSummarySelect } from "@/lib/contacts";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { canManageContacts } from "@/lib/workspace-permissions";

export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }

  const params = request.nextUrl.searchParams;
  const parsed = contactFiltersSchema.safeParse({
    page: params.get("page") ?? undefined,
    pageSize: params.get("pageSize") ?? undefined,
    search: params.get("q") ?? params.get("search") ?? undefined,
    instagramAccountId: params.get("instagramAccountId") ?? undefined,
    tag: params.get("tag") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Filtros de contatos inválidos" },
      { status: 400 }
    );
  }

  const { page, pageSize, search, instagramAccountId, tag } = parsed.data;
  const where: Prisma.ContactWhereInput = {
    workspaceId: context.workspaceId,
    instagramAccount: { workspaceId: context.workspaceId },
    ...(instagramAccountId && instagramAccountId !== "all" ? { instagramAccountId } : {}),
    ...(tag ? { tags: { has: tag } } : {}),
    ...(search ? {
      OR: [
        { username: { contains: search.replace(/^@/, ""), mode: "insensitive" } },
        { instagramScopedId: { contains: search } },
      ],
    } : {}),
  };

  const [contacts, total, accounts] = await Promise.all([
    prisma.contact.findMany({
      where,
      select: contactSummarySelect,
      orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.contact.count({ where }),
    prisma.instagramAccount.findMany({
      where: { workspaceId: context.workspaceId },
      select: { id: true, username: true },
      orderBy: [{ username: "asc" }, { id: "asc" }],
    }),
  ]);

  return NextResponse.json({
    success: true,
    data: { contacts, total, page, pageSize, accounts, canEdit: canManageContacts(context.role) },
  });
}
