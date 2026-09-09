import { NextRequest, NextResponse } from "next/server";
import {
  DmRetryRequestError,
  requestDmRetry,
} from "@/lib/dm-retry-request";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { canManageAutomations } from "@/lib/workspace-permissions";

type RetryRouteContext = { params: Promise<{ id: string }> };

export async function POST(
  _request: NextRequest,
  route: RetryRouteContext
) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }
  if (!canManageAutomations(context.role)) {
    return NextResponse.json(
      {
        success: false,
        error: "Seu perfil pode consultar os envios, mas não pode reprocessá-los",
      },
      { status: 403 }
    );
  }

  const { id } = await route.params;
  try {
    const data = await requestDmRetry({
      workspaceId: context.workspaceId,
      actorUserId: context.userId,
      logId: id,
      source: "WORKSPACE",
    });
    return NextResponse.json({ success: true, data }, { status: 202 });
  } catch (error) {
    if (error instanceof DmRetryRequestError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status }
      );
    }
    throw error;
  }
}
