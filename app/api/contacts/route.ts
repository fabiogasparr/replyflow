import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { contactSummarySelect } from "@/lib/contacts";
import {
  buildContactSegmentQueries,
  contactSegmentFiltersSchema,
} from "@/lib/contact-segments";
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
  const parsed = contactSegmentFiltersSchema.safeParse({
    page: params.get("page") ?? undefined,
    pageSize: params.get("pageSize") ?? undefined,
    search: params.get("q") ?? params.get("search") ?? undefined,
    instagramAccountId: params.get("instagramAccountId") ?? undefined,
    tag: params.get("tag") ?? undefined,
    automationId: params.get("automationId") ?? undefined,
    origin: params.get("origin") ?? undefined,
    engagement: params.get("engagement") ?? undefined,
    activeWithinDays: params.get("activeWithinDays") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Filtros de contatos inválidos" },
      { status: 400 }
    );
  }

  const filters = parsed.data;
  const queries = buildContactSegmentQueries({
    workspaceId: context.workspaceId,
    filters,
  });
  const [idRows, totalRows, accounts, automations] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string }>>(queries.ids),
    prisma.$queryRaw<Array<{ total: number }>>(queries.total),
    prisma.instagramAccount.findMany({
      where: { workspaceId: context.workspaceId },
      select: { id: true, username: true },
      orderBy: [{ username: "asc" }, { id: "asc" }],
    }),
    prisma.automation.findMany({
      where: { workspaceId: context.workspaceId },
      select: { id: true, name: true, instagramAccountId: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
  ]);
  const ids = idRows.map((row) => row.id);
  const unorderedContacts = ids.length
    ? await prisma.contact.findMany({
        where: {
          id: { in: ids },
          workspaceId: context.workspaceId,
          instagramAccount: { workspaceId: context.workspaceId },
        },
        select: contactSummarySelect,
      })
    : [];
  const order = new Map(ids.map((id, index) => [id, index]));
  const contacts = unorderedContacts.sort(
    (left, right) =>
      (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0)
  );

  return NextResponse.json(
    {
      success: true,
      data: {
        contacts,
        total: totalRows[0]?.total ?? 0,
        page: filters.page,
        pageSize: filters.pageSize,
        accounts,
        automations,
        canEdit: canManageContacts(context.role),
      },
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
