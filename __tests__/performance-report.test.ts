import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    instagramAccount: { findMany: vi.fn() },
    automation: { findMany: vi.fn() },
    dmLog: { groupBy: vi.fn() },
    linkClick: { groupBy: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import {
  buildPerformanceCsv,
  getWorkspacePerformanceReport,
  resolvePerformancePeriod,
} from "@/lib/reports/performance";

const campaigns = [
  {
    id: "automation_1",
    name: "Campanha principal",
    isActive: true,
    instagramAccountId: "account_1",
    instagramAccount: { username: "loja" },
  },
  {
    id: "automation_2",
    name: "=Teste; planilha",
    isActive: false,
    instagramAccountId: "account_1",
    instagramAccount: { username: "loja" },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.instagramAccount.findMany.mockResolvedValue([
    { id: "account_1", username: "loja" },
  ]);
  mockPrisma.automation.findMany.mockResolvedValue(campaigns);
  mockPrisma.dmLog.groupBy.mockResolvedValue([]);
  mockPrisma.linkClick.groupBy.mockResolvedValue([]);
  mockPrisma.$queryRaw.mockResolvedValue([]);
});

describe("períodos do relatório de performance", () => {
  it("fecha sete dias civis no fuso de São Paulo e calcula a janela anterior", () => {
    const period = resolvePerformancePeriod(
      { preset: "7d" },
      new Date("2026-09-08T16:00:00.000Z")
    );

    expect(period).toMatchObject({
      from: "2026-09-02",
      to: "2026-09-08",
      dayCount: 7,
      start: new Date("2026-09-02T03:00:00.000Z"),
      endExclusive: new Date("2026-09-09T03:00:00.000Z"),
      previousStart: new Date("2026-08-26T03:00:00.000Z"),
    });
  });

  it("recusa datas inválidas, ordem invertida e períodos acima do limite", () => {
    expect(() =>
      resolvePerformancePeriod({ preset: "custom", from: "2026-02-30", to: "2026-03-02" })
    ).toThrow("período válido");
    expect(() =>
      resolvePerformancePeriod({ preset: "custom", from: "2026-04-02", to: "2026-04-01" })
    ).toThrow("data inicial");
    expect(() =>
      resolvePerformancePeriod({ preset: "custom", from: "2025-01-01", to: "2026-02-01" })
    ).toThrow("no máximo 366 dias");
  });
});

describe("relatório consolidado do workspace", () => {
  it("recusa conta e automação fora do escopo antes de consultar métricas", async () => {
    await expect(
      getWorkspacePerformanceReport({
        workspaceId: "workspace_1",
        role: "OWNER",
        filters: { preset: "30d", instagramAccountId: "foreign_account" },
      })
    ).rejects.toThrow("não pertence ao espaço de trabalho");
    expect(mockPrisma.automation.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.groupBy).not.toHaveBeenCalled();

    await expect(
      getWorkspacePerformanceReport({
        workspaceId: "workspace_1",
        role: "MEMBER",
        filters: { preset: "30d", automationId: "foreign_automation" },
      })
    ).rejects.toThrow("não pertence aos filtros");
    expect(mockPrisma.dmLog.groupBy).not.toHaveBeenCalled();
  });

  it("consolida status, cliques, comparação, campanhas e dias sem atividade", async () => {
    mockPrisma.dmLog.groupBy
      .mockResolvedValueOnce([
        { automationId: "automation_1", status: "SENT", _count: { _all: 20 } },
        { automationId: "automation_1", status: "FAILED", _count: { _all: 2 } },
        { automationId: "automation_2", status: "SKIPPED_RATE_LIMIT", _count: { _all: 3 } },
      ])
      .mockResolvedValueOnce([
        { status: "SENT", _count: { _all: 10 } },
        { status: "FAILED", _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([
        { automationId: "automation_1", matchedKeyword: "QUERO", _count: { _all: 8 } },
        { automationId: "automation_2", matchedKeyword: "QUERO", _count: { _all: 2 } },
      ]);
    mockPrisma.linkClick.groupBy
      .mockResolvedValueOnce([
        { automationId: "automation_1", _count: { _all: 5 } },
      ])
      .mockResolvedValueOnce([
        { automationId: "automation_1", _count: { _all: 2 } },
      ]);
    mockPrisma.$queryRaw.mockResolvedValue([
      { day: "2026-09-07", metric: "SENT", count: 20 },
      { day: "2026-09-07", metric: "CLICK", count: BigInt(5) },
    ]);

    const report = await getWorkspacePerformanceReport({
      workspaceId: "workspace_1",
      role: "ADMIN",
      filters: {
        preset: "7d",
        instagramAccountId: "account_1",
        automationId: "automation_1",
      },
      now: new Date("2026-09-08T16:00:00.000Z"),
    });

    expect(report.totals).toEqual({
      sent: 20,
      skipped: 3,
      failed: 2,
      clicks: 5,
      ctr: 25,
      deliveryRate: 90.9,
    });
    expect(report.comparison).toEqual({
      sent: { previous: 10, changePercent: 100 },
      failed: { previous: 1, changePercent: 100 },
      clicks: { previous: 2, changePercent: 150 },
    });
    expect(report.campaigns).toHaveLength(1);
    expect(report.campaigns[0]).toMatchObject({
      id: "automation_1",
      sent: 20,
      failed: 2,
      clicks: 5,
      ctr: 25,
    });
    expect(report.daily).toHaveLength(7);
    expect(report.daily.find((day) => day.date === "2026-09-07")).toEqual({
      date: "2026-09-07",
      sent: 20,
      clicks: 5,
    });
    expect(report.daily.find((day) => day.date === "2026-09-08")).toEqual({
      date: "2026-09-08",
      sent: 0,
      clicks: 0,
    });
    expect(report.topKeywords).toEqual([{ keyword: "QUERO", count: 10 }]);
    expect(report.conversion.available).toBe(false);

    const firstMetricWhere = mockPrisma.dmLog.groupBy.mock.calls[0][0].where;
    expect(firstMetricWhere).toMatchObject({
      workspaceId: "workspace_1",
      instagramAccountId: "account_1",
      automationId: "automation_1",
      createdAt: {
        gte: new Date("2026-09-02T03:00:00.000Z"),
        lt: new Date("2026-09-09T03:00:00.000Z"),
      },
    });
  });

  it("gera CSV compatível com pt-BR e neutraliza fórmulas de planilha", async () => {
    const report = await getWorkspacePerformanceReport({
      workspaceId: "workspace_1",
      role: "OWNER",
      filters: { preset: "30d" },
    });
    const csv = buildPerformanceCsv(report);

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"Campanha";"Conta do Instagram"');
    expect(csv).toContain('"\'=Teste; planilha"');
    expect(csv).not.toContain("commenterId");
  });
});
