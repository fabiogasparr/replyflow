import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPlatformAccess } from "@/lib/platform-admin";
import { getPlatformOperationsSnapshot } from "@/lib/ops/platform-observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  period: z.enum(["1h", "24h", "7d"]).default("24h"),
});

export async function GET(request: NextRequest) {
  const access = await getPlatformAccess();
  if (!access.authenticated) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }
  if (!access.admin) {
    return NextResponse.json(
      { success: false, error: "Acesso restrito à administração da plataforma" },
      { status: 403 }
    );
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Período de observação inválido" },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: true,
    data: await getPlatformOperationsSnapshot(parsed.data.period),
  });
}
