import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    automation: { findFirst: vi.fn() },
    dmLog: { groupBy: vi.fn(), findFirst: vi.fn() },
    linkClick: { groupBy: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import { getCampaignReportBySlug } from "@/lib/reports/data";
import {
  buildReportUrl,
  getBrandInitials,
  getReadableTextColor,
  isReportBranded,
} from "@/lib/reports/share";

const baseAutomation = {
  id: "automation_123",
  workspaceId: "workspace_123",
  name: "Campanha Catálogo",
  goal: "Apresentar produtos",
  postUrl: "https://instagram.com/p/example",
  keywords: ["LINK", "SHOP"],
  isActive: true,
  createdAt: new Date("2026-05-01T00:00:00.000Z"),
  updatedAt: new Date("2026-05-20T00:00:00.000Z"),
  reportShareSlug: "report_123",
  reportSharePeriodDays: 30,
  reportSharePublishedAt: new Date("2026-09-01T10:00:00.000Z"),
  workspace: {
    name: "Acme Studio",
    reportBrandName: "Acme & Co.",
    reportBrandColor: "#0F766E",
  },
  instagramAccount: { username: "acme" },
  trackedLinks: [
    {
      id: "link_123",
      slug: "tracked_123",
      destinationUrl: "https://www.example.com/product",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.automation.findFirst.mockResolvedValue(baseAutomation);
  mockPrisma.dmLog.groupBy
    .mockResolvedValueOnce([
      { status: "SENT", _count: { _all: 20 } },
      { status: "FAILED", _count: { _all: 1 } },
      { status: "SKIPPED_RATE_LIMIT", _count: { _all: 2 } },
    ])
    .mockResolvedValueOnce([
      { matchedKeyword: "LINK", _count: { _all: 14 } },
      { matchedKeyword: "SHOP", _count: { _all: 6 } },
    ]);
  mockPrisma.linkClick.groupBy.mockResolvedValue([
    { trackedLinkId: "link_123", _count: { _all: 12 } },
  ]);
  mockPrisma.dmLog.findFirst.mockResolvedValue({
    dmSentAt: new Date("2026-09-08T12:00:00.000Z"),
    createdAt: new Date("2026-09-08T12:00:00.000Z"),
  });
  mockPrisma.$queryRaw.mockResolvedValue([
    { day: "2026-09-08", metric: "SENT", count: 20 },
    { day: "2026-09-08", metric: "CLICK", count: BigInt(12) },
  ]);
});

describe("relatório público da campanha", () => {
  it("aplica marca, período e métricas sem incluir dados pessoais", async () => {
    const report = await getCampaignReportBySlug(
      "report_123",
      new Date("2026-09-09T12:00:00.000Z")
    );

    expect(report).toMatchObject({
      shareSlug: "report_123",
      branded: true,
      branding: {
        name: "Acme & Co.",
        color: "#0F766E",
        textColor: "#FFFFFF",
        initials: "AC",
      },
      period: {
        days: 30,
        from: "2026-08-11",
        to: "2026-09-09",
        timeZone: "America/Sao_Paulo",
      },
      campaign: {
        name: "Campanha Catálogo",
        instagramUsername: "acme",
      },
      metrics: {
        sent: 20,
        skipped: 2,
        failed: 1,
        clicks: 12,
        ctr: 60,
        deliveryRate: 95.2,
      },
      trackedLinks: [
        { destinationHost: "example.com", clicks: 12 },
      ],
      conversion: { available: false },
    });
    expect(report?.daily).toHaveLength(30);
    expect(report?.daily.at(-1)).toEqual({
      date: "2026-09-09",
      sent: 0,
      clicks: 0,
    });
    expect(report?.daily.find((day) => day.date === "2026-09-08")).toEqual({
      date: "2026-09-08",
      sent: 20,
      clicks: 12,
    });
    expect("dmMessage" in (report?.campaign ?? {})).toBe(false);
    expect(JSON.stringify(report)).not.toContain("commenterId");

    expect(mockPrisma.dmLog.groupBy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          workspaceId: "workspace_123",
          automationId: "automation_123",
          createdAt: {
            gte: new Date("2026-08-11T03:00:00.000Z"),
            lt: new Date("2026-09-10T03:00:00.000Z"),
          },
        },
      })
    );
  });

  it("retorna null quando o endereço foi revogado ou desativado", async () => {
    mockPrisma.automation.findFirst.mockResolvedValueOnce(null);

    await expect(getCampaignReportBySlug("revoked")).resolves.toBeNull();
    expect(mockPrisma.dmLog.groupBy).not.toHaveBeenCalled();
  });

  it("constrói URLs e identidade visual previsíveis", () => {
    expect(buildReportUrl("abc123", "https://replyflow.example/" )).toBe(
      "https://replyflow.example/reports/abc123"
    );
    expect(isReportBranded()).toBe(true);
    expect(getBrandInitials("Casa Aurora")).toBe("CA");
    expect(getBrandInitials("Única")).toBe("Ú");
    expect(getReadableTextColor("#F5C451")).toBe("#112620");
    expect(getReadableTextColor("#112620")).toBe("#FFFFFF");
    expect(getReadableTextColor("inválida")).toBe("#FFFFFF");
  });
});
