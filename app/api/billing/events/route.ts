import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import {
  canManageBilling,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";
import {
  BILLING_EVENT_STATUS_LABELS,
  BILLING_PROVIDER_LABELS,
  safeBillingFailureReason,
} from "@/lib/billing/presentation";

const querySchema = z.object({
  status: z
    .enum(["PENDING", "PROCESSED", "FAILED", "IGNORED"])
    .optional(),
  cursor: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const EMPTY_SUMMARY = {
  PENDING: 0,
  PROCESSED: 0,
  FAILED: 0,
  IGNORED: 0,
};

export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }
  if (!canManageBilling(context.role)) {
    return NextResponse.json(
      {
        success: false,
        error: "Somente o proprietário pode consultar eventos de cobrança",
      },
      { status: 403 }
    );
  }

  const parsed = querySchema.safeParse({
    status: request.nextUrl.searchParams.get("status") || undefined,
    cursor: request.nextUrl.searchParams.get("cursor") || undefined,
    limit: request.nextUrl.searchParams.get("limit") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Filtros de cobrança inválidos" },
      { status: 400 }
    );
  }

  const where = {
    workspaceId: context.workspaceId,
    ...(parsed.data.status ? { status: parsed.data.status } : {}),
  };

  if (parsed.data.cursor) {
    const validCursor = await prisma.billingEvent.findFirst({
      where: { ...where, id: parsed.data.cursor },
      select: { id: true },
    });
    if (!validCursor) {
      return NextResponse.json(
        { success: false, error: "Cursor de cobrança inválido" },
        { status: 400 }
      );
    }
  }

  const [eventRows, summaryRows] = await Promise.all([
    prisma.billingEvent.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: parsed.data.limit + 1,
      ...(parsed.data.cursor
        ? { cursor: { id: parsed.data.cursor }, skip: 1 }
        : {}),
      select: {
        id: true,
        provider: true,
        providerEventId: true,
        type: true,
        status: true,
        occurredAt: true,
        processedAt: true,
        failureReason: true,
        createdAt: true,
      },
    }),
    prisma.billingEvent.groupBy({
      by: ["status"],
      where: { workspaceId: context.workspaceId },
      _count: { _all: true },
    }),
  ]);

  const hasMore = eventRows.length > parsed.data.limit;
  const page = eventRows.slice(0, parsed.data.limit);
  const summary = { ...EMPTY_SUMMARY };
  for (const row of summaryRows) summary[row.status] = row._count._all;

  return NextResponse.json({
    success: true,
    data: {
      events: page.map((event) => ({
        ...event,
        providerLabel: BILLING_PROVIDER_LABELS[event.provider],
        statusLabel: BILLING_EVENT_STATUS_LABELS[event.status],
        failureReason: safeBillingFailureReason(event.failureReason),
      })),
      summary,
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    },
  });
}
