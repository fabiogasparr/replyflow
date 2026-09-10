import { NextRequest, NextResponse } from "next/server";
import { flowLayoutUpdateSchema } from "@/lib/automations/flow-definition";
import {
  FlowLayoutError,
  getAutomationFlowLayout,
  updateAutomationFlowLayout,
} from "@/lib/automations/flow-layout";
import {
  canManageAutomations,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FlowRouteContext = { params: Promise<{ id: string }> };

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(_request: NextRequest, route: FlowRouteContext) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return noStoreJson(
      { success: false, error: "Faça login para continuar" },
      401
    );
  }

  try {
    const { id } = await route.params;
    const data = await getAutomationFlowLayout({
      workspaceId: context.workspaceId,
      automationId: id,
    });
    return noStoreJson({
      success: true,
      data: {
        ...data,
        canManage: canManageAutomations(context.role),
      },
    });
  } catch (error) {
    if (error instanceof FlowLayoutError) {
      return noStoreJson(
        { success: false, code: error.code, error: error.message },
        error.status
      );
    }
    throw error;
  }
}

export async function PATCH(request: NextRequest, route: FlowRouteContext) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return noStoreJson({ success: false, error: "Faça login para continuar" }, 401);
  }
  if (!canManageAutomations(context.role)) {
    return noStoreJson(
      {
        success: false,
        error: "Seu perfil pode consultar o mapa, mas não pode organizá-lo",
      },
      403
    );
  }

  const parsed = flowLayoutUpdateSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return noStoreJson(
      { success: false, error: "Posições do mapa inválidas" },
      400
    );
  }

  try {
    const { id } = await route.params;
    const data = await updateAutomationFlowLayout({
      workspaceId: context.workspaceId,
      automationId: id,
      actorUserId: context.userId,
      revision: parsed.data.revision,
      nodes: parsed.data.nodes,
    });
    return noStoreJson({ success: true, data });
  } catch (error) {
    if (error instanceof FlowLayoutError) {
      return noStoreJson(
        {
          success: false,
          code: error.code,
          error: error.message,
          ...(error.latest ? { latest: error.latest } : {}),
        },
        error.status
      );
    }
    throw error;
  }
}
