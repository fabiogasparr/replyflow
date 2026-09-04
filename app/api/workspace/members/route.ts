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

    await prisma.workspaceMember.upsert({
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
  } else {
    await prisma.workspaceInvitation.upsert({
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

  await prisma.workspaceMember.update({
    where: { id: member.id },
    data: { role: parsed.data.role },
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

    await prisma.workspaceMember.delete({ where: { id: member.id } });
  }

  if (parsed.data.invitationId) {
    await prisma.workspaceInvitation.updateMany({
      where: {
        id: parsed.data.invitationId,
        workspaceId: context.workspaceId,
        status: "PENDING",
      },
      data: { status: "REVOKED" },
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
