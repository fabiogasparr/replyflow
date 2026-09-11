import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { contactDetailSelect, updateContactSchema } from "@/lib/contacts";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { canManageContacts } from "@/lib/workspace-permissions";
import { AUDIT_ACTIONS, createAuditEventData } from "@/lib/audit";

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

  return NextResponse.json({
    success: true,
    data: {
      contact,
      canEdit: canManageContacts(context.role),
      canExport: canManageContacts(context.role),
      canErase: context.role === "OWNER",
    },
  });
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
      error: "Informe a versão do contato e até 10 etiquetas de 30 caracteres ou anotações de até 5.000 caracteres",
    }, { status: 400 });
  }

  const { id } = await route.params;
  const { tags, notes, version } = parsed.data;
  const where = {
    id,
    workspaceId: context.workspaceId,
    instagramAccount: { workspaceId: context.workspaceId },
  };
  const result = await prisma.$transaction(async (transaction) => {
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
          ],
        },
      }),
    });

    return { status: "updated" as const, contact };
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

  return NextResponse.json({ success: true, data: { contact: result.contact } });
}
