import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { contactDetailSelect, updateContactSchema } from "@/lib/contacts";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { canManageContacts } from "@/lib/workspace-permissions";
import { AUDIT_ACTIONS, createAuditEventData } from "@/lib/audit";
import {
  ContactFieldValueError,
  normalizeContactFieldValue,
} from "@/lib/contact-custom-fields";

type ContactRouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, route: ContactRouteContext) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }

  const { id } = await route.params;
  const contact = await prisma.contact.findFirst({
    where: {
      id,
      workspaceId: context.workspaceId,
      instagramAccount: { workspaceId: context.workspaceId },
    },
    select: contactDetailSelect,
  });
  if (!contact) {
    return NextResponse.json(
      { success: false, error: "Contato não encontrado" },
      { status: 404 }
    );
  }

  const definitions = await prisma.contactFieldDefinition.findMany({
    where: { workspaceId: context.workspaceId, isActive: true },
    select: {
      id: true,
      name: true,
      type: true,
      options: true,
      position: true,
      isActive: true,
      values: {
        where: { workspaceId: context.workspaceId, contactId: id },
        select: { value: true },
        take: 1,
      },
    },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  });

  return NextResponse.json({
    success: true,
    data: {
      contact,
      customFields: definitions.map(({ values, ...definition }) => ({
        ...definition,
        value: values[0]?.value ?? null,
      })),
      canEdit: canManageContacts(context.role),
      canExport: canManageContacts(context.role),
      canErase: context.role === "OWNER",
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: NextRequest, route: ContactRouteContext) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Faça login para continuar" },
      { status: 401 }
    );
  }
  if (!canManageContacts(context.role)) {
    return NextResponse.json(
      { success: false, error: "Seu perfil pode consultar contatos, mas não pode editá-los" },
      { status: 403 }
    );
  }

  const parsed = updateContactSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({
      success: false,
      error: "Informe a versão e uma alteração válida em etiquetas, anotações ou campos personalizados",
    }, { status: 400 });
  }

  const { id } = await route.params;
  const { tags, notes, customFields, version } = parsed.data;
  const where = {
    id,
    workspaceId: context.workspaceId,
    instagramAccount: { workspaceId: context.workspaceId },
  };
  try {
    const result = await prisma.$transaction(async (transaction) => {
      let normalizedCustomFields: Array<{ fieldDefinitionId: string; value: string | null }> | undefined;
      if (customFields !== undefined) {
        const definitions = await transaction.contactFieldDefinition.findMany({
          where: {
            workspaceId: context.workspaceId,
            isActive: true,
            id: { in: customFields.map((field) => field.fieldDefinitionId) },
          },
          select: { id: true, type: true, options: true },
        });
        if (definitions.length !== customFields.length) {
          throw new ContactFieldValueError("unknown", "Um campo personalizado não existe ou está inativo.");
        }
        const byId = new Map(definitions.map((definition) => [definition.id, definition]));
        normalizedCustomFields = customFields.map((field) => ({
          fieldDefinitionId: field.fieldDefinitionId,
          value: normalizeContactFieldValue(byId.get(field.fieldDefinitionId)!, field.value),
        }));
      }

      const updated = await transaction.contact.updateMany({
        where: { ...where, version },
        data: {
          ...(tags !== undefined ? { tags } : {}),
          ...(notes !== undefined ? { notes } : {}),
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        const existing = await transaction.contact.findFirst({
          where,
          select: { id: true },
        });
        return { status: existing ? "conflict" as const : "missing" as const };
      }

      if (normalizedCustomFields) {
        for (const field of normalizedCustomFields) {
          if (field.value === null) {
            await transaction.contactFieldValue.deleteMany({
              where: {
                workspaceId: context.workspaceId,
                contactId: id,
                fieldDefinitionId: field.fieldDefinitionId,
              },
            });
          } else {
            const updatedValue = await transaction.contactFieldValue.updateMany({
              where: {
                workspaceId: context.workspaceId,
                contactId: id,
                fieldDefinitionId: field.fieldDefinitionId,
              },
              data: { value: field.value },
            });
            if (updatedValue.count === 0) {
              await transaction.contactFieldValue.create({
                data: {
                  workspaceId: context.workspaceId,
                  contactId: id,
                  fieldDefinitionId: field.fieldDefinitionId,
                  value: field.value,
                },
              });
            }
          }
        }
      }

      const contact = await transaction.contact.findFirst({ where, select: contactDetailSelect });
      if (!contact) throw new Error("Contact disappeared during update transaction");

      await transaction.auditEvent.create({
        data: createAuditEventData({
          workspaceId: context.workspaceId,
          actorUserId: context.userId,
          action: AUDIT_ACTIONS.contactUpdated,
          targetType: "Contact",
          targetId: id,
          metadata: {
            fields: [
              ...(tags !== undefined ? ["tags"] : []),
              ...(notes !== undefined ? ["notes"] : []),
              ...(customFields !== undefined ? ["customFields"] : []),
            ],
            ...(normalizedCustomFields ? {
              customFieldIds: normalizedCustomFields.map((field) => field.fieldDefinitionId),
            } : {}),
          },
        }),
      });

      return { status: "updated" as const, contact, customFields: normalizedCustomFields };
    });

    if (result.status === "missing") {
      return NextResponse.json(
        { success: false, error: "Contato não encontrado" },
        { status: 404 }
      );
    }
    if (result.status === "conflict") {
      return NextResponse.json({
        success: false,
        code: "CONTACT_VERSION_CONFLICT",
        error: "Este contato foi atualizado por outra pessoa. Recarregue os dados antes de salvar.",
      }, { status: 409 });
    }

    return NextResponse.json({
      success: true,
      data: { contact: result.contact, customFields: result.customFields },
    });
  } catch (error) {
    if (error instanceof ContactFieldValueError) {
      return NextResponse.json({
        success: false,
        code: "INVALID_CONTACT_FIELD_VALUE",
        fieldDefinitionId: error.fieldDefinitionId,
        error: error.message,
      }, { status: 400 });
    }
    throw error;
  }
}
