import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { AUDIT_ACTIONS, createAuditEventData } from "@/lib/audit";
import {
  CONTACT_FIELD_MAX_ACTIVE,
  CONTACT_FIELD_MAX_TOTAL,
  createContactFieldSchema,
  normalizeContactFieldName,
} from "@/lib/contact-custom-fields";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { canManageContacts } from "@/lib/workspace-permissions";

const fieldSelect = {
  id: true,
  name: true,
  type: true,
  options: true,
  position: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { values: true } },
} as const;

async function listFields(workspaceId: string) {
  return prisma.contactFieldDefinition.findMany({
    where: { workspaceId },
    select: fieldSelect,
    orderBy: [{ isActive: "desc" }, { position: "asc" }, { id: "asc" }],
  });
}

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Faça login para continuar" }, { status: 401 });
  }
  return NextResponse.json({
    success: true,
    data: {
      fields: await listFields(context.workspaceId),
      canManage: canManageContacts(context.role),
      limits: { active: CONTACT_FIELD_MAX_ACTIVE },
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Faça login para continuar" }, { status: 401 });
  }
  if (!canManageContacts(context.role)) {
    return NextResponse.json({ success: false, error: "Seu perfil não pode configurar campos de contato" }, { status: 403 });
  }

  const parsed = createContactFieldSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({
      success: false,
      error: "Informe nome, tipo e opções válidas para o campo",
    }, { status: 400 });
  }

  try {
    const field = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id" FROM "Workspace" WHERE "id" = ${context.workspaceId} FOR UPDATE
      `);
      const [activeCount, totalCount, latest] = await Promise.all([
        transaction.contactFieldDefinition.count({ where: { workspaceId: context.workspaceId, isActive: true } }),
        transaction.contactFieldDefinition.count({ where: { workspaceId: context.workspaceId } }),
        transaction.contactFieldDefinition.aggregate({
          where: { workspaceId: context.workspaceId },
          _max: { position: true },
        }),
      ]);
      if (activeCount >= CONTACT_FIELD_MAX_ACTIVE) throw new Error("CONTACT_FIELD_ACTIVE_LIMIT");
      if (totalCount >= CONTACT_FIELD_MAX_TOTAL) throw new Error("CONTACT_FIELD_TOTAL_LIMIT");

      const created = await transaction.contactFieldDefinition.create({
        data: {
          workspaceId: context.workspaceId,
          name: parsed.data.name,
          normalizedName: normalizeContactFieldName(parsed.data.name),
          type: parsed.data.type,
          options: parsed.data.type === "SELECT" ? parsed.data.options ?? [] : [],
          position: (latest._max.position ?? -1) + 1,
        },
        select: fieldSelect,
      });
      await transaction.auditEvent.create({
        data: createAuditEventData({
          workspaceId: context.workspaceId,
          actorUserId: context.userId,
          action: AUDIT_ACTIONS.contactFieldCreated,
          targetType: "ContactFieldDefinition",
          targetId: created.id,
          metadata: { type: created.type },
        }),
      });
      return created;
    }, { isolationLevel: "Serializable" });

    return NextResponse.json({ success: true, data: { field } }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ success: false, error: "Já existe um campo com esse nome" }, { status: 409 });
    }
    if (error instanceof Error && error.message === "CONTACT_FIELD_ACTIVE_LIMIT") {
      return NextResponse.json({ success: false, error: `Use no máximo ${CONTACT_FIELD_MAX_ACTIVE} campos ativos` }, { status: 409 });
    }
    if (error instanceof Error && error.message === "CONTACT_FIELD_TOTAL_LIMIT") {
      return NextResponse.json({ success: false, error: "O limite histórico de campos foi atingido; contate o suporte" }, { status: 409 });
    }
    throw error;
  }
}
