import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import {
  buildInvitationUrl,
  generateInvitationToken,
  getInvitationExpiry,
  normalizeInvitationEmail,
} from "@/lib/workspace-invitations";
import {
  canAssignWorkspaceRole,
  canManageMembers,
  canManageWorkspaceMember,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";
import { AUDIT_ACTIONS, createAuditEventData } from "@/lib/audit";
import type { Prisma } from "@/app/generated/prisma/client";
import {
  assertWorkspacePlanCapacity,
  WorkspaceBillingSetupError,
  WorkspacePlanLimitError,
} from "@/lib/billing/plans";

const inviteSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
});

const updateMemberSchema = z.object({
  memberId: z.string().min(1),
  role: z.enum(["ADMIN", "MEMBER"]),
});

const deleteSchema = z.object({
  memberId: z.string().min(1).optional(),
  invitationId: z.string().min(1).optional(),
});

async function assertMemberCapacity(
  transaction: Prisma.TransactionClient,
  workspaceId: string
) {
  const [subscription, memberCount, pendingInvitationCount] = await Promise.all([
    transaction.subscription.findUnique({
      where: { workspaceId },
      select: { plan: { select: { members: true } } },
    }),
    transaction.workspaceMember.count({ where: { workspaceId } }),
    transaction.workspaceInvitation.count({
      where: {
        workspaceId,
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
    }),
  ]);

  if (!subscription) throw new WorkspaceBillingSetupError();
  assertWorkspacePlanCapacity(
    "members",
    memberCount + pendingInvitationCount,
    subscription.plan.members
  );
}

function memberPlanLimitResponse(error: WorkspacePlanLimitError) {
  return NextResponse.json(
    {
      success: false,
      code: error.code,
      error: `Seu plano permite até ${error.limit} integrantes e convites ativos.`,
      data: { resource: error.resource, limit: error.limit },
    },
    { status: 409 }
  );
}

function memberBillingSetupResponse() {
  return NextResponse.json(
    {
      success: false,
      code: "BILLING_SETUP_INCOMPLETE",
      error: "O plano deste espaço ainda está sendo preparado. Tente novamente.",
    },
    { status: 409 }
  );
}

async function getMemberPayload(
  workspaceId: string,
  currentUser?: {
    id: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
  }
) {
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      role: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });

  let invitations: Array<{
    id: string;
    email: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    token: string;
    expiresAt: Date;
    createdAt: Date;
  }> = [];
  if (currentUser && canManageMembers(currentUser.role)) {
    await prisma.workspaceInvitation.updateMany({
      where: {
        workspaceId,
        status: "PENDING",
        expiresAt: { lte: new Date() },
      },
      data: { status: "EXPIRED" },
    });
    invitations = await prisma.workspaceInvitation.findMany({
      where: { workspaceId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        role: true,
        token: true,
        expiresAt: true,
        createdAt: true,
      },
    });
  }

  return {
    ...(currentUser
      ? {
          currentUserId: currentUser.id,
          currentUserRole: currentUser.role,
        }
      : {}),
    members,
    invitations: invitations.map((invitation) => ({
      ...invitation,
      inviteUrl: buildInvitationUrl(invitation.token),
    })),
  };
}

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      ...(await getMemberPayload(context.workspaceId, {
        id: context.userId,
        role: context.role,
      })),
    },
  });
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }
  if (!canManageMembers(context.role)) {
    return NextResponse.json(
      { success: false, error: "Seu perfil não pode convidar integrantes" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Convite inválido", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (!canAssignWorkspaceRole(context.role, parsed.data.role)) {
    return NextResponse.json(
      { success: false, error: "Seu perfil não pode atribuir essa função" },
      { status: 403 }
    );
  }

  const email = normalizeInvitationEmail(parsed.data.email);
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  const existingInvitation = await prisma.workspaceInvitation.findUnique({
    where: {
      workspaceId_email: { workspaceId: context.workspaceId, email },
    },
  });
  const invitationUsesSeat =
    existingInvitation?.status === "PENDING" &&
    existingInvitation.expiresAt > new Date();

  if (existingUser) {
    const existingMembership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: context.workspaceId,
          userId: existingUser.id,
        },
      },
    });
    if (
      existingMembership &&
      !canManageWorkspaceMember(context.role, existingMembership.role)
    ) {
      return NextResponse.json(
        { success: false, error: "Você não pode alterar esse integrante" },
        { status: 403 }
      );
    }

    try {
      await prisma.$transaction(async (transaction) => {
        if (!existingMembership && !invitationUsesSeat) {
          await assertMemberCapacity(transaction, context.workspaceId);
        }
        await transaction.workspaceMember.upsert({
          where: {
            workspaceId_userId: {
              workspaceId: context.workspaceId,
              userId: existingUser.id,
            },
          },
          create: {
            workspaceId: context.workspaceId,
            userId: existingUser.id,
            role: parsed.data.role,
          },
          update: {
            role: parsed.data.role,
          },
        });
        if (existingInvitation?.status === "PENDING") {
          await transaction.workspaceInvitation.update({
            where: {
              id: existingInvitation.id,
              workspaceId: context.workspaceId,
            },
            data: { status: "ACCEPTED", acceptedAt: new Date() },
          });
        }
        await transaction.auditEvent.create({
          data: createAuditEventData({
            workspaceId: context.workspaceId,
            actorUserId: context.userId,
            action: existingMembership
              ? AUDIT_ACTIONS.memberRoleChanged
              : AUDIT_ACTIONS.memberAdded,
            targetType: "User",
            targetId: existingUser.id,
            metadata: {
              ...(existingMembership
                ? { previousRole: existingMembership.role }
                : {}),
              role: parsed.data.role,
            },
          }),
        });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error instanceof WorkspacePlanLimitError) {
        return memberPlanLimitResponse(error);
      }
      if (error instanceof WorkspaceBillingSetupError) {
        return memberBillingSetupResponse();
      }
      throw error;
    }
  } else {
    try {
      await prisma.$transaction(async (transaction) => {
        if (!invitationUsesSeat) {
          await assertMemberCapacity(transaction, context.workspaceId);
        }
        const invitation = await transaction.workspaceInvitation.upsert({
          where: {
            workspaceId_email: {
              workspaceId: context.workspaceId,
              email,
            },
          },
          create: {
            workspaceId: context.workspaceId,
            email,
            role: parsed.data.role,
            token: generateInvitationToken(),
            invitedByUserId: context.userId,
            expiresAt: getInvitationExpiry(),
          },
          update: {
            role: parsed.data.role,
            status: "PENDING",
            token: generateInvitationToken(),
            invitedByUserId: context.userId,
            expiresAt: getInvitationExpiry(),
          },
        });
        await transaction.auditEvent.create({
          data: createAuditEventData({
            workspaceId: context.workspaceId,
            actorUserId: context.userId,
            action: existingInvitation
              ? AUDIT_ACTIONS.invitationRenewed
              : AUDIT_ACTIONS.memberInvited,
            targetType: "WorkspaceInvitation",
            targetId: invitation.id,
            metadata: { role: parsed.data.role },
          }),
        });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error instanceof WorkspacePlanLimitError) {
        return memberPlanLimitResponse(error);
      }
      if (error instanceof WorkspaceBillingSetupError) {
        return memberBillingSetupResponse();
      }
      throw error;
    }
  }

  return NextResponse.json({
    success: true,
    data: await getMemberPayload(context.workspaceId, {
      id: context.userId,
      role: context.role,
    }),
  });
}

export async function PATCH(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }
  if (!canManageMembers(context.role)) {
    return NextResponse.json(
      { success: false, error: "Seu perfil não pode alterar funções" },
      { status: 403 }
    );
  }

  const parsed = updateMemberSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Alteração de integrante inválida" },
      { status: 400 }
    );
  }

  const member = await prisma.workspaceMember.findFirst({
    where: { id: parsed.data.memberId, workspaceId: context.workspaceId },
  });
  if (
    !member ||
    member.userId === context.userId ||
    !canManageWorkspaceMember(context.role, member.role) ||
    !canAssignWorkspaceRole(context.role, parsed.data.role)
  ) {
    return NextResponse.json(
      { success: false, error: "Você não pode alterar esse integrante" },
      { status: 403 }
    );
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.workspaceMember.update({
      where: { id: member.id, workspaceId: context.workspaceId },
      data: { role: parsed.data.role },
    });
    await transaction.auditEvent.create({
      data: createAuditEventData({
        workspaceId: context.workspaceId,
        actorUserId: context.userId,
        action: AUDIT_ACTIONS.memberRoleChanged,
        targetType: "User",
        targetId: member.userId,
        metadata: { previousRole: member.role, role: parsed.data.role },
      }),
    });
  });

  return NextResponse.json({
    success: true,
    data: await getMemberPayload(context.workspaceId, {
      id: context.userId,
      role: context.role,
    }),
  });
}

export async function DELETE(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }
  if (!canManageMembers(context.role)) {
    return NextResponse.json(
      { success: false, error: "Seu perfil não pode remover integrantes" },
      { status: 403 }
    );
  }

  const parsed = deleteSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || (!parsed.data.memberId && !parsed.data.invitationId)) {
    return NextResponse.json(
      { success: false, error: "Informe o integrante ou convite" },
      { status: 400 }
    );
  }

  if (parsed.data.memberId) {
    const member = await prisma.workspaceMember.findFirst({
      where: { id: parsed.data.memberId, workspaceId: context.workspaceId },
    });
    if (
      !member ||
      member.userId === context.userId ||
      !canManageWorkspaceMember(context.role, member.role)
    ) {
      return NextResponse.json(
        { success: false, error: "Você não pode remover esse integrante" },
        { status: 403 }
      );
    }

    await prisma.$transaction(async (transaction) => {
      await transaction.conversation.updateMany({
        where: {
          workspaceId: context.workspaceId,
          assignedMemberId: member.id,
        },
        data: { assignedMemberId: null, version: { increment: 1 } },
      });
      await transaction.workspaceMember.delete({
        where: { id: member.id, workspaceId: context.workspaceId },
      });
      await transaction.auditEvent.create({
        data: createAuditEventData({
          workspaceId: context.workspaceId,
          actorUserId: context.userId,
          action: AUDIT_ACTIONS.memberRemoved,
          targetType: "User",
          targetId: member.userId,
          metadata: { role: member.role },
        }),
      });
    });
  }

  if (parsed.data.invitationId) {
    const invitation = await prisma.workspaceInvitation.findFirst({
      where: {
        id: parsed.data.invitationId,
        workspaceId: context.workspaceId,
        status: "PENDING",
      },
    });
    if (!invitation) {
      return NextResponse.json(
        { success: false, error: "Convite não encontrado" },
        { status: 404 }
      );
    }

    await prisma.$transaction(async (transaction) => {
      await transaction.workspaceInvitation.update({
        where: { id: invitation.id, workspaceId: context.workspaceId },
        data: { status: "REVOKED" },
      });
      await transaction.auditEvent.create({
        data: createAuditEventData({
          workspaceId: context.workspaceId,
          actorUserId: context.userId,
          action: AUDIT_ACTIONS.invitationRevoked,
          targetType: "WorkspaceInvitation",
          targetId: invitation.id,
          metadata: { role: invitation.role },
        }),
      });
    });
  }

  return NextResponse.json({
    success: true,
    data: await getMemberPayload(context.workspaceId, {
      id: context.userId,
      role: context.role,
    }),
  });
}
