import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  report: vi.fn(),
  csv: vi.fn(),
}));

vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: mocks.context,
}));
vi.mock("@/lib/reports/performance", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/reports/performance")>();
  return {
    ...original,
    getWorkspacePerformanceReport: mocks.report,
    buildPerformanceCsv: mocks.csv,
  };
});

import { GET } from "@/app/api/reports/performance/route";
import { PerformanceReportError } from "@/lib/reports/performance";

function request(query = "") {
  return new NextRequest(`http://localhost/api/reports/performance${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ workspaceId: "workspace_1", role: "ADMIN" });
  mocks.report.mockResolvedValue({
    period: { from: "2026-09-01", to: "2026-09-08" },
    totals: { sent: 0 },
  });
  mocks.csv.mockReturnValue("csv-content");
});

describe("GET /api/reports/performance", () => {
  it("exige sessão antes de executar o relatório", async () => {
    mocks.context.mockResolvedValue(null);
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it("valida datas obrigatórias para um período personalizado", async () => {
    const response = await GET(request("?preset=custom&from=2026-09-01"));

    expect(response.status).toBe(400);
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it("encaminha somente contexto e filtros validados sem cache", async () => {
    const response = await GET(
      request("?preset=7d&instagramAccountId=account_1&automationId=automation_1")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.report).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      role: "ADMIN",
      filters: {
        preset: "7d",
        instagramAccountId: "account_1",
        automationId: "automation_1",
      },
    });
    expect(payload.success).toBe(true);
  });

  it("preserva erros seguros do domínio", async () => {
    mocks.report.mockRejectedValue(new PerformanceReportError("Filtro inválido", 403));
    const response = await GET(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Filtro inválido",
    });
  });

  it("exporta CSV com nome previsível e proteção contra cache", async () => {
    const response = await GET(request("?format=csv"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="replyflow-relatorio-2026-09-01-a-2026-09-08.csv"'
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.text()).resolves.toBe("csv-content");
  });
});
