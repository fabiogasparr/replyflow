import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validationOptions } from "@/lib/validation";
import { prisma } from "@/lib/db/client";
import { isAiConfigured } from "@/lib/ai/client";
import {
  MODERATION_SENSITIVITIES,
  assessComment,
  generatePersonalizedDm,
  generatePersonalizedPublicReply,
  shouldHoldForHuman,
} from "@/lib/ai/comment-intelligence";
import {
  canManageAutomations,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  commentText: z.string().min(1).max(1000),
  commenterName: z.string().max(80).optional().nullable(),
  instagramAccountId: z.string().min(1).optional().nullable(),
  campaignName: z.string().max(100).optional().nullable(),
  campaignGoal: z.string().max(120).optional().nullable(),
  instructions: z.string().max(2000).optional().nullable(),
  keywords: z.array(z.string().max(50)).max(10).optional().default([]),
  publicReplyTemplate: z.string().max(1000).optional().nullable(),
  dmTemplate: z.string().max(1000).optional().nullable(),
  hasLink: z.boolean().optional().default(false),
  moderationSensitivity: z.enum(MODERATION_SENSITIVITIES).optional().default("HOSTILE"),
});

/**
 * Dry run of the AI behaviour for a sample comment: how it would be triaged
 * and what the personalised public reply and DM would look like. Nothing is
 * sent or stored.
 */
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

  const account = parsed.data.instagramAccountId
    ? await prisma.instagramAccount.findFirst({
        where: { id: parsed.data.instagramAccountId, workspaceId: context.workspaceId },
        select: { username: true },
      })
    : null;
  const aiContext = {
    brandUsername: account?.username ?? "suamarca",
    campaignName: parsed.data.campaignName || "Campanha",
    campaignGoal: parsed.data.campaignGoal,
    instructions: parsed.data.instructions,
    keywords: parsed.data.keywords,
  };

  const assessment = await assessComment(parsed.data.commentText, aiContext);
  const held = shouldHoldForHuman(assessment, parsed.data.moderationSensitivity);
  const [publicReply, dm] = held
    ? [null, null]
    : await Promise.all([
        parsed.data.publicReplyTemplate !== undefined
          ? generatePersonalizedPublicReply({
              commentText: parsed.data.commentText,
              commenterName: parsed.data.commenterName,
              templateExample: parsed.data.publicReplyTemplate,
              context: aiContext,
            })
          : Promise.resolve(null),
        parsed.data.dmTemplate
          ? generatePersonalizedDm({
              commentText: parsed.data.commentText,
              commenterName: parsed.data.commenterName,
              template: parsed.data.dmTemplate,
              hasLink: parsed.data.hasLink,
              context: aiContext,
            })
          : Promise.resolve(null),
      ]);

  return NextResponse.json(
    {
      success: true,
      data: { assessment, heldForHuman: held, publicReply, dm },
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
