import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import {
  DmRetryRequestError,
  requestDmRetry,
} from "@/lib/dm-retry-request";
import { getWorkerHealth } from "@/lib/ops/worker-health";
import {
  getPlatformSupportQueue,
  PLATFORM_SUPPORT_STATUSES,
} from "@/lib/ops/platform-support";
import { getPlatformAccess } from "@/lib/platform-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(["ALL", ...PLATFORM_SUPPORT_STATUSES]).default("ALL"),
  cursor: z.string().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const retrySchema = z.object({
  workspaceId: z.string().min(1).max(128),
  logId: z.string().min(1).max(128),
  confirmation: z.string().min(1).max(160),
});

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function requirePlatformAdmin() {
  const access = await getPlatformAccess();
  if (!access.authenticated) {
    return noStoreJson(
      { success: false, error: "Faça login para continuar" },
      401
    );
  }
  if (!access.admin) {
    return noStoreJson(
      { success: false, error: "Acesso restrito à administração da plataforma" },
      403
    );
  }
  return access.admin;
}

export async function GET(request: NextRequest) {
  const admin = await requirePlatformAdmin();
  if (admin instanceof NextResponse) return admin;

  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  if (!parsed.success) {
    return noStoreJson(
      { success: false, error: "Filtros de suporte inválidos" },
      400
    );
  }

  try {
    const data = await getPlatformSupportQueue(parsed.data);
    return noStoreJson({ success: true, data });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_CURSOR") {
      return noStoreJson(
        { success: false, error: "Cursor inválido para os filtros atuais" },
        400
      );
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  const admin = await requirePlatformAdmin();
  if (admin instanceof NextResponse) return admin;

  const parsed = retrySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return noStoreJson(
      { success: false, error: "Confirmação de reprocessamento inválida" },
      400
    );
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: parsed.data.workspaceId },
    select: { id: true, name: true, archivedAt: true },
  });
  if (!workspace) {
    return noStoreJson(
      { success: false, error: "Empresa não encontrada" },
      404
    );
  }
  if (workspace.archivedAt) {
    return noStoreJson(
      { success: false, error: "Empresas arquivadas não podem processar envios" },
      409
    );
  }

  const normalizedConfirmation = parsed.data.confirmation
    .trim()
    .normalize("NFKC");
  const normalizedWorkspaceName = workspace.name.trim().normalize("NFKC");
  if (normalizedConfirmation !== normalizedWorkspaceName) {
    return noStoreJson(
      { success: false, error: "Digite o nome exato da empresa para confirmar" },
      409
    );
  }

  try {
    const worker = await getWorkerHealth();
    if (!worker.healthy) {
      return noStoreJson(
        {
          success: false,
          error: "O worker está sem heartbeat recente. Restaure-o antes de reprocessar.",
        },
        409
      );
    }
  } catch {
    return noStoreJson(
      {
        success: false,
        error: "Não foi possível validar Redis e worker. Nenhum envio foi alterado.",
      },
      503
    );
  }

  try {
    const data = await requestDmRetry({
      workspaceId: workspace.id,
      actorUserId: admin.id,
      logId: parsed.data.logId,
      source: "PLATFORM_SUPPORT",
    });
    return noStoreJson({ success: true, data }, 202);
  } catch (error) {
    if (error instanceof DmRetryRequestError) {
      return noStoreJson(
        { success: false, error: error.message },
        error.status
      );
    }
    throw error;
  }
}
