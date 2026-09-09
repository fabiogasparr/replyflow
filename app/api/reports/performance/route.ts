import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import {
  buildPerformanceCsv,
  getWorkspacePerformanceReport,
  PerformanceReportError,
} from "@/lib/reports/performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z
  .object({
    preset: z.enum(["7d", "30d", "90d", "custom"]).default("30d"),
    from: z.string().optional(),
    to: z.string().optional(),
    instagramAccountId: z.string().min(1).max(128).optional(),
    automationId: z.string().min(1).max(128).optional(),
    format: z.enum(["json", "csv"]).default("json"),
  })
  .refine(
    (value) =>
      value.preset !== "custom" || (Boolean(value.from) && Boolean(value.to)),
    { message: "Informe as datas inicial e final" }
  );

export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Filtros inválidos" },
      { status: 400 }
    );
  }

  try {
    const { format, ...filters } = parsed.data;
    const report = await getWorkspacePerformanceReport({
      workspaceId: context.workspaceId,
      role: context.role,
      filters,
    });
    if (format === "csv") {
      return new NextResponse(buildPerformanceCsv(report), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="replyflow-relatorio-${report.period.from}-a-${report.period.to}.csv"`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    return NextResponse.json(
      { success: true, data: report },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    if (error instanceof PerformanceReportError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status }
      );
    }
    throw error;
  }
}
