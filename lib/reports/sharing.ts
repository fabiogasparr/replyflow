import type { WorkspaceRole } from "@/app/generated/prisma/client";
import { AUDIT_ACTIONS, createAuditEventData } from "@/lib/audit";
import { prisma } from "@/lib/db/client";
import { buildReportUrl, generateReportShareSlug } from "@/lib/reports/share";
import { hasWorkspacePermission } from "@/lib/workspace-permissions";

export type SharedReportPeriodDays = 7 | 30 | 90;

export class ReportSharingError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

type SharingAutomation = {
  id: string;
  name: string;
  isActive: boolean;
  reportShareSlug: string | null;
  reportShareEnabled: boolean;
  reportSharePeriodDays: number;
  reportSharePublishedAt: Date | null;
  reportShareRevokedAt: Date | null;
  instagramAccount: { username: string };
};

function serializeAutomation(automation: SharingAutomation) {
  return {
    id: automation.id,
    name: automation.name,
    isActive: automation.isActive,
    instagramUsername: automation.instagramAccount.username,
    enabled:
      automation.reportShareEnabled && Boolean(automation.reportShareSlug),
    periodDays: automation.reportSharePeriodDays as SharedReportPeriodDays,
    reportUrl:
      automation.reportShareEnabled && automation.reportShareSlug
        ? buildReportUrl(automation.reportShareSlug)
        : null,
    publishedAt: automation.reportSharePublishedAt,
    revokedAt: automation.reportShareRevokedAt,
  };
}

const automationSharingSelect = {
  id: true,
  name: true,
  isActive: true,
  reportShareSlug: true,
  reportShareEnabled: true,
  reportSharePeriodDays: true,
  reportSharePublishedAt: true,
  reportShareRevokedAt: true,
  instagramAccount: { select: { username: true } },
} as const;

function requireReportManagement(role: WorkspaceRole) {
  if (!hasWorkspacePermission(role, "reports:manage")) {
    throw new ReportSharingError(
      "Seu perfil não pode gerenciar relatórios compartilhados",
      403
    );
  }
}

export async function getWorkspaceReportSharing({
  workspaceId,
  role,
}: {
  workspaceId: string;
  role: WorkspaceRole;
}) {
  if (!hasWorkspacePermission(role, "reports:view")) {
    throw new ReportSharingError("Seu perfil não pode visualizar relatórios", 403);
  }

  const [workspace, automations] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true, reportBrandName: true, reportBrandColor: true },
    }),
    prisma.automation.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: automationSharingSelect,
    }),
  ]);

  if (!workspace) {
    throw new ReportSharingError("Espaço de trabalho não encontrado", 404);
  }

  return {
    canManage: hasWorkspacePermission(role, "reports:manage"),
    branding: {
      name: workspace.reportBrandName ?? workspace.name,
      customName: workspace.reportBrandName,
      color: workspace.reportBrandColor,
    },
    campaigns: automations.map(serializeAutomation),
  };
}

export async function updateWorkspaceReportBrand({
  workspaceId,
  userId,
  role,
  name,
  color,
}: {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  name: string | null;
  color: string;
}) {
  requireReportManagement(role);

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) {
    throw new ReportSharingError("Espaço de trabalho não encontrado", 404);
  }

  const normalizedName = name?.trim() || null;
  const normalizedColor = color.toUpperCase();
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.workspace.update({
      where: { id: workspaceId },
      data: {
        reportBrandName: normalizedName,
        reportBrandColor: normalizedColor,
      },
      select: { name: true, reportBrandName: true, reportBrandColor: true },
    });
    await tx.auditEvent.create({
      data: createAuditEventData({
        workspaceId,
        actorUserId: userId,
        action: AUDIT_ACTIONS.reportBrandUpdated,
        targetType: "Workspace",
        targetId: workspaceId,
        metadata: { hasCustomName: Boolean(normalizedName), color: normalizedColor },
      }),
    });
    return result;
  });

  return {
    name: updated.reportBrandName ?? updated.name,
    customName: updated.reportBrandName,
    color: updated.reportBrandColor,
  };
}

async function findManagedAutomation(workspaceId: string, automationId: string) {
  const automation = await prisma.automation.findFirst({
    where: { id: automationId, workspaceId },
    select: automationSharingSelect,
  });
  if (!automation) {
    throw new ReportSharingError("Automação não encontrada", 404);
  }
  return automation;
}

export async function publishCampaignReport({
  workspaceId,
  userId,
  role,
  automationId,
  periodDays,
  now = new Date(),
}: {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  automationId: string;
  periodDays: SharedReportPeriodDays;
  now?: Date;
}) {
  requireReportManagement(role);
  const existing = await findManagedAutomation(workspaceId, automationId);
  const shareSlug = existing.reportShareSlug ?? generateReportShareSlug();

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.automation.update({
      where: { id: automationId, workspaceId },
      data: {
        reportShareSlug: shareSlug,
        reportShareEnabled: true,
        reportSharePeriodDays: periodDays,
        reportSharePublishedAt:
          existing.reportShareEnabled && existing.reportShareSlug
            ? existing.reportSharePublishedAt ?? now
            : now,
        reportShareRevokedAt: null,
      },
      select: automationSharingSelect,
    });
    await tx.auditEvent.create({
      data: createAuditEventData({
        workspaceId,
        actorUserId: userId,
        action: AUDIT_ACTIONS.reportPublished,
        targetType: "Automation",
        targetId: automationId,
        metadata: { periodDays },
      }),
    });
    return result;
  });

  return serializeAutomation(updated);
}

export async function revokeCampaignReport({
  workspaceId,
  userId,
  role,
  automationId,
  now = new Date(),
}: {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  automationId: string;
  now?: Date;
}) {
  requireReportManagement(role);
  await findManagedAutomation(workspaceId, automationId);

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.automation.update({
      where: { id: automationId, workspaceId },
      data: {
        reportShareSlug: null,
        reportShareEnabled: false,
        reportShareRevokedAt: now,
      },
      select: automationSharingSelect,
    });
    await tx.auditEvent.create({
      data: createAuditEventData({
        workspaceId,
        actorUserId: userId,
        action: AUDIT_ACTIONS.reportRevoked,
        targetType: "Automation",
        targetId: automationId,
      }),
    });
    return result;
  });

  return serializeAutomation(updated);
}

export async function rotateCampaignReportLink({
  workspaceId,
  userId,
  role,
  automationId,
  now = new Date(),
}: {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  automationId: string;
  now?: Date;
}) {
  requireReportManagement(role);
  const existing = await findManagedAutomation(workspaceId, automationId);
  if (!existing.reportShareEnabled || !existing.reportShareSlug) {
    throw new ReportSharingError(
      "Publique o relatório antes de renovar o link"
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.automation.update({
      where: { id: automationId, workspaceId },
      data: {
        reportShareSlug: generateReportShareSlug(),
        reportSharePublishedAt: now,
        reportShareRevokedAt: null,
      },
      select: automationSharingSelect,
    });
    await tx.auditEvent.create({
      data: createAuditEventData({
        workspaceId,
        actorUserId: userId,
        action: AUDIT_ACTIONS.reportLinkRotated,
        targetType: "Automation",
        targetId: automationId,
      }),
    });
    return result;
  });

  return serializeAutomation(updated);
}

export type WorkspaceReportSharing = Awaited<
  ReturnType<typeof getWorkspaceReportSharing>
>;
