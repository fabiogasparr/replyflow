import { prisma } from "@/lib/db/client";
import { isConfirmationCode } from "@/lib/meta/data-deletion";

export interface DeletionRequestStatus {
  code: string;
  receivedAt: Date;
  removedAccounts: number;
}

/**
 * Look up a Meta data-deletion request by its confirmation code. The callback
 * records each request as a SYSTEM operational event, which is enough to
 * answer the status page without a dedicated table.
 */
export async function findDeletionRequest(
  code: string | null | undefined
): Promise<DeletionRequestStatus | null> {
  if (!isConfirmationCode(code)) return null;
  const event = await prisma.operationalEvent.findFirst({
    where: {
      source: "SYSTEM",
      payload: { path: ["confirmationCode"], equals: code },
    },
    select: { createdAt: true, payload: true },
    orderBy: { createdAt: "desc" },
  });
  if (!event) return null;
  const payload = (event.payload ?? {}) as { removedAccounts?: unknown };
  return {
    code,
    receivedAt: event.createdAt,
    removedAccounts: Array.isArray(payload.removedAccounts)
      ? payload.removedAccounts.length
      : 0,
  };
}
