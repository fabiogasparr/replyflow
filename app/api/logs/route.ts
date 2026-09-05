import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { DmStatus } from "@/app/generated/prisma/client";
import { getDmRetryEligibility } from "@/lib/dm-retry";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { canManageAutomations } from "@/lib/workspace-permissions";

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const page = positiveInteger(searchParams.get("page"), 1);
  const limit = Math.min(50, positiveInteger(searchParams.get("limit"), 20));
  const status = searchParams.get("status");
  const instagramAccountId = searchParams.get("instagramAccountId");
  const skip = (page - 1) * limit;
  const parsedStatus =
    status && Object.values(DmStatus).includes(status as DmStatus)
      ? (status as DmStatus)
      : null;

  const where = {
    workspaceId: context.workspaceId,
    ...(parsedStatus ? { status: parsedStatus } : {}),
    ...(instagramAccountId && instagramAccountId !== "all"
      ? { instagramAccountId }
      : {}),
  };

  const [logs, total] = await Promise.all([
    prisma.dmLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        automation: {
          select: { name: true, keywords: true, isActive: true },
        },
        instagramAccount: {
          select: { username: true, instagramId: true },
        },
      },
    }),
    prisma.dmLog.count({ where }),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      logs: logs.map((log) => ({
        ...log,
        retry: getDmRetryEligibility(log),
      })),
      canManageRetries: canManageAutomations(context.role),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  });
}
