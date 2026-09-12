import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getMissingInstagramOAuthEnv } from "@/lib/env";
import { canManageInstagram, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { getInstagramConnectionCheck, type InstagramOnboardingData } from "@/lib/instagram-onboarding";

export async function GET(request: NextRequest) {
  const respond = (body: unknown, status = 200) => NextResponse.json(body, {
    status, headers: { "Cache-Control": "private, no-store" },
  });
  const context = await getCurrentWorkspaceContext();
  if (!context) return respond({ error: "Entre na sua conta para continuar." }, 401);
  // A return from OAuth must not silently display another workspace's progress.
  const expectedWorkspace = request.nextUrl.searchParams.get("workspaceId");
  if (expectedWorkspace && expectedWorkspace !== context.workspaceId) {
    return respond({ error: "O espaço ativo mudou. Volte ao espaço onde iniciou a conexão ou abra novamente o assistente pelas Configurações." }, 409);
  }
  try {
    const [accounts, subscription] = await Promise.all([
      prisma.instagramAccount.findMany({
        where: { workspaceId: context.workspaceId },
        orderBy: { connectedAt: "desc" },
        select: { id: true, username: true, tokenExpiresAt: true, webhookSubscribed: true },
      }),
      prisma.subscription.findUnique({
        where: { workspaceId: context.workspaceId },
        select: { plan: { select: { instagramAccounts: true } } },
      }),
    ]);
    const now = Date.now();
    const data: InstagramOnboardingData = {
      workspace: { id: context.workspaceId, name: context.workspace.name },
      canManage: canManageInstagram(context.role),
      oauthConfigured: getMissingInstagramOAuthEnv().length === 0,
      accountLimit: subscription?.plan.instagramAccounts ?? null,
      accounts: accounts.map((account) => {
        const safe = { ...account, tokenExpiresAt: account.tokenExpiresAt?.toISOString() ?? null };
        return { ...safe, check: getInstagramConnectionCheck(safe, now) };
      }),
    };
    return respond({ data });
  } catch {
    return respond({ error: "Não foi possível consultar a conexão. Tente novamente em instantes." }, 503);
  }
}
