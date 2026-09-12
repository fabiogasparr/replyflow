/**
 * Keep an Instagram account's ice breakers in sync with its campaigns.
 *
 * Every active campaign with an `iceBreakerQuestion` contributes one question
 * (Meta caps the list at four; the oldest campaigns win so the list is
 * stable). Tapping a question sends a postback `campaign:<automationId>`,
 * which the webhook routes into the message handler as an ice_breaker
 * trigger. Sync is best-effort: a Meta error is recorded as an operational
 * event and never fails the campaign save.
 */

import { prisma } from "@/lib/db/client";
import {
  clearInstagramIceBreakers,
  setInstagramIceBreakers,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";

export const MAX_ICE_BREAKERS = 4;
export const ICE_BREAKER_PAYLOAD_PREFIX = "campaign:";

export function iceBreakerPayload(automationId: string): string {
  return `${ICE_BREAKER_PAYLOAD_PREFIX}${automationId}`;
}

export interface IceBreakerSyncResult {
  synced: boolean;
  questions: number;
  error?: string;
}

export async function syncAccountIceBreakers(
  instagramAccountRowId: string
): Promise<IceBreakerSyncResult> {
  const account = await prisma.instagramAccount.findUnique({
    where: { id: instagramAccountRowId },
    select: {
      id: true,
      workspaceId: true,
      username: true,
      accessToken: true,
      automations: {
        where: { isActive: true, iceBreakerQuestion: { not: null } },
        orderBy: { createdAt: "asc" },
        select: { id: true, iceBreakerQuestion: true },
      },
    },
  });
  if (!account || !account.accessToken) {
    return { synced: false, questions: 0, error: "Conta sem token de acesso" };
  }

  const questions = account.automations
    .map((a) => ({
      question: (a.iceBreakerQuestion ?? "").trim(),
      payload: iceBreakerPayload(a.id),
    }))
    .filter((q) => q.question)
    .slice(0, MAX_ICE_BREAKERS);

  try {
    const accessToken = decryptToken(account.accessToken);
    if (questions.length === 0) {
      await clearInstagramIceBreakers(accessToken);
    } else {
      await setInstagramIceBreakers(accessToken, questions);
    }
    return { synced: true, questions: questions.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    await prisma.operationalEvent
      .create({
        data: {
          workspaceId: account.workspaceId,
          source: "SYSTEM",
          level: "WARNING",
          message: `Não foi possível atualizar as perguntas iniciais (ice breakers) de @${account.username}`,
          payload: { instagramAccountId: account.id, questions: questions.length, error: message },
        },
      })
      .catch(() => {});
    return { synced: false, questions: questions.length, error: message };
  }
}
