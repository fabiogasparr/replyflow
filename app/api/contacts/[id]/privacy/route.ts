import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  anonymizeContactPersonalData,
  ContactPrivacyError,
  getContactPrivacyExport,
} from "@/lib/contact-privacy";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { canManageContacts } from "@/lib/workspace-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PrivacyRouteContext = { params: Promise<{ id: string }> };

const eraseSchema = z.strictObject({
  version: z.number().int().min(0).max(2_147_483_646),
  confirmation: z.string().min(1).max(200),
});

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

function privacyError(error: unknown) {
  if (error instanceof ContactPrivacyError) {
    return NextResponse.json({
      success: false,
      code: error.code,
      error: error.message,
    }, { status: error.status, headers: privateHeaders });
  }
  throw error;
}

export async function GET(_request: NextRequest, route: PrivacyRouteContext) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Faça login para continuar" }, {
      status: 401,
      headers: privateHeaders,
    });
  }
  if (!canManageContacts(context.role)) {
    return NextResponse.json({ success: false, error: "Seu perfil não pode exportar dados pessoais" }, {
      status: 403,
      headers: privateHeaders,
    });
  }

  const { id } = await route.params;
  try {
    const data = await getContactPrivacyExport({
      workspaceId: context.workspaceId,
      contactId: id,
      actorUserId: context.userId,
    });
    return new NextResponse(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        ...privateHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="replyflow-dados-contato-${id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)}.json"`,
      },
    });
  } catch (error) {
    return privacyError(error);
  }
}

export async function DELETE(request: NextRequest, route: PrivacyRouteContext) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Faça login para continuar" }, {
      status: 401,
      headers: privateHeaders,
    });
  }
  if (context.role !== "OWNER") {
    return NextResponse.json({
      success: false,
      error: "Somente o proprietário pode anonimizar dados pessoais",
    }, { status: 403, headers: privateHeaders });
  }

  const parsed = eraseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({
      success: false,
      error: "Informe a versão do contato e a confirmação exibida na tela",
    }, { status: 400, headers: privateHeaders });
  }

  const { id } = await route.params;
  try {
    const result = await anonymizeContactPersonalData({
      workspaceId: context.workspaceId,
      contactId: id,
      actorUserId: context.userId,
      ...parsed.data,
    });
    return NextResponse.json({ success: true, data: result }, { headers: privateHeaders });
  } catch (error) {
    return privacyError(error);
  }
}
