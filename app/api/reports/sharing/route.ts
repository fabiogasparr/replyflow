import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getWorkspaceReportSharing,
  publishCampaignReport,
  ReportSharingError,
  revokeCampaignReport,
  rotateCampaignReportLink,
  updateWorkspaceReportBrand,
} from "@/lib/reports/sharing";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const brandSchema = z.object({
  action: z.literal("update_brand"),
  name: z.string().trim().min(1).max(80).nullable(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Informe uma cor hexadecimal válida"),
});
const campaignActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("publish"),
    automationId: z.string().min(1).max(128),
    periodDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  }),
  z.object({
    action: z.literal("revoke"),
    automationId: z.string().min(1).max(128),
  }),
  z.object({
    action: z.literal("rotate"),
    automationId: z.string().min(1).max(128),
  }),
]);
const updateSchema = z.union([brandSchema, campaignActionSchema]);

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function contextOrResponse() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return noStoreJson(
      { success: false, error: "Faça login para continuar" },
      401
    );
  }
  return context;
}

export async function GET() {
  const context = await contextOrResponse();
  if (context instanceof NextResponse) return context;

  try {
    const data = await getWorkspaceReportSharing({
      workspaceId: context.workspaceId,
      role: context.role,
    });
    return noStoreJson({ success: true, data });
  } catch (error) {
    if (error instanceof ReportSharingError) {
      return noStoreJson({ success: false, error: error.message }, error.status);
    }
    throw error;
  }
}

export async function PATCH(request: NextRequest) {
  const context = await contextOrResponse();
  if (context instanceof NextResponse) return context;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return noStoreJson(
      {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Dados inválidos",
      },
      400
    );
  }

  try {
    const input = parsed.data;
    const common = {
      workspaceId: context.workspaceId,
      userId: context.userId,
      role: context.role,
    };
    const data =
      input.action === "update_brand"
        ? await updateWorkspaceReportBrand({
            ...common,
            name: input.name,
            color: input.color,
          })
        : input.action === "publish"
          ? await publishCampaignReport({
              ...common,
              automationId: input.automationId,
              periodDays: input.periodDays,
            })
          : input.action === "revoke"
            ? await revokeCampaignReport({
                ...common,
                automationId: input.automationId,
              })
            : await rotateCampaignReportLink({
                ...common,
                automationId: input.automationId,
              });

    return noStoreJson({ success: true, data });
  } catch (error) {
    if (error instanceof ReportSharingError) {
      return noStoreJson({ success: false, error: error.message }, error.status);
    }
    throw error;
  }
}
