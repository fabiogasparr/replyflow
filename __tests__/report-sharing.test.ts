import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => {
  const client = {
    workspace: { findUnique: vi.fn(), update: vi.fn() },
    automation: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma: client };
});

vi.mock("@/lib/db/client", () => ({ prisma }));

import {
  getWorkspaceReportSharing,
  publishCampaignReport,
  revokeCampaignReport,
  rotateCampaignReportLink,
  updateWorkspaceReportBrand,
} from "@/lib/reports/sharing";

const baseAutomation = {
  id: "automation_1",
  name: "Campanha",
  isActive: true,
  reportShareSlug: null,
  reportShareEnabled: false,
  reportSharePeriodDays: 30,
  reportSharePublishedAt: null,
  reportShareRevokedAt: null,
  instagramAccount: { username: "empresa" },
};

beforeEach(() => {
  vi.clearAllMocks();
  prisma.$transaction.mockImplementation(
    async (callback: (transaction: typeof prisma) => unknown) => callback(prisma)
  );
  prisma.workspace.findUnique.mockResolvedValue({
    id: "workspace_1",
    name: "Empresa",
    reportBrandName: null,
    reportBrandColor: "#112620",
  });
  prisma.workspace.update.mockResolvedValue({
    name: "Empresa",
    reportBrandName: "Marca Cliente",
    reportBrandColor: "#AABBCC",
  });
  prisma.automation.findMany.mockResolvedValue([baseAutomation]);
  prisma.automation.findFirst.mockResolvedValue(baseAutomation);
  prisma.automation.update.mockImplementation(async ({ data }) => ({
    ...baseAutomation,
    ...data,
  }));
  prisma.auditEvent.create.mockResolvedValue({ id: "audit_1" });
});

describe("configuração de relatórios compartilhados", () => {
  it("permite leitura a membros sem conceder gerenciamento", async () => {
    const result = await getWorkspaceReportSharing({
      workspaceId: "workspace_1",
      role: "MEMBER",
    });

    expect(result.canManage).toBe(false);
    expect(result.branding).toEqual({
      name: "Empresa",
      customName: null,
      color: "#112620",
    });
    expect(prisma.automation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: "workspace_1" } })
    );
  });

  it("bloqueia alterações por membros", async () => {
    await expect(
      updateWorkspaceReportBrand({
        workspaceId: "workspace_1",
        userId: "user_1",
        role: "MEMBER",
        name: "Marca",
        color: "#112620",
      })
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.workspace.update).not.toHaveBeenCalled();
  });

  it("normaliza a marca e registra auditoria sem conteúdo de clientes", async () => {
    const result = await updateWorkspaceReportBrand({
      workspaceId: "workspace_1",
      userId: "user_1",
      role: "ADMIN",
      name: "  Marca Cliente  ",
      color: "#aabbcc",
    });

    expect(result.color).toBe("#AABBCC");
    expect(prisma.workspace.update).toHaveBeenCalledWith({
      where: { id: "workspace_1" },
      data: { reportBrandName: "Marca Cliente", reportBrandColor: "#AABBCC" },
      select: expect.any(Object),
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace_1",
        actorUserId: "user_1",
        action: "REPORT_BRAND_UPDATED",
        metadata: { hasCustomName: true, color: "#AABBCC" },
      }),
    });
  });

  it("publica um link novo e preserva o escopo do workspace", async () => {
    const now = new Date("2026-09-09T12:00:00.000Z");
    const result = await publishCampaignReport({
      workspaceId: "workspace_1",
      userId: "user_1",
      role: "OWNER",
      automationId: "automation_1",
      periodDays: 90,
      now,
    });

    expect(prisma.automation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "automation_1", workspaceId: "workspace_1" },
      })
    );
    expect(prisma.automation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "automation_1", workspaceId: "workspace_1" },
        data: expect.objectContaining({
          reportShareEnabled: true,
          reportSharePeriodDays: 90,
          reportSharePublishedAt: now,
          reportShareRevokedAt: null,
          reportShareSlug: expect.any(String),
        }),
      })
    );
    expect(result.enabled).toBe(true);
    expect(result.reportUrl).toContain("/reports/");
  });

  it("revoga o slug para invalidar definitivamente o endereço antigo", async () => {
    prisma.automation.findFirst.mockResolvedValue({
      ...baseAutomation,
      reportShareSlug: "old_slug",
      reportShareEnabled: true,
    });
    const now = new Date("2026-09-09T13:00:00.000Z");

    const result = await revokeCampaignReport({
      workspaceId: "workspace_1",
      userId: "user_1",
      role: "ADMIN",
      automationId: "automation_1",
      now,
    });

    expect(prisma.automation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "automation_1", workspaceId: "workspace_1" },
        data: {
          reportShareSlug: null,
          reportShareEnabled: false,
          reportShareRevokedAt: now,
        },
      })
    );
    expect(result.reportUrl).toBeNull();
    expect(result.enabled).toBe(false);
  });

  it("registra uma nova data quando um relatório revogado é republicado", async () => {
    const previousPublication = new Date("2026-08-01T12:00:00.000Z");
    const now = new Date("2026-09-09T14:00:00.000Z");
    prisma.automation.findFirst.mockResolvedValue({
      ...baseAutomation,
      reportSharePublishedAt: previousPublication,
      reportShareRevokedAt: new Date("2026-09-01T12:00:00.000Z"),
    });

    await publishCampaignReport({
      workspaceId: "workspace_1",
      userId: "user_1",
      role: "OWNER",
      automationId: "automation_1",
      periodDays: 30,
      now,
    });

    expect(prisma.automation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reportSharePublishedAt: now }),
      })
    );
  });

  it("só renova endereços que ainda estão publicados", async () => {
    await expect(
      rotateCampaignReportLink({
        workspaceId: "workspace_1",
        userId: "user_1",
        role: "OWNER",
        automationId: "automation_1",
      })
    ).rejects.toThrow("Publique o relatório");
    expect(prisma.automation.update).not.toHaveBeenCalled();
  });
});
