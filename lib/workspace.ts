import type { Workspace, WorkspaceRole } from "@/app/generated/prisma/client";
import { AUDIT_ACTIONS, createAuditEventData } from "@/lib/audit";
import { prisma } from "@/lib/db/client";

function normalizeInviteEmail(email: string) {
  return email.trim().toLowerCase();
}

export type WorkspaceMembership = {
  workspace: Workspace;
  role: WorkspaceRole;
};

export type UserWorkspaceOption = {
  id: string;
  name: string;
  role: WorkspaceRole;
  archived: boolean;
};

export function normalizeWorkspaceName(name: string): string {
  return name.trim().replace(/\s+/gu, " ");
}

export async function acceptPendingInvitationsForUser(
  userId: string,
  email?: string | null
): Promise<void> {
  if (!email) return;

  const normalizedEmail = normalizeInviteEmail(email);
  const now = new Date();
  const invitations = await prisma.workspaceInvitation.findMany({
    where: {
      email: normalizedEmail,
      status: "PENDING",
      expiresAt: { gt: now },
    },
  });

  for (const invitation of invitations) {
    await prisma.$transaction([
      prisma.workspaceMember.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: invitation.workspaceId,
            userId,
          },
        },
        create: {
          workspaceId: invitation.workspaceId,
          userId,
          role: invitation.role,
        },
        update: {
          role: invitation.role,
        },
      }),
      prisma.workspaceInvitation.update({
        where: { id: invitation.id, workspaceId: invitation.workspaceId },
        data: {
          status: "ACCEPTED",
          acceptedAt: now,
        },
      }),
      prisma.auditEvent.create({
        data: createAuditEventData({
          workspaceId: invitation.workspaceId,
          actorUserId: userId,
          action: AUDIT_ACTIONS.invitationAccepted,
          targetType: "WorkspaceInvitation",
          targetId: invitation.id,
          metadata: { role: invitation.role },
        }),
      }),
    ]);
  }
}

/**
 * Resolves the user's selected workspace only when a membership still exists.
 * A stale selection can happen after membership removal; in that case the
 * oldest remaining membership becomes active and is persisted for the next request.
 */
export async function getWorkspaceMembership(
  userId: string
): Promise<WorkspaceMembership | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeWorkspaceId: true },
  });

  if (user?.activeWorkspaceId) {
    const activeMembership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: user.activeWorkspaceId,
          userId,
        },
      },
      include: { workspace: true },
    });

    if (activeMembership && !activeMembership.workspace.archivedAt) {
      return {
        workspace: activeMembership.workspace,
        role: activeMembership.role,
      };
    }
  }

  const fallbackMembership = await prisma.workspaceMember.findFirst({
    where: { userId, workspace: { archivedAt: null } },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });

  if (!fallbackMembership) return null;

  if (user?.activeWorkspaceId !== fallbackMembership.workspaceId) {
    await prisma.user.update({
      where: { id: userId },
      data: { activeWorkspaceId: fallbackMembership.workspaceId },
    });
  }

  return {
    workspace: fallbackMembership.workspace,
    role: fallbackMembership.role,
  };
}

export async function listUserWorkspaces(
  userId: string,
  options: { includeArchived?: boolean } = {}
): Promise<UserWorkspaceOption[]> {
  const memberships = await prisma.workspaceMember.findMany({
    where: {
      userId,
      ...(options.includeArchived ? {} : { workspace: { archivedAt: null } }),
    },
    orderBy: { createdAt: "asc" },
    select: {
      role: true,
      workspace: {
        select: { id: true, name: true, archivedAt: true },
      },
    },
  });

  return memberships.map((membership) => ({
    id: membership.workspace.id,
    name: membership.workspace.name,
    role: membership.role,
    archived: Boolean(membership.workspace.archivedAt),
  }));
}

export async function createWorkspaceForUser(
  userId: string,
  name: string
): Promise<Workspace> {
  const normalizedName = normalizeWorkspaceName(name);

  return prisma.$transaction(async (transaction) => {
    const workspace = await transaction.workspace.create({
      data: {
        name: normalizedName,
        ownerId: userId,
        members: {
          create: {
            userId,
            role: "OWNER",
          },
        },
      },
    });

    await transaction.user.update({
      where: { id: userId },
      data: { activeWorkspaceId: workspace.id },
    });

    await transaction.auditEvent.create({
      data: createAuditEventData({
        workspaceId: workspace.id,
        actorUserId: userId,
        action: AUDIT_ACTIONS.workspaceCreated,
        targetType: "Workspace",
        targetId: workspace.id,
        metadata: { name: workspace.name },
      }),
    });

    return workspace;
  });
}

export async function setActiveWorkspaceForUser(
  userId: string,
  workspaceId: string
): Promise<WorkspaceMembership | null> {
  const membership = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId, userId },
    },
    include: { workspace: true },
  });

  if (!membership || membership.workspace.archivedAt) return null;

  await prisma.user.update({
    where: { id: userId },
    data: { activeWorkspaceId: workspaceId },
  });

  return {
    workspace: membership.workspace,
    role: membership.role,
  };
}

export async function ensureWorkspaceForUser(
  userId: string,
  email?: string | null
): Promise<Workspace> {
  await acceptPendingInvitationsForUser(userId, email);

  const existingMembership = await getWorkspaceMembership(userId);
  if (existingMembership) {
    return existingMembership.workspace;
  }

  const workspaceName = email
    ? `Espaço de ${email.split("@")[0]}`
    : "Meu espaço de trabalho";

  return createWorkspaceForUser(userId, workspaceName);
}

export async function getActiveWorkspace(
  userId: string
): Promise<Workspace | null> {
  const membership = await getWorkspaceMembership(userId);
  return membership?.workspace ?? null;
}

/** @deprecated Use getActiveWorkspace. Kept for internal compatibility. */
export const getPrimaryWorkspace = getActiveWorkspace;
