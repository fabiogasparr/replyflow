import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { AUDIT_ACTIONS, createAuditEventData } from "@/lib/audit";
import {
  CONTACT_FIELD_MAX_ACTIVE,
  normalizeContactFieldName,
  updateContactFieldSchema,
} from "@/lib/contact-custom-fields";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { canManageContacts } from "@/lib/workspace-permissions";

type FieldRouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, route: FieldRouteContext) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Faça login para continuar" }, { status: 401 });
  }
  if (!canManageContacts(context.role)) {
    return NextResponse.json({ success: false, error: "Seu perfil não pode configurar campos de contato" }, { status: 403 });
  }
  const parsed = updateContactFieldSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Informe uma alteração válida para o campo" }, { status: 400 });
  }

  const { id } = await route.params;
  try {
    const result = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id" FROM "Workspace" WHERE "id" = ${context.workspaceId} FOR UPDATE
      `);
      const current = await transaction.contactFieldDefinition.findFirst({
        where: { id, workspaceId: context.workspaceId },
        select: { id: true, type: true, options: true, isActive: true },
      });
      if (!current) return null;

      if (parsed.data.options !== undefined && current.type !== "SELECT") {
        throw new Error("CONTACT_FIELD_OPTIONS_UNSUPPORTED");
      }
      if (current.type === "SELECT" && parsed.data.options?.length === 0) {
        throw new Error("CONTACT_FIELD_OPTIONS_REQUIRED");
      }
      if (current.type === "SELECT" && parsed.data.options?.length) {
        const invalidValues = await transaction.contactFieldValue.count({
          where: {
            workspaceId: context.workspaceId,
            fieldDefinitionId: id,
            value: { notIn: parsed.data.options },
          },
        });
        if (invalidValues > 0) throw new Error("CONTACT_FIELD_OPTIONS_IN_USE");
      }
      if (!current.isActive && parsed.data.isActive === true) {
        const activeCount = await transaction.contactFieldDefinition.count({
          where: { workspaceId: context.workspaceId, isActive: true },
        });
        if (activeCount >= CONTACT_FIELD_MAX_ACTIVE) throw new Error("CONTACT_FIELD_ACTIVE_LIMIT");
      }

      const field = await transaction.contactFieldDefinition.update({
        where: { id_workspaceId: { id, workspaceId: context.workspaceId } },
        data: {
          ...(parsed.data.name === undefined ? {} : {
            name: parsed.data.name,
            normalizedName: normalizeContactFieldName(parsed.data.name),
          }),
          ...(parsed.data.options === undefined ? {} : { options: parsed.data.options }),
          ...(parsed.data.isActive === undefined ? {} : { isActive: parsed.data.isActive }),
        },
        select: {
          id: true, name: true, type: true, options: true, position: true,
          isActive: true, createdAt: true, updatedAt: true,
          _count: { select: { values: true } },
        },
      });
      await transaction.auditEvent.create({
        data: createAuditEventData({
          workspaceId: context.workspaceId,
          actorUserId: context.userId,
          action: AUDIT_ACTIONS.contactFieldUpdated,
          targetType: "ContactFieldDefinition",
          targetId: id,
          metadata: { fields: Object.keys(parsed.data) },
        }),
      });
      return field;
    }, { isolationLevel: "Serializable" });

    if (!result) {
      return NextResponse.json({ success: false, error: "Campo não encontrado" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: { field: result } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ success: false, error: "Já existe um campo com esse nome" }, { status: 409 });
    }
    if (error instanceof Error && error.message === "CONTACT_FIELD_OPTIONS_UNSUPPORTED") {
      return NextResponse.json({ success: false, error: "Somente campos de seleção possuem opções" }, { status: 400 });
    }
    if (error instanceof Error && error.message === "CONTACT_FIELD_OPTIONS_REQUIRED") {
      return NextResponse.json({ success: false, error: "Campos de seleção precisam de ao menos uma opção" }, { status: 400 });
    }
    if (error instanceof Error && error.message === "CONTACT_FIELD_OPTIONS_IN_USE") {
      return NextResponse.json({ success: false, error: "Uma opção removida ainda está em uso por contatos" }, { status: 409 });
    }
    if (error instanceof Error && error.message === "CONTACT_FIELD_ACTIVE_LIMIT") {
      return NextResponse.json({ success: false, error: `Use no máximo ${CONTACT_FIELD_MAX_ACTIVE} campos ativos` }, { status: 409 });
    }
    throw error;
  }
}
