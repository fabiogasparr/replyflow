import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validationOptions } from "@/lib/validation";
import { prisma } from "@/lib/db/client";
import { AiUnavailableError, isAiConfigured } from "@/lib/ai/client";
import { generateVariations } from "@/lib/ai/comment-intelligence";
import {
  canManageAutomations,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  kind: z.enum(["publicReply", "dm", "openingDm", "followPrompt", "followUp"]),
  base: z.string().min(1).max(1000),
  count: z.number().int().min(1).max(10).optional().default(4),
  instagramAccountId: z.string().min(1).optional().nullable(),
  campaignName: z.string().max(100).optional().nullable(),
  campaignGoal: z.string().max(120).optional().nullable(),
  instructions: z.string().max(2000).optional().nullable(),
  keywords: z.array(z.string().max(50)).max(10).optional().default([]),
});

/** Generate alternative wordings of a campaign message with the AI provider. */
export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }
  if (!canManageAutomations(context.role)) {
    return NextResponse.json(
      { success: false, error: "Sem permissão para editar campanhas" },
      { status: 403 }
    );
  }
  if (!isAiConfigured()) {
    return NextResponse.json(
      { success: false, error: "A inteligência artificial não está configurada nesta instalação." },
      { status: 503 }
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null), validationOptions);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Dados inválidos", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // The account must belong to this workspace; its handle grounds the prompt.
  const account = parsed.data.instagramAccountId
    ? await prisma.instagramAccount.findFirst({
        where: { id: parsed.data.instagramAccountId, workspaceId: context.workspaceId },
        select: { username: true },
      })
    : null;

  try {
    const variations = await generateVariations({
      base: parsed.data.base,
      count: parsed.data.count,
      kind: parsed.data.kind,
      context: {
        brandUsername: account?.username ?? "suamarca",
        campaignName: parsed.data.campaignName || "Campanha",
        campaignGoal: parsed.data.campaignGoal,
        instructions: parsed.data.instructions,
        keywords: parsed.data.keywords,
      },
    });
    return NextResponse.json(
      { success: true, data: { variations } },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    const status = error instanceof AiUnavailableError ? 503 : 502;
    return NextResponse.json(
      {
        success: false,
        error:
          status === 503
            ? "A inteligência artificial não está configurada nesta instalação."
            : "A IA não conseguiu gerar variações agora. Tente novamente em instantes.",
      },
      { status }
    );
  }
}
