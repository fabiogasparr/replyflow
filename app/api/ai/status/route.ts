import { NextResponse } from "next/server";
import { getAiConfig } from "@/lib/ai/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tells the builder whether AI features can be offered at all. */
export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }
  const config = getAiConfig();
  return NextResponse.json(
    {
      success: true,
      data: {
        configured: config !== null,
        model: config?.model ?? null,
        fallbackModel: config?.fallbackModel ?? null,
      },
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
